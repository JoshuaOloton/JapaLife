import { Client, type Room } from "@colyseus/sdk";
import type { Server } from "@colyseus/core";
import {
  DISTRICT_ROOM_NAME,
  PLAYER_RADIUS,
  PLAYER_SPEED_UNITS_PER_SECOND,
  type DistrictConfig,
  type InteractionMessage,
  type NoticeMessage,
  type RejectedMessage,
  type StatsMessage,
} from "@japalife/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../createGameServer";
import { startGameLoop } from "../game";
import { createHarness, gatherEverythingAtSpawn, HOUR_MS, type Harness } from "../test/gameHarness";

const TEST_PORT = 2599;
const URL = `ws://127.0.0.1:${TEST_PORT}`;

let h: Harness;
let server: Server;
const open: Room[] = [];

beforeAll(async () => {
  // Everything stands at the spawn point, so tests do not need to walk anywhere,
  // plus one long wall to the north (z = 6) for the collision test.
  h = await createHarness((content) => {
    gatherEverythingAtSpawn(content);
    content.cities["lagos"]!.districts[0]!.buildings.push({
      id: "test-wall",
      name: "Test wall",
      x: 0,
      z: 6,
      halfWidth: 30,
      halfDepth: 1,
      height: 3,
      colour: "#ffffff",
    });
  });
  server = createGameServer(h.game);
  await server.listen(TEST_PORT);
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((room) => room.leave().catch(() => undefined)));
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
  await h.close();
});

interface Session {
  room: Room;
  stats: StatsMessage[];
  rejected: RejectedMessage[];
  notices: NoticeMessage[];
  layouts: DistrictConfig[];
}

async function join(playerId: string): Promise<Session> {
  const room = await new Client(URL).joinOrCreate(DISTRICT_ROOM_NAME, { playerId });
  open.push(room);
  const session: Session = { room, stats: [], rejected: [], notices: [], layouts: [] };
  room.onMessage("district", (m: DistrictConfig) => session.layouts.push(m));
  room.onMessage("stats", (m: StatsMessage) => session.stats.push(m));
  room.onMessage("rejected", (m: RejectedMessage) => session.rejected.push(m));
  room.onMessage("notice", (m: NoticeMessage) => session.notices.push(m));
  return session;
}

async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("joining", () => {
  it("signs the player in, gives the starting balance and shows the HUD numbers", async () => {
    const s = await join("alice");
    await until(() => s.stats.length > 0, "the first stats message");
    expect(s.stats.at(-1)).toMatchObject({
      balanceKobo: 2_000_000,
      hunger: 80,
      energy: 100,
      rentStatus: "ok",
      activeShift: null,
    });
  });

  it("refuses an invalid or missing identity", async () => {
    await expect(new Client(URL).joinOrCreate(DISTRICT_ROOM_NAME, {})).rejects.toThrow();
    await expect(
      new Client(URL).joinOrCreate(DISTRICT_ROOM_NAME, { playerId: "../etc/passwd" }),
    ).rejects.toThrow();
  });

  it("refuses the same player twice", async () => {
    await join("bob");
    await expect(new Client(URL).joinOrCreate(DISTRICT_ROOM_NAME, { playerId: "bob" })).rejects.toThrow();
  });

  it("refuses everyone in production, where the dev identity stub must not work", async () => {
    const before = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      await expect(
        new Client(URL).joinOrCreate(DISTRICT_ROOM_NAME, { playerId: "mallory" }),
      ).rejects.toThrow();
    } finally {
      process.env["NODE_ENV"] = before;
    }
  });
});

