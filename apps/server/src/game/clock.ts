/**
 * The server clock is the only clock (CLAUDE.md: game time is real time). Never
 * read `Date.now()` in game code: ask a GameClock, so tests and the dev-only
 * time multiplier can control it.
 */
export interface GameClock {
  now(): Date;
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

  now(): Date {
    return new Date(this.anchor + (this.realNow() - this.anchor) * this.multiplier);
  }
}

/** A clock tests move by hand. */
export class ManualClock implements GameClock {
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
