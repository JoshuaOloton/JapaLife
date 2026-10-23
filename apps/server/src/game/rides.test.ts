import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../test/gameHarness";
import type { DistrictMap } from "./district";

const PLAYER = "rider";
const STARTING_BALANCE = 2_000_000n; // content/economy/ngn.json
const DANFO_FARE = 50_000n; // content/economy/ngn.json transport

let h: Harness;
let yaba: DistrictMap;

beforeEach(async () => {
  await h?.close();
  h = await createHarness();
  await h.game.players.ensurePlayer(PLAYER);
  yaba = h.game.districts.get("yaba") as DistrictMap;
  h.setRng(0.99); // no task force unless a test asks
});

afterAll(() => h?.close());

const balance = (): Promise<bigint> => h.game.stats.build(PLAYER, h.clock.now()).then((s) => BigInt(s?.balanceKobo ?? -1));
const danfo = () => h.game.rides.take(PLAYER, yaba, "yaba-danfo", "yaba-bus-stop", "sabo-bus-stop", h.clock.now());
const okada = () => h.game.rides.take(PLAYER, yaba, "yaba-okada", "montgomery-okada", "sabo-okada", h.clock.now());

describe("what a stop offers", () => {
  it("lists every other stop on its rides, with the server's fare and about how long", () => {
    const fromSabo = h.game.rides.options(yaba, "sabo-bus-stop");
    expect(fromSabo.map((option) => option.toStop).sort()).toEqual(["yaba-bus-stop", "yaba-motor-park"]);
    expect(fromSabo.every((option) => option.kind === "danfo" && option.fareKobo === Number(DANFO_FARE))).toBe(true);
    expect(fromSabo.every((option) => option.seconds > 0)).toBe(true);
  });

  it("prices an okada by distance, in whole kobo from the fare bands", () => {
    const fares = h.game.rides.options(yaba, "montgomery-okada").map((option) => option.fareKobo);
    expect(fares.length).toBe(2);
    for (const fare of fares) expect([50_000, 80_000, 120_000]).toContain(fare);
  });
});

describe("taking a ride", () => {
  it("charges the fare once and starts the ride", async () => {
    const taken = await danfo();
    expect(taken.ok).toBe(true);
    expect(await balance()).toBe(STARTING_BALANCE - DANFO_FARE);
    const ride = await h.game.rides.current(PLAYER, yaba);
    expect(ride?.toLabel).toBe("Sabo Bus Stop");
    expect(ride && ride.endsAt.getTime()).toBe(ride?.arrivesAt.getTime());
  });

  it("refuses a second ride while one is under way, without charging again", async () => {
    await danfo();
    expect(await danfo()).toEqual({ ok: false, reason: "already_riding" });
    expect(await balance()).toBe(STARTING_BALANCE - DANFO_FARE);
  });

  it("lets only one of two simultaneous requests through, and charges once (double spend)", async () => {
    const results = await Promise.all([danfo(), danfo(), okada()]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const charged = STARTING_BALANCE - (await balance());
    expect([DANFO_FARE, 50_000n, 80_000n, 120_000n]).toContain(charged);
    expect(await h.db.playerRide.count({ where: { playerId: PLAYER } })).toBe(1);
  });

  it("refuses a ride the player cannot afford: no ride, no charge, never a negative balance", async () => {
    await h.wallet.debit({ playerId: PLAYER, currency: "NGN", amount: STARTING_BALANCE - DANFO_FARE + 1n, reason: "food", reference: "spend-it" });
    expect(await danfo()).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(await balance()).toBe(DANFO_FARE - 1n);
    expect(await h.db.playerRide.count({ where: { playerId: PLAYER } })).toBe(0);
  });

  it("never pays twice for the same ride, even if the charge is retried", async () => {
    await danfo();
    const ride = await h.game.rides.current(PLAYER, yaba);
    const retry = await h.wallet.debit({ playerId: PLAYER, currency: "NGN", amount: DANFO_FARE, reason: "transport", reference: `ride:${PLAYER}:${ride?.id}` });
    expect(retry.replayed).toBe(true);
    expect(await balance()).toBe(STARTING_BALANCE - DANFO_FARE);
  });

  it("refuses a ride that does not go there, and an okada on a danfo's stops", async () => {
    expect(await h.game.rides.take(PLAYER, yaba, "yaba-danfo", "yaba-bus-stop", "montgomery-okada", h.clock.now())).toEqual({ ok: false, reason: "no_ride" });
    expect(await h.game.rides.take(PLAYER, yaba, "yaba-okada", "yaba-bus-stop", "sabo-bus-stop", h.clock.now())).toEqual({ ok: false, reason: "no_ride" });
    expect(await balance()).toBe(STARTING_BALANCE);
  });
});

describe("the ride over time", () => {
  it("finishes once, and frees the player for another ride afterwards (even offline)", async () => {
    await danfo();
    const ride = await h.game.rides.current(PLAYER, yaba);
    if (!ride) throw new Error("no ride");
    h.clock.advance(ride.endsAt.getTime() - h.clock.now().getTime() + 1000);
    // Two finishers at once (the room and a join): one does it.
    const finished = await Promise.all([h.game.rides.finish(ride, h.clock.now()), h.game.rides.finish(ride, h.clock.now())]);
    expect(finished.filter(Boolean)).toHaveLength(1);
    expect(await h.game.rides.current(PLAYER, yaba)).toBeNull();
    expect((await danfo()).ok).toBe(true);
  });

  it("a ride left unfinished past its end (the player was away) is finished before the next one", async () => {
    await danfo();
    h.clock.advance(10 * 60_000);
    expect((await danfo()).ok).toBe(true);
    expect(await h.db.playerRide.count({ where: { playerId: PLAYER, finishedAt: null } })).toBe(1);
  });

  it("the task force can stop an okada partway: it ends early, keeps the fare, and says why", async () => {
    h.setRng([0, 0.5]); // the task force comes, halfway along its window
    const taken = await okada();
    if (!taken.ok) throw new Error("no ride");
    const { ride } = taken;
    expect(ride.stoppedEarly).toBe(true);
    expect(ride.endsAt.getTime()).toBeLessThan(ride.arrivesAt.getTime());
    const paid = STARTING_BALANCE - (await balance());
    h.clock.advance(ride.endsAt.getTime() - h.clock.now().getTime());
    await h.game.rides.finish(ride, h.clock.now());
    expect(STARTING_BALANCE - (await balance())).toBe(paid); // no refund
    const inbox = await h.game.inbox.open(PLAYER, h.clock.now());
    expect(inbox[0]?.title).toBe("Task force!");
  });
});