describe("intents", () => {
  it("rejects malformed and unknown intents without crashing", async () => {
    const s = await join("carol");
    await until(() => s.stats.length > 0, "stats");
    s.room.send("work", { jobId: 5 });
    s.room.send("teleport", { x: 0, z: 0 });
    s.room.send("payRent", { extra: "field" });
    await until(() => s.rejected.length >= 3, "three rejections");
    expect(s.rejected.every((r) => r.reason === "invalid")).toBe(true);
  });

  it("ignores attempts to set the price or reward: a client sends intents, never outcomes", async () => {
    const s = await join("dave");
    await until(() => s.stats.length > 0, "stats");
    s.room.send("buyFood", { itemId: "jollof-rice", quantity: 1, priceKobo: 1 });
    s.room.send("work", { jobId: "office-assistant", payKobo: 99_999_999 });
    await until(() => s.rejected.length >= 2, "rejections");
    expect(s.stats.at(-1)?.balanceKobo).toBe(2_000_000);
  });

  it("starts a shift and spends energy", async () => {
    const s = await join("erin");
    await until(() => s.stats.length > 0, "stats");
    s.room.send("work", { jobId: "office-assistant" });
    await until(() => s.stats.at(-1)?.activeShift != null, "the shift to start");
    expect(s.stats.at(-1)).toMatchObject({ energy: 70, shiftsToday: 1 });
  });

  it("lets only one of two simultaneous work intents through", async () => {
    const s = await join("frank");
    await until(() => s.stats.length > 0, "stats");
    s.room.send("work", { jobId: "office-assistant" });
    s.room.send("work", { jobId: "office-assistant" });
    await until(() => s.rejected.length >= 1, "the second to be refused");
    expect(s.rejected[0]?.reason).toBe("shift_active");
    expect(await h.db.shift.count({ where: { playerId: "frank" } })).toBe(1);
  });

  it("buys food, charging the server's price", async () => {
    const s = await join("gina");
    await until(() => s.stats.length > 0, "stats");
    s.room.send("buyFood", { itemId: "agege-bread", quantity: 1 });
    await until(() => (s.stats.at(-1)?.balanceKobo ?? 0) < 2_000_000, "the purchase");
    expect(s.stats.at(-1)?.balanceKobo).toBe(2_000_000 - 150_000);
  });

  it("answers interact with what the thing is", async () => {
    const s = await join("hana");
    const interactions: unknown[] = [];
    s.room.onMessage("interaction", (m) => interactions.push(m));
    await until(() => s.stats.length > 0, "stats");
    s.room.send("interact", { targetId: "yaba-bus-stop" });
    s.room.send("interact", { targetId: "nowhere" });
    await until(() => interactions.length >= 1 && s.rejected.length >= 1, "both answers");
    expect(interactions[0]).toEqual({ targetId: "yaba-bus-stop", kind: "bus_stop" });
    expect(s.rejected[0]?.reason).toBe("unknown_target");
  });

  it("answers interact with the shift on offer and the menu at today's prices", async () => {
    const s = await join("ines");
    const interactions: InteractionMessage[] = [];
    s.room.onMessage("interaction", (m: InteractionMessage) => interactions.push(m));
    await until(() => s.stats.length > 0, "stats");
    s.room.send("interact", { targetId: "yaba-office" });
    s.room.send("interact", { targetId: "mama-put-buka" });
    await until(() => interactions.length >= 2, "both answers");
    const office = interactions.find((m) => m.kind === "job_site");
    const buka = interactions.find((m) => m.kind === "food_vendor");
    expect(office?.kind === "job_site" && office.job).toMatchObject({
      jobId: "office-assistant",
      payKobo: 500_000,
      shiftMinutes: 30,
      energyCost: 30,
    });
    expect(buka?.kind === "food_vendor" && buka.menu.find((item) => item.itemId === "agege-bread")).toMatchObject({
      priceKobo: 150_000,
      hungerRestored: 20,
    });
  });

  it("rate-limits a client that floods intents", async () => {
    const s = await join("ivan");
    await until(() => s.stats.length > 0, "stats");
    for (let i = 0; i < 40; i++) s.room.send("payRent", {});
    await until(() => s.rejected.some((r) => r.reason === "rate_limited"), "a rate-limit rejection");
  });
});

