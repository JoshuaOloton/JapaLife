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

/** A shift on offer at a job site. */
export interface JobOffer {
  jobId: string;
  name: string;
  payKobo: number;
  shiftMinutes: number;
  energyCost: number;
}

/** One dish on a vendor's menu, at the price the server will charge right now (price rises included). */
export interface MenuItem {
  itemId: string;
  name: string;
  priceKobo: number;
  hungerRestored: number;
  energyRestored: number;
}

/**
 * The player walked up to something and pressed interact. The reply carries
 * what the place offers, so the client never needs its own copy of prices or pay.
 * Rent is not repeated here: it is in `StatsMessage`.
 */
export type InteractionMessage =
  | { targetId: string; kind: "job_site"; job: JobOffer }
  | { targetId: string; kind: "food_vendor"; menu: MenuItem[] }
  | { targetId: string; kind: "home" | "bus_stop" | "fuel_station" };

export const SERVER_MESSAGES = {
  stats: "stats",
  notice: "notice",
  rejected: "rejected",
  interaction: "interaction",
  /**
   * Sent once on join. The payload is the district's `DistrictConfig`: its
   * buildings, roads, signs and walkable area. The client draws the world and
   * predicts its own walking from it, so the layout is defined only on the server.
   */
  district: "district",
} as const;
