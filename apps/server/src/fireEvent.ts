import { createPrismaClient } from "@japalife/db";
import { GAME_EVENT_IDS, type GameEventId } from "@japalife/shared";
import { loadContentOrExit } from "./content/loadContent";
import { loadRootEnv } from "./env";
import { createGameSystems } from "./game";

/**
 * Play-testing helper: fires a random event now instead of waiting days for the
 * dice. `pnpm fire-event black_tax <playerId>`. Connected players see it at
 * the room's next event check (within a minute).
 */

loadRootEnv();

if (process.env["NODE_ENV"] === "production") {
  throw new Error("refusing to fire test events in production");
}
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

const [eventId, playerId] = process.argv.slice(2);
if (!GAME_EVENT_IDS.includes(eventId as GameEventId) || !playerId) {
  console.error(`usage: pnpm fire-event <${GAME_EVENT_IDS.join("|")}> <playerId>`);
  process.exit(1);
}

const db = createPrismaClient(databaseUrl, { maxConnections: 2 });
try {
  const game = createGameSystems({ db, content: loadContentOrExit(process.env["CONTENT_DIR"]) });
  if (!(await game.players.getState(playerId))) {
    console.error(`no player "${playerId}" yet: join the game first`);
    process.exit(1);
  }
  const fired = await game.events.fireNow(playerId, eventId as GameEventId, game.clock.now());
  console.log(
    fired
      ? `fired ${eventId} for ${playerId}; it shows within a minute`
      : `${playerId} already has a request waiting: answer it first`,
  );
} finally {
  await db.$disconnect();
}
