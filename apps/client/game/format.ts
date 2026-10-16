import type { RejectReason } from "@japalife/shared";

const NAIRA = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const NAIRA_WITH_KOBO = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2 });

/**
 * Kobo to "₦20,000". Display only: dividing by 100 in floating point is fine for
 * showing a number, never for money maths (the server does all of that in integers).
 */
export function formatNaira(kobo: number): string {
  return kobo % 100 === 0 ? NAIRA.format(kobo / 100) : NAIRA_WITH_KOBO.format(kobo / 100);
}

/** A countdown: "29d 23h", "5h 03m", or "12:34" under an hour. Negative becomes zero. */
export function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value: number): string => String(value).padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${two(minutes)}m`;
  return `${minutes}:${two(seconds)}`;
}

/** What to tell the player when the server refuses something. */
export const REJECTION_TEXT: Record<RejectReason, string> = {
  invalid: "That didn't work. Try again.",
  rate_limited: "Easy. One thing at a time.",
  unknown_target: "There's nothing to do here.",
  too_far: "Move closer first.",
  not_signed_in: "You're not signed in.",
  starving: "You're too hungry to work. Go and chop something first.",
  no_energy: "You're too tired to work. Rest a bit first.",
  blackout: "NEPA has taken light. No work until power comes back.",
  shift_active: "You're already on a shift.",
  daily_limit: "That's enough work for today. Come back tomorrow.",
  insufficient_funds: "Not enough money for that.",
  already_full: "You're already full.",
  rent_not_due: "Rent isn't due yet.",
};
