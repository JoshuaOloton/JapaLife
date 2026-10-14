import { DEFAULT_SERVER_PORT } from "@japalife/shared";
import { createGameServer } from "./createGameServer";

const port = Number(process.env["SERVER_PORT"] ?? DEFAULT_SERVER_PORT);

await createGameServer().listen(port);
console.log(`japalife server listening on :${port}`);
