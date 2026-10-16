import { createPrismaClient } from "@japalife/db";
import { DEFAULT_SERVER_PORT } from "@japalife/shared";
import { loadContentOrExit } from "./content/loadContent";
import { createGameServer } from "./createGameServer";
import { loadRootEnv } from "./env";
import { createGameSystems, startBalanceWatch, startGameLoop } from "./game";

loadRootEnv();

const port = Number(process.env["SERVER_PORT"] ?? DEFAULT_SERVER_PORT);

// Refuses to start on bad content, printing every problem and exiting with code 1.
const content = loadContentOrExit(process.env["CONTENT_DIR"]);
console.log(`content ok: ${Object.keys(content.cities).length} city, ${content.jobs.jobs.length} job(s)`);
for (const todo of content.todos) console.warn(`content TODO ${todo}`);

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

const db = createPrismaClient(databaseUrl);
// Refuses to start if GAME_CLOCK is set in production.
const game = createGameSystems({ db, content });
const stopLoop = startGameLoop(game);
const stopBalanceWatch = startBalanceWatch(game);

const server = createGameServer(game);
// Colyseus handles SIGINT/SIGTERM itself and calls this on the way out.
server.onShutdown(async () => {
  stopLoop();
  stopBalanceWatch();
  await db.$disconnect();
});
await server.listen(port);
console.log(`japalife server listening on :${port}`);
