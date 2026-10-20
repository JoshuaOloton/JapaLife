import type { PrismaClient } from "@japalife/db";
import { BalanceWatch } from "../economy/balanceWatch";
import { Ledger } from "../economy/ledger";
import { WalletService } from "../economy/wallet";
import type { GameContent } from "../content/loadContent";
import { logError } from "../log";
import { ChoiceService } from "./choices";
import { type GameClock, createGameClock } from "./clock";
import type { GameDeps } from "./deps";
import { DistrictMap } from "./district";
import { EventService } from "./events";
import { FoodService } from "./food";
import { InboxService } from "./inbox";
import { JobService } from "./jobs";
import { KeyedMutex } from "./keyedMutex";
import { NoticeBus } from "./noticeBus";
import { PlayerService } from "./players";
import { RentService } from "./rent";
import { ShopService } from "./shop";
import { StatsService } from "./stats";

/** Every game system, wired together. Rooms receive this and call into it. */
export interface GameSystems {
  content: GameContent;
  clock: GameClock;
  /** Walkable districts by id. */
  districts: ReadonlyMap<string, DistrictMap>;
  players: PlayerService;
  jobs: JobService;
  rent: RentService;
  food: FoodService;
  shop: ShopService;
  events: EventService;
  /** Answers and expiries for events that ask the player something (black tax). */
  choices: ChoiceService;
  stats: StatsService;
  /** Live toasts for connected players. Game code tells players through `inbox`, which also uses this. */
  notices: NoticeBus;
  /** Every notice to a player, kept for when they come back. */
  inbox: InboxService;
  /** Serialises the work of one player (see KeyedMutex). */
  mutex: KeyedMutex;
  /** Flags players who receive money faster than the rules allow. */
  balanceWatch: BalanceWatch;
}

export interface GameSystemsOptions {
  db: PrismaClient;
  content: GameContent;
  /** Defaults to the real clock, or the dev multiplier from GAME_CLOCK. */
  clock?: GameClock;
  wallet?: WalletService;
  rng?: () => number;
}

export function createGameSystems(options: GameSystemsOptions): GameSystems {
  const { db, content } = options;
  const lagos = content.cities["lagos"];
  if (!lagos) throw new Error("content is missing the Lagos city");

  const clock = options.clock ?? createGameClock();
  const deps: GameDeps = {
    db,
    content,
    clock,
    wallet: options.wallet ?? new WalletService(new Ledger(db)),
    rng: options.rng ?? Math.random,
    timeZone: lagos.timeZone,
    night: lagos.night,
  };

  const notices = new NoticeBus();
  const inbox = new InboxService(deps, notices);
  const players = new PlayerService(deps);
  const events = new EventService(deps, players, inbox);
  const jobs = new JobService(deps, players, events, inbox);
  const rent = new RentService(deps, players, inbox);
  const food = new FoodService(deps, players, events);
  const shop = new ShopService(deps, players, events);
  const choices = new ChoiceService(deps, players, inbox);
  const stats = new StatsService(deps, players, jobs, rent, events, choices, inbox);

  const districts = new Map<string, DistrictMap>();
  for (const city of Object.values(content.cities)) {
    for (const district of city.districts) districts.set(district.id, new DistrictMap(district, content.models, content.propKinds));
  }

  return {
    content,
    clock,
    districts,
    players,
    jobs,
    rent,
    food,
    shop,
    events,
    choices,
    stats,
    notices,
    inbox,
    mutex: new KeyedMutex(),
    balanceWatch: new BalanceWatch(db, content, clock.speed, lagos.timeZone),
  };
}

/**
 * Settles every request left unanswered past its time (it counts as declined),
 * each under its player's mutex because it changes their meters.
 */
export async function expireDueChoices(game: GameSystems, now: Date): Promise<void> {
  for (const playerId of await game.choices.playersWithExpired(now)) {
    await game.mutex.run(playerId, () => game.choices.expireDue(playerId, now));
  }
}

/** Charges every late fee that has fallen due, each under its player's mutex (it changes morale). */
export async function chargeDueLateFees(game: GameSystems, now: Date): Promise<void> {
  for (const playerId of await game.rent.playersWithLateFeesDue(now)) {
    await game.mutex.run(playerId, () => game.rent.chargeLateFees(playerId, now));
  }
}

/**
 * The scheduled job: pays every finished shift, expires unanswered requests and
 * charges late rent fees, including for players who are offline (time passes
 * without them; they find it all in their inbox). Returns a function that stops it.
 */
export function startGameLoop(game: GameSystems, intervalMs = 30_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // a slow run must not overlap the next one
    running = true;
    const now = game.clock.now();
    const shifts = game.jobs
      .settleDueShifts(now)
      .catch((error: unknown) => logError("game loop: settling shifts failed", error));
    const choices = expireDueChoices(game, now).catch((error: unknown) =>
      logError("game loop: expiring requests failed", error),
    );
    const lateFees = chargeDueLateFees(game, now).catch((error: unknown) =>
      logError("game loop: charging late fees failed", error),
    );
    void Promise.all([shifts, choices, lateFees]).finally(() => {
      running = false;
    });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * The scheduled abnormal-balance check. Flags are recorded for review and
 * logged by player id and reason only (amounts stay in the database).
 * Returns a function that stops it.
 */
export function startBalanceWatch(game: GameSystems, intervalMs = 10 * 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    game.balanceWatch
      .scan()
      .then((flags) => {
        for (const flag of flags) {
          console.warn(`balance flag: player ${flag.playerId} received too much ${flag.currency} as ${flag.reason}`);
        }
      })
      .catch((error: unknown) => logError("balance watch failed", error))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
