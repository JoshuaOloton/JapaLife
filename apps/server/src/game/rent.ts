import { type RentStatus, withAmount } from "@japalife/shared";
import { InsufficientFundsError } from "../economy/money";
import { addDays } from "./clock";
import type { GameDeps } from "./deps";
import type { InboxService } from "./inbox";
import { type Outcome, reject } from "./outcome";
import type { PlayerService } from "./players";

/**
 * Rent is due every `periodDays` real days. Paying moves the due date forward by
 * one period (from the old due date, not from today, so paying late does not
 * shift the schedule). After `graceDays` unpaid, a late fee is charged, then
 * again every `lateFee.everyDays` until the rent is paid (decided 2026-10-17).
 * A player who cannot pay a fee loses more morale instead. Eviction comes later.
 */
export class RentService {
  constructor(
    private readonly deps: GameDeps,
    private readonly players: PlayerService,
    private readonly inbox: InboxService,
  ) {}

  status(rentDueAt: Date, now: Date): RentStatus {
    const { graceDays } = this.deps.content.ngn.rent;
    if (now < rentDueAt) return "ok";
    return now <= addDays(rentDueAt, graceDays) ? "due" : "overdue";
  }

  async payRent(playerId: string, now: Date): Promise<Outcome<{ nextDueAt: Date }>> {
    const { db, wallet, content } = this.deps;
    const { amountKobo, periodDays, graceDays } = content.ngn.rent;

    const state = await db.playerState.findUnique({ where: { playerId } });
    if (!state) return reject("not_signed_in");

    // Already paid a full period ahead: paying more would only stockpile months.
    if (state.rentDueAt > addDays(now, periodDays)) return reject("rent_not_due");

    try {
      await wallet.debit({
        playerId,
        currency: "NGN",
        amount: BigInt(amountKobo),
        reason: "rent",
        // One payment per due date, so a retry cannot charge the same month twice.
        reference: `rent:${playerId}:${state.rentDueAt.toISOString()}`,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) return reject("insufficient_funds");
      throw error;
    }

    const nextDueAt = addDays(state.rentDueAt, periodDays);
    // Only advance if nobody else already did, so a replay cannot skip a month.
    await db.playerState.updateMany({
      where: { playerId, rentDueAt: state.rentDueAt },
      data: { rentDueAt: nextDueAt, lateFeeDueAt: addDays(nextDueAt, graceDays) },
    });
    return { ok: true, nextDueAt };
  }

  /** Players with a late fee due, for the scheduled job. */
  async playersWithLateFeesDue(now: Date): Promise<string[]> {
    const rows = await this.deps.db.playerState.findMany({
      where: { lateFeeDueAt: { lte: now } },
      select: { playerId: true },
    });
    return rows.map((row) => row.playerId);
  }

  /**
   * Charges every late fee that fell due up to `now`, catching up on time the
   * player was away. Each fee is first claimed by moving `lateFeeDueAt` on with
   * a conditional update, so the room and the scheduled job can never charge
   * the same fee twice. Run it under the player's mutex: it changes morale.
   * Returns how many fees fell due.
   */
  async chargeLateFees(playerId: string, now: Date): Promise<number> {
    const { db, wallet, content } = this.deps;
    const { lateFee } = content.ngn.rent;
    const copy = content.copy.notices;
    const amount = BigInt(lateFee.amountKobo);

    let charged = 0;
    for (;;) {
      const state = await db.playerState.findUnique({ where: { playerId }, select: { lateFeeDueAt: true } });
      if (!state || state.lateFeeDueAt > now) return charged;
      const dueAt = state.lateFeeDueAt;

      // Claim before charging: if paying rent moved the date meanwhile, nothing is taken.
      const { count } = await db.playerState.updateMany({
        where: { playerId, lateFeeDueAt: dueAt },
        data: { lateFeeDueAt: addDays(dueAt, lateFee.everyDays) },
      });
      if (count !== 1) continue; // someone else took this one; look again

      let paid = true;
      try {
        await wallet.debit({
          playerId,
          currency: "NGN",
          amount,
          reason: "rent_late_fee",
          reference: `rent_late:${playerId}:${dueAt.toISOString()}`,
        });
      } catch (error) {
        if (!(error instanceof InsufficientFundsError)) throw error;
        paid = false;
      }
      charged += 1;
      await this.players.applyChange(playerId, { morale: paid ? lateFee.moraleChange : lateFee.brokeMoraleChange }, now);
      await this.inbox.deliver(
        playerId,
        {
          kind: "rent",
          title: copy.rentLateFeeTitle,
          message: withAmount(paid ? copy.rentLateFee : copy.rentLateFeeBroke, amount),
        },
        now,
      );
    }
  }
}
