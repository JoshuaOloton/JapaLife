import type { Shift } from "@japalife/db";
import { calendarDay } from "./clock";
import type { GameDeps } from "./deps";
import type { EventService } from "./events";
import { type Outcome, reject } from "./outcome";
import type { PlayerService } from "./players";

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
  ) {}

  async startShift(
    playerId: string,
    jobId: string,
    now: Date,
  ): Promise<Outcome<{ shiftId: string; endsAt: Date }>> {
    const { db, content, timeZone } = this.deps;
    const job = content.jobs.jobs.find((candidate) => candidate.id === jobId);
    if (!job) return reject("unknown_target");

    const state = await this.players.getState(playerId);
    if (!state) return reject("not_signed_in");

    await this.settleDueShifts(now, playerId);
    if (await this.activeShift(playerId, now)) return reject("shift_active");

    const effects = await this.events.activeEffects(playerId, now);
    if (effects.blackoutEndsAt) return reject("blackout");

    const dayKey = calendarDay(now, timeZone);
    const startedToday = await db.shift.count({ where: { playerId, jobId, dayKey } });
    if (startedToday >= job.maxShiftsPerDay) return reject("daily_limit");

    const meters = this.players.currentMeters(state, now);
    if (meters.hunger < 1) return reject("starving");
    if (meters.energy < job.energyCost) return reject("no_energy");

    const endsAt = new Date(now.getTime() + job.shiftMinutes * 60_000);
    // Spend the energy and record the shift together, so neither happens alone.
    const [, shift] = await db.$transaction([
      db.playerState.update({
        where: { playerId },
        data: {
          hunger: meters.hunger,
          energy: meters.energy - job.energyCost,
          statsAt: now,
        },
      }),
      db.shift.create({ data: { playerId, jobId, startedAt: now, endsAt, dayKey } }),
    ]);
    return { ok: true, shiftId: shift.id, endsAt };
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
      await wallet.credit({
        playerId: shift.playerId,
        currency: "NGN",
        amount: BigInt(job.shiftPayKobo),
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
          amountKobo: job.shiftPayKobo,
        });
      }
    }
    return paid;
  }
}
