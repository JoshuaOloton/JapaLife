import { createPrismaClient } from "@japalife/db";
import { DEFAULT_SERVER_PORT } from "@japalife/shared";
import { loadContent } from "./content/loadContent";
import { createGameServer } from "./createGameServer";
import { loadRootEnv } from "./env";
import { createGameSystems, startGameLoop } from "./game";

loadRootEnv();

const port = Number(process.env["SERVER_PORT"] ?? DEFAULT_SERVER_PORT);
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

// Refuse to start on bad content (throws a ContentError listing every problem).
const content = loadContent();
console.log(`content ok: ${Object.keys(content.cities).length} city, ${content.jobs.jobs.length} job(s)`);
for (const todo of content.todos) console.warn(`content TODO ${todo}`);

const db = createPrismaClient(databaseUrl);
// Refuses to start if GAME_CLOCK is set in production.
const game = createGameSystems({ db, content });
const stopLoop = startGameLoop(game);

const server = createGameServer(game);
// Colyseus handles SIGINT/SIGTERM itself and calls this on the way out.
server.onShutdown(async () => {
  stopLoop();
  await db.$disconnect();
});
await server.listen(port);
console.log(`japalife server listening on :${port}`);
