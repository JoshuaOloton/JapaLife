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
  /** The generator's jerrycan cannot hold that much more fuel. */
  "tank_full",
  /** The request was already answered (a double tap, or another tab). */
  "already_answered",
  /** The request ran out before the answer arrived; it counted as declined. */
  "choice_expired",
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
  morale: number;
  /** Relationship with family back home, 0-100. */
  family: number;
  /** True while morale is low enough to slow energy and cut shift pay. */
  lowMorale: boolean;
  /** The city's IANA time zone, for the HUD clock. */
  timeZone: string;
  /** The city's calendar day ("YYYY-MM-DD") the player started on: day 1. */
  startedOn: string;
  isNight: boolean;
  /** Hours of generator running time in the tank, to one decimal place. */
  generatorFuelHours: number;
  rentDueAt: string;
  rentStatus: RentStatus;
  rentAmountKobo: number;
  /** When the next late fee is charged if rent is still unpaid, and how much it is. */
  rentLateFeeAt: string;
  rentLateFeeKobo: number;
  /** Inbox messages the player has not seen (things that happened while away). */
  unreadInbox: number;
  activeShift: { jobId: string; endsAt: string } | null;
  shiftsToday: number;
  maxShiftsToday: number;
  blackoutEndsAt: string | null;
  /** Percent added to prices by all the rises so far, compounded, to one decimal place. */
  foodPriceRisePercent: number;
  fuelPriceRisePercent: number;
  /** A request waiting for the player's answer (the event card), or null. */
  pendingChoice: PendingChoice | null;
}

/** A request the player must answer, e.g. family asking for money. */
export interface PendingChoice {
  choiceId: string;
  title: string;
  /** Who is asking and why, with the amount already written in. */
  message: string;
  amountKobo: number;
  /** After this the request counts as declined. */
  expiresAt: string;
  payLabel: string;
  declineLabel: string;
}

export const NOTICE_KINDS = ["event", "shift_paid", "rent"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** A toast: something happened to the player (an event, a shift paid out, a late fee). Also kept in the inbox. */
export interface NoticeMessage {
  kind: NoticeKind;
  title: string;
  message: string;
}

/** One message in the player's inbox. */
export interface InboxEntry extends NoticeMessage {
  id: string;
  /** When it happened, on the server clock. */
  at: string;
  /** Not seen before this inbox was opened. */
  unread: boolean;
}

/** Reply to `openInbox`: the latest messages, newest first. Opening marks them all read. */
export interface InboxMessage {
  messages: InboxEntry[];
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

/** Something for sale at a shop, at the price the server will charge right now. */
export interface ShopOffer {
  itemId: string;
  name: string;
  priceKobo: number;
  generatorHours: number;
}

/**
 * The player walked up to something and pressed interact. The reply carries
 * what the place offers, so the client never needs its own copy of prices or pay.
 * Rent is not repeated here: it is in `StatsMessage`.
 */
export type InteractionMessage =
  | { targetId: string; kind: "job_site"; job: JobOffer }
  | { targetId: string; kind: "food_vendor"; menu: MenuItem[] }
  | { targetId: string; kind: "fuel_station"; items: ShopOffer[] }
  | { targetId: string; kind: "home" | "bus_stop" };

export const SERVER_MESSAGES = {
  stats: "stats",
  notice: "notice",
  rejected: "rejected",
  interaction: "interaction",
  inbox: "inbox",
  /**
   * Sent once on join. The payload is a `DistrictLayout`: the district's
   * buildings, roads, signs and walkable area, plus the models it uses. The
   * client draws the world and predicts its own walking from it, so the layout
   * is defined only on the server.
   */
  district: "district",
} as const;
