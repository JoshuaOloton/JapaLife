import { DEFAULT_SERVER_PORT } from "@japalife/shared";
import { createGameServer } from "./createGameServer";

import { loadContent } from "./content/loadContent";

const port = Number(process.env["SERVER_PORT"] ?? DEFAULT_SERVER_PORT);

// Refuse to start on bad content (throws a ContentError listing every problem).
// Slice 4 passes this to the room and game systems.
const content = loadContent();
console.log(`content ok: ${Object.keys(content.cities).length} city, ${content.jobs.jobs.length} job(s)`);
for (const todo of content.todos) console.warn(`content TODO ${todo}`);

await createGameServer().listen(port);
console.log(`japalife server listening on :${port}`);
