/**
 * Messages the server sends to the client. The client treats them as the truth
 * and never computes balances, meters or outcomes itself. Times are ISO strings
 * on the server clock: countdowns use `serverTime`, never the device clock.
 */

/** Why the server refused an intent. Stable codes so the client can show its own words. */
export const REJECT_REASONS = [
  "invalid",
  "rate_limited",
  "unknown_target",
  "too_far",
  "not_signed_in",
  "starving",
  "no_energy",
  "blackout",
  "shift_active",
  "daily_limit",
  "insufficient_funds",
  "already_full",
  "rent_not_due",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export type RentStatus = "ok" | "due" | "overdue";

/** Everything the HUD shows. Sent on join and after every intent that changes it. */
export interface StatsMessage {
  serverTime: string;
  /** Wallet balance in kobo. A number is safe: balances are capped below 2^53. */
  balanceKobo: number;
  /** 0-100 whole numbers. Hunger is fullness: 0 means starving. */
  hunger: number;
  energy: number;
  rentDueAt: string;
  rentStatus: RentStatus;
  rentAmountKobo: number;
  activeShift: { jobId: string; endsAt: string } | null;
  shiftsToday: number;
  maxShiftsToday: number;
  blackoutEndsAt: string | null;
  /** Percent added to food prices right now (0 when no price rise is active). */
  foodPriceRisePercent: number;
}

/** A toast: something happened to the player (an event, a shift paid out). */
export interface NoticeMessage {
  kind: "event" | "shift_paid";
  title: string;
  message: string;
}

export interface RejectedMessage {
  intent: string;
  reason: RejectReason;
}

/** The player walked up to something and pressed interact. */
export interface InteractionMessage {
  targetId: string;
  kind: "job_site" | "food_vendor" | "home" | "bus_stop" | "fuel_station";
}

export const SERVER_MESSAGES = {
  stats: "stats",
  notice: "notice",
  rejected: "rejected",
  interaction: "interaction",
} as const;