describe("movement", () => {
  it("moves at the server's speed, never faster", async () => {
    const s = await join("judy");
    await until(() => s.stats.length > 0, "stats");
    const mine = () => s.room.state.players.get(s.room.sessionId);
    await until(() => mine() !== undefined, "own position");

    s.room.send("move", { seq: 1, dx: 1, dz: 0 });
    await sleep(1000);
    s.room.send("move", { seq: 2, dx: 0, dz: 0 });
    await sleep(150);

    const x = mine().x as number;
    expect(x).toBeGreaterThan(PLAYER_SPEED_UNITS_PER_SECOND * 0.5);
    expect(x).toBeLessThan(PLAYER_SPEED_UNITS_PER_SECOND * 1.5);
  });

  it("rejects a direction longer than 1 (a speed hack)", async () => {
    const s = await join("karl");
    await until(() => s.stats.length > 0, "stats");
    s.room.send("move", { seq: 1, dx: 1, dz: 1 });
    await until(() => s.rejected.length >= 1, "the rejection");
    expect(s.rejected[0]?.reason).toBe("invalid");
  });

  it("cannot be walked through a building: the server stops the player at its footprint", async () => {
    const s = await join("wally");
    await until(() => s.stats.length > 0, "stats");
    s.room.send("move", { seq: 1, dx: 0, dz: 1 });
    await sleep(2200); // 8.8 units of walking, but the wall's face is 5 units away
    s.room.send("move", { seq: 2, dx: 0, dz: 0 });
    await sleep(150);
    const z = s.room.state.players.get(s.room.sessionId).z as number;
    expect(z).toBeLessThanOrEqual(5 - PLAYER_RADIUS + 1e-6);
    expect(z).toBeGreaterThan(3); // it did walk up to the wall
  });

  it("sends the district layout on join, so the client draws and predicts from one source", async () => {
    const s = await join("layla");
    await until(() => s.layouts.length > 0, "the district layout");
    const layout = s.layouts[0]!;
    expect(layout.id).toBe("yaba");
    expect(layout.buildings.some((b) => b.id === "yaba-office-block")).toBe(true);
    expect(layout.roads.length).toBeGreaterThan(0);
    expect(layout.interactables.every((i) => i.label.length > 0)).toBe(true);
  });

  it("stays inside the district", async () => {
    const s = await join("lena");
    await until(() => s.stats.length > 0, "stats");
    s.room.send("move", { seq: 1, dx: -1, dz: 0 });
    await sleep(300);
    const x = s.room.state.players.get(s.room.sessionId).x as number;
    expect(Math.abs(x)).toBeLessThanOrEqual(60);
  });

  it("refuses work from too far away", async () => {
    const s = await join("mike");
    await until(() => s.stats.length > 0, "stats");
    s.room.send("move", { seq: 1, dx: 1, dz: 0 });
    await sleep(1200); // about 4.8 units: past the 3 unit reach
    s.room.send("move", { seq: 2, dx: 0, dz: 0 });
    await sleep(100);
    s.room.send("work", { jobId: "office-assistant" });
    await until(() => s.rejected.length >= 1, "the rejection");
    expect(s.rejected[0]?.reason).toBe("too_far");
  });
});

describe("the scheduled job", () => {
  it("pays a finished shift and tells a connected player", async () => {
    const stop = startGameLoop(h.game, 50);
    try {
      const s = await join("nina");
      await until(() => s.stats.length > 0, "stats");
      s.room.send("work", { jobId: "office-assistant" });
      await until(() => s.stats.at(-1)?.activeShift != null, "the shift to start");

      h.clock.advance(HOUR_MS); // the shift is now over
      await until(() => s.notices.some((n) => n.kind === "shift_paid"), "the pay notice");
      expect(s.notices.filter((n) => n.kind === "shift_paid")).toHaveLength(1);
      const paid = await h.game.stats.build("nina", h.clock.now());
      expect(paid?.balanceKobo).toBe(2_500_000);
    } finally {
      stop();
    }
  });
});
