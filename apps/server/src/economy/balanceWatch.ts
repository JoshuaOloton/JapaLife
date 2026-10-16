import type { PrismaClient } from "@japalife/db";
import type { Currency } from "@japalife/shared";
import type { GameContent } from "../content/loadContent";
import { calendarDay, MS_PER_DAY } from "../game/clock";
import type { Amount } from "./money";

/** How far back the watch looks, in real time. */
export const BALANCE_WATCH_WINDOW_MS = MS_PER_DAY;

/** The most each ledger reason may credit a player within a window, by currency. */
export type Ceilings = (currency: Currency, reason: string) => Amount;

/**
 * The most money the rules in `content/` let a player receive within
 * `gameSpanMs` of game time, per reason. Anything not listed here has a
 * ceiling of zero, so a new faucet (or a player transfer) is flagged until it
 * is given a rule. Ceilings are generous on purpose: they must never flag
 * honest play, and the aim is to catch money arriving outside the rules (a
 * bug, a replayed payment, an exploit), not players who grind hard.
 */
export function earningCeilings(content: GameContent, gameSpanMs: number): Ceilings {
  const jobs = content.jobs.jobs;
  const longestShiftMs = Math.max(0, ...jobs.map((job) => job.shiftMinutes * 60_000));
  const biggestShiftPay = Math.max(0, ...jobs.map((job) => job.shiftPayKobo));
  const dailyShiftPay = jobs.reduce((sum, job) => sum + BigInt(job.maxShiftsPerDay) * BigInt(job.shiftPayKobo), 0n);

  // A shift paid inside the window may have started up to one shift length
  // before it, and a span of time touches one more calendar day than its
  // length (the daily cap resets at midnight). One extra shift covers the
  // one that was still running when a server outage delayed its pay.
  const daysTouched = BigInt(Math.ceil((gameSpanMs + longestShiftMs) / MS_PER_DAY) + 1);
  const shiftPay = dailyShiftPay * daysTouched + BigInt(biggestShiftPay);

  const ngn: Record<string, Amount> = {
    shift_pay: shiftPay,
    // Paid once per player, ever.
    starting_balance: BigInt(content.ngn.startingBalanceKobo),
  };

  return (currency, reason) => (currency === "NGN" ? (ngn[reason] ?? 0n) : 0n);
}

export interface RaisedFlag {
  playerId: string;
  currency: Currency;
  reason: string;
  receivedInWindow: Amount;
  ceiling: Amount;
}

interface ReceivedRow {
  playerId: string;
  currency: Currency;
  reason: string;
  received: bigint;
}

/**
 * Flags players who received money faster than the rules allow: for each
 * reason, the sum credited over the trailing window is compared with its
 * ceiling. Reads the ledger and never writes it. A flag is a record for a
 * human to review; nothing happens to the player (decided 2026-10-16).
 */
export class BalanceWatch {
  constructor(
    private readonly db: PrismaClient,
    private readonly content: GameContent,
    /** Game time per real time (GAME_CLOCK). The window is real time; earnings follow game time. */
    private readonly clockSpeed: number,
    /** Flags are grouped by this zone's calendar day. */
    private readonly timeZone: string,
    private readonly windowMs = BALANCE_WATCH_WINDOW_MS,
  ) {}

  /**
   * Checks the window ending at `asOf`. Real time on purpose, not game time:
   * ledger rows are stamped by the database clock. Returns flags that are new
   * or worse than already recorded today.
   */
  async scan(asOf: Date = new Date()): Promise<RaisedFlag[]> {
    const windowStart = new Date(asOf.getTime() - this.windowMs);
    const ceilingFor = earningCeilings(this.content, this.windowMs * this.clockSpeed);

    // Every credit to a player wallet, whatever its reason, so money arriving by
    // a path nobody planned for is caught too.
    const rows = await this.db.$queryRaw<ReceivedRow[]>`
      SELECT w."playerId", t."currency"::text AS "currency", t."reason",
             SUM(t."amount")::bigint AS "received"
      FROM "Transaction" t
      JOIN "Wallet" w ON w."id" = t."toWalletId"
      WHERE w."kind" = 'PLAYER'
        AND t."createdAt" > ${windowStart}
        AND t."createdAt" <= ${asOf}
      GROUP BY w."playerId", t."currency", t."reason"`;

    const dayKey = calendarDay(asOf, this.timeZone);
    const raised: RaisedFlag[] = [];
    for (const row of rows) {
      const ceiling = ceilingFor(row.currency, row.reason);
      if (row.received <= ceiling) continue;
      const flag: RaisedFlag = {
        playerId: row.playerId,
        currency: row.currency,
        reason: row.reason,
        receivedInWindow: row.received,
        ceiling,
      };
      if (await this.record(flag, windowStart, asOf, dayKey)) raised.push(flag);
    }
    return raised;
  }

  /** Keeps one row per player, currency, reason and day, holding the worst amount. */
  private async record(flag: RaisedFlag, windowStart: Date, windowEnd: Date, dayKey: string): Promise<boolean> {
    const { playerId, currency, reason } = flag;
    const where = { playerId_currency_reason_dayKey: { playerId, currency, reason, dayKey } };
    const existing = await this.db.balanceFlag.findUnique({ where, select: { receivedInWindow: true } });
    if (existing && existing.receivedInWindow >= flag.receivedInWindow) return false;

    const data = {
      receivedInWindow: flag.receivedInWindow,
      ceiling: flag.ceiling,
      windowStart,
      windowEnd,
    };
    await this.db.balanceFlag.upsert({
      where,
      create: { playerId, currency, reason, dayKey, ...data },
      update: data,
    });
    return true;
  }
}
