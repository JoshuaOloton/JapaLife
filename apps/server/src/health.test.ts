import { Client } from "@colyseus/sdk";
import { DISTRICT_ROOM_NAME } from "@japalife/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "./createGameServer";
import { createHarness, type Harness } from "./test/gameHarness";

const TEST_PORT = 2599;

describe("game server", () => {
  let h: Harness;
  let server: ReturnType<typeof createGameServer>;

  beforeAll(async () => {
    h = await createHarness();
    server = createGameServer(h.game);
    await server.listen(TEST_PORT);
  });

  afterAll(async () => {
    await server.gracefullyShutdown(false);
    await h.close();
  });

  it("answers /health with ok", async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("lets a client join a district room", async () => {
    const client = new Client(`ws://127.0.0.1:${TEST_PORT}`);
    const room = await client.joinOrCreate(DISTRICT_ROOM_NAME, { playerId: "health-check" });
    expect(room.roomId).toBeTruthy();
    await room.leave();
  });
});
