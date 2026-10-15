import type { RentStatus } from "@japalife/shared";
import { InsufficientFundsError } from "../economy/money";
import { addDays } from "./clock";
import type { GameDeps } from "./deps";
import { type Outcome, reject } from "./outcome";

/**
 * Rent is due every `periodDays` real days. Paying moves the due date forward by
 * one period (from the old due date, not from today, so paying late does not
 * shift the schedule). What happens when rent goes unpaid is not decided yet: the
 * status becomes "overdue" and nothing else changes.
 */
export class RentService {
  constructor(private readonly deps: GameDeps) {}

  status(rentDueAt: Date, now: Date): RentStatus {
    const { graceDays } = this.deps.content.ngn.rent;
    if (now < rentDueAt) return "ok";
    return now <= addDays(rentDueAt, graceDays) ? "due" : "overdue";
  }

  async payRent(playerId: string, now: Date): Promise<Outcome<{ nextDueAt: Date }>> {
    const { db, wallet, content } = this.deps;
    const { amountKobo, periodDays } = content.ngn.rent;

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
      data: { rentDueAt: nextDueAt },
    });
    return { ok: true, nextDueAt };
  }
}
