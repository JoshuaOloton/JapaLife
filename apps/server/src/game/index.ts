import type { PrismaClient } from "@japalife/db";
import { BalanceWatch } from "../economy/balanceWatch";
import { Ledger } from "../economy/ledger";
import { WalletService } from "../economy/wallet";
import type { GameContent } from "../content/loadContent";
import { logError } from "../log";
import { type GameClock, createGameClock } from "./clock";
import type { GameDeps } from "./deps";
import { DistrictMap } from "./district";
import { EventService } from "./events";
import { FoodService } from "./food";
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
  stats: StatsService;
  notices: NoticeBus;
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

  const players = new PlayerService(deps);
  const events = new EventService(deps, players);
  const jobs = new JobService(deps, players, events);
  const rent = new RentService(deps);
  const food = new FoodService(deps, players, events);
  const shop = new ShopService(deps, players, events);
  const stats = new StatsService(deps, players, jobs, rent, events);

  const districts = new Map<string, DistrictMap>();
  for (const city of Object.values(content.cities)) {
    for (const district of city.districts) districts.set(district.id, new DistrictMap(district));
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
    stats,
    notices: new NoticeBus(),
    mutex: new KeyedMutex(),
    balanceWatch: new BalanceWatch(db, content, clock.speed, lagos.timeZone),
  };
}

/**
 * The scheduled job: pays every finished shift, including for players who are
 * offline (time passes without them). Returns a function that stops it.
 */
export function startGameLoop(game: GameSystems, intervalMs = 30_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // a slow run must not overlap the next one
    running = true;
    game.jobs
      .settleDueShifts(game.clock.now())
      .then((paid) => {
        for (const shift of paid) {
          game.notices.publish(shift.playerId, {
            kind: "shift_paid",
            title: "Shift pay",
            message: `You earned N${shift.amountKobo / 100} for your shift.`,
          });
        }
      })
      .catch((error: unknown) => logError("game loop: settling shifts failed", error))
      .finally(() => {
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
