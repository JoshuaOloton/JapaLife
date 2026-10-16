/**
 * The server clock is the only clock (CLAUDE.md: game time is real time). Never
 * read `Date.now()` in game code: ask a GameClock, so tests and the dev-only
 * time multiplier can control it.
 */
export interface GameClock {
  now(): Date;
  /** Game time per unit of real time: 1 in production, more under GAME_CLOCK. */
  readonly speed: number;
}

/**
 * Real time, optionally sped up for play-testing. With a multiplier of 60 one
 * real minute is one game hour, so a month of rent takes about 12 real hours.
 * The speed-up starts from the moment the server boots, so after a restart the
 * game clock is back in step with real time; stored timestamps from a sped-up
 * session will then lie in the future. That is fine for a dev-only tool.
 */
export class MultiplierClock implements GameClock {
  private readonly anchor: number;

  constructor(
    private readonly multiplier = 1,
    private readonly realNow: () => number = Date.now,
  ) {
    this.anchor = realNow();
  }

  get speed(): number {
    return this.multiplier;
  }

  now(): Date {
    return new Date(this.anchor + (this.realNow() - this.anchor) * this.multiplier);
  }
}

/** A clock tests move by hand. */
export class ManualClock implements GameClock {
  readonly speed = 1;

  constructor(private current: Date = new Date("2026-10-15T08:00:00.000Z")) {}

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * Builds the clock from the `GAME_CLOCK` environment setting (a speed-up
 * multiplier). It is dev-only: the server refuses to start with it set when
 * NODE_ENV=production, so a real player can never get a fast clock.
 */
export function createGameClock(env: NodeJS.ProcessEnv = process.env): GameClock {
  const setting = env["GAME_CLOCK"];
  if (setting === undefined || setting === "") return new MultiplierClock(1);
  if (env["NODE_ENV"] === "production") {
    throw new Error("GAME_CLOCK is a dev-only setting and is refused when NODE_ENV=production");
  }
  const multiplier = Number(setting);
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100_000) {
    throw new Error(`GAME_CLOCK must be a number between 0 and 100000, got "${setting}"`);
  }
  return new MultiplierClock(multiplier);
}

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * The calendar day ("YYYY-MM-DD") in a real IANA time zone. Daily limits reset
 * at midnight Lagos time, not at midnight UTC.
 */
export function calendarDay(date: Date, timeZone: string): string {
  // The en-CA locale formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/** The next calendar day after "YYYY-MM-DD" (pure date arithmetic, no time zone). */
export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** How far ahead of UTC the zone's clocks are at `date`, in ms (Lagos: +1 hour). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  let format = offsetFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    offsetFormatters.set(timeZone, format);
  }
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(format.formatToParts(date).find((p) => p.type === type)?.value);
  const wallClockAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return wallClockAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant when the zone's clocks read `hour`:00 on `day`. Handles daylight saving (London, Toronto). */
export function zonedInstant(day: string, hour: number, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const wallClock = Date.UTC(year, month - 1, date, hour);
  let instant = wallClock - zoneOffsetMs(new Date(wallClock), timeZone);
  // Near a daylight-saving change the first guess uses the wrong offset; one correction fixes it.
  const corrected = zoneOffsetMs(new Date(instant), timeZone);
  instant = wallClock - corrected;
  return new Date(instant);
}

export interface NightHours {
  /** Local hour night starts, in the evening. */
  startsHour: number;
  /** Local hour night ends, the next morning. */
  endsHour: number;
}

export interface Interval {
  start: Date;
  end: Date;
}

/** Every night (or part of one) between `from` and `to`, in the city's local time. */
export function nightIntervals(from: Date, to: Date, timeZone: string, night: NightHours): Interval[] {
  const nights: Interval[] = [];
  if (to <= from) return nights;
  // Start a day early: the night that began yesterday evening may still be running.
  let day = calendarDay(new Date(from.getTime() - MS_PER_DAY), timeZone);
  const lastDay = calendarDay(to, timeZone);
  for (;;) {
    const start = zonedInstant(day, night.startsHour, timeZone);
    if (start >= to) break;
    const end = zonedInstant(nextDay(day), night.endsHour, timeZone);
    if (end > from) nights.push({ start: start < from ? from : start, end: end > to ? to : end });
    if (day === lastDay) break;
    day = nextDay(day);
  }
  return nights;
}

/** Whether it is night in the city at `date`. */
export function isNight(date: Date, timeZone: string, night: NightHours): boolean {
  const day = calendarDay(date, timeZone);
  return date >= zonedInstant(day, night.startsHour, timeZone) || date < zonedInstant(day, night.endsHour, timeZone);
}
