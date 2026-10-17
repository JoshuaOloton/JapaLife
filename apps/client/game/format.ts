import { COPY, fill, type Interactable, type RejectReason } from "@japalife/shared";

export { formatNaira } from "@japalife/shared";

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

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  let format = cache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    cache.set(timeZone, format);
  }
  return format;
}

/**
 * "Day 12 · 7:45 PM": the player's own day count (day 1 is the day they
 * started, in the city's calendar) and the city's local time. `now` is server
 * time, never the device clock.
 */
export function formatGameClock(now: number, startedOn: string, timeZone: string): string {
  const today = formatterFor(dayFormatters, "en-CA", timeZone, {}).format(now); // en-CA gives YYYY-MM-DD
  const day = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`)) / 86_400_000) + 1;
  const time = formatterFor(timeFormatters, "en-US", timeZone, { hour: "numeric", minute: "2-digit", hour12: true })
    .format(now)
    // Some browsers put a narrow no-break space before AM/PM.
    .replace(/\s/g, " ");
  return fill(COPY.hud.clock, { day: Math.max(1, day), time });
}

/** What to tell the player when the server refuses something. */
export function rejectionText(reason: RejectReason): string {
  // A newer server may send a reason this client does not know yet.
  return Object.hasOwn(COPY.rejections, reason) ? COPY.rejections[reason] : COPY.rejections.invalid;
}

/** The action button's text at a place: its own prompt, or its kind's template. */
export function placePrompt(place: Interactable): string {
  return place.prompt ?? fill(COPY.places.prompts[place.kind], { place: place.label });
}
