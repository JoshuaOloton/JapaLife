import type { Shift } from "@japalife/db";
import { type NeedsConfig, withAmount } from "@japalife/shared";
import { calendarDay } from "./clock";
import type { GameDeps } from "./deps";
import type { EventService } from "./events";
import type { InboxService } from "./inbox";
import { shiftPayPercent } from "./needs";
import { type Outcome, reject } from "./outcome";
import type { PlayerService } from "./players";

/** A shift's pay at the player's current morale, rounded down to a whole kobo (integer maths only). */
export function shiftPay(fullPayKobo: number, morale: number, needs: NeedsConfig): bigint {
  const pay = (BigInt(fullPayKobo) * BigInt(shiftPayPercent(morale, needs))) / 100n;
  // The ledger refuses zero amounts; a shift always pays something.
  return pay > 0n ? pay : 1n;
}

export interface PaidShift {
  playerId: string;
  shiftId: string;
  jobId: string;
  amountKobo: number;
}

/**
 * Jobs that pay per shift. Starting a shift spends energy and is limited per
 * day (the earn rate limit); the pay arrives through the ledger once the shift's
 * real-time length has passed, whether or not the player is still connected.
 */
export class JobService {
  constructor(
    private readonly deps: GameDeps,
    private readonly players: PlayerService,
    private readonly events: EventService,
    private readonly inbox: InboxService,
  ) {}

  async startShift(
    playerId: string,
    jobId: string,
    now: Date,
  ): Promise<Outcome<{ shiftId: string; endsAt: Date; payKobo: bigint }>> {
    const { db, content, timeZone } = this.deps;
    const job = content.jobs.jobs.find((candidate) => candidate.id === jobId);
    if (!job) return reject("unknown_target");

    const state = await this.players.getState(playerId);
    if (!state) return reject("not_signed_in");

    await this.settleDueShifts(now, playerId);
    if (await this.activeShift(playerId, now)) return reject("shift_active");

    const effects = await this.events.activeEffects(playerId, now);
    if (effects.blackoutEndsAt && effects.blackoutBlocksShifts) return reject("blackout");

    const dayKey = calendarDay(now, timeZone);
    const startedToday = await db.shift.count({ where: { playerId, jobId, dayKey } });
    if (startedToday >= job.maxShiftsPerDay) return reject("daily_limit");

    const needs = await this.players.currentNeeds(state, now);
    if (needs.hunger < 1) return reject("starving");
    if (needs.energy < job.energyCost) return reject("no_energy");

    const endsAt = new Date(now.getTime() + job.shiftMinutes * 60_000);
    const payKobo = shiftPay(job.shiftPayKobo, needs.morale, content.needs);
    // Spend the energy and record the shift together, so neither happens alone.
    const [, shift] = await db.$transaction([
      db.playerState.update({
        where: { playerId },
        data: { ...needs, energy: needs.energy - job.energyCost, statsAt: now },
      }),
      db.shift.create({ data: { playerId, jobId, payKobo, startedAt: now, endsAt, dayKey } }),
    ]);
    return { ok: true, shiftId: shift.id, endsAt, payKobo };
  }

  /** The player's shift that has not finished yet, if any. */
  activeShift(playerId: string, now: Date): Promise<Shift | null> {
    return this.deps.db.shift.findFirst({
      where: { playerId, paidAt: null, endsAt: { gt: now } },
    });
  }

  /** Shifts the player has started today (Lagos calendar day). */
  shiftsToday(playerId: string, now: Date): Promise<number> {
    return this.deps.db.shift.count({
      where: { playerId, dayKey: calendarDay(now, this.deps.timeZone) },
    });
  }

  /**
   * Pays every finished shift (for one player, or everyone). Safe to call from
   * anywhere and as often as you like: the ledger reference `shift:<id>` means a
   * shift can only ever be paid once, and only the call that marks it paid
   * reports it, so a notice is never sent twice.
   */
  async settleDueShifts(now: Date, playerId?: string): Promise<PaidShift[]> {
    const { db, wallet, content } = this.deps;
    const due = await db.shift.findMany({
      where: { paidAt: null, endsAt: { lte: now }, ...(playerId ? { playerId } : {}) },
      orderBy: { endsAt: "asc" },
      take: 500,
    });

    const paid: PaidShift[] = [];
    for (const shift of due) {
      const job = content.jobs.jobs.find((candidate) => candidate.id === shift.jobId);
      if (!job) continue;
      const amount = shift.payKobo ?? BigInt(job.shiftPayKobo);
      await wallet.credit({
        playerId: shift.playerId,
        currency: "NGN",
        amount,
        reason: "shift_pay",
        reference: `shift:${shift.id}`,
      });
      const marked = await db.shift.updateMany({
        where: { id: shift.id, paidAt: null },
        data: { paidAt: now },
      });
      if (marked.count === 1) {
        paid.push({
          playerId: shift.playerId,
          shiftId: shift.id,
          jobId: shift.jobId,
          // Safe as a number: one shift's pay is far below the balance cap.
          amountKobo: Number(amount),
        });
        const { notices } = content.copy;
        await this.inbox.deliver(
          shift.playerId,
          { kind: "shift_paid", title: notices.shiftPaidTitle, message: withAmount(notices.shiftPaid, amount) },
          now,
        );
      }
    }
    return paid;
  }
}
