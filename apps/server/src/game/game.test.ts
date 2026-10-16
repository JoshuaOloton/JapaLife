import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, createHarness, type Harness } from "../test/gameHarness";

const PLAYER = "tester";
const STARTING_BALANCE = 2_000_000n; // content/economy/ngn.json
const SHIFT_PAY = 500_000n; // content/economy/jobs.json
const JOLLOF = 350_000n; // content/economy/ngn.json

let h: Harness;

beforeEach(async () => {
  await h?.close();
  h = await createHarness();
  await h.game.players.ensurePlayer(PLAYER);
});

afterAll(() => h?.close());

const balance = (): Promise<bigint> => h.game.stats.build(PLAYER, h.clock.now()).then((s) => BigInt(s?.balanceKobo ?? -1));

/** Gives the player spending money through a real faucet. */
async function giveMoney(kobo: bigint, reference = `test-gift:${Math.random()}`): Promise<void> {
  await h.wallet.credit({
    playerId: PLAYER,
    currency: "NGN",
    amount: kobo,
    reason: "salary",
    reference,
  });
}

async function setMeters(hunger: number, energy: number): Promise<void> {
  await h.db.playerState.update({
    where: { playerId: PLAYER },
    data: { hunger, energy, statsAt: h.clock.now() },
  });
}

describe("players", () => {
  it("gives the starting balance exactly once, even if joins race", async () => {
    await Promise.all(Array.from({ length: 5 }, () => h.game.players.ensurePlayer("racer")));
    const stats = await h.game.stats.build("racer", h.clock.now());
    expect(BigInt(stats?.balanceKobo ?? -1)).toBe(STARTING_BALANCE);
    expect(await h.db.playerState.count({ where: { playerId: "racer" } })).toBe(1);
  });

  it("starts with the configured meters and the first rent a full period away", async () => {
    const stats = await h.game.stats.build(PLAYER, h.clock.now());
    expect(stats).toMatchObject({ hunger: 80, energy: 100, rentStatus: "ok", activeShift: null });
    expect(stats?.rentDueAt).toBe(new Date(h.clock.now().getTime() + 30 * DAY_MS).toISOString());
  });

  it("has no stats for someone who never joined", async () => {
    expect(await h.game.stats.build("ghost", h.clock.now())).toBeNull();
  });
});

describe("jobs", () => {
  it("spends energy at the start and pays through the ledger only when the shift ends", async () => {
    const started = await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now());
    expect(started.ok).toBe(true);
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.energy).toBe(70);

    h.clock.advance(29 * 60_000);
    expect(await h.game.jobs.settleDueShifts(h.clock.now())).toEqual([]);
    expect(await balance()).toBe(STARTING_BALANCE);

    h.clock.advance(2 * 60_000);
    const paid = await h.game.jobs.settleDueShifts(h.clock.now());
    expect(paid).toHaveLength(1);
    expect(await balance()).toBe(STARTING_BALANCE + SHIFT_PAY);
  });

  it("pays a shift only once however often it is settled", async () => {
    await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now());
    h.clock.advance(HOUR_MS);
    const results = await Promise.all([
      h.game.jobs.settleDueShifts(h.clock.now()),
      h.game.jobs.settleDueShifts(h.clock.now(), PLAYER),
      h.game.jobs.settleDueShifts(h.clock.now()),
    ]);
    expect(results.flat()).toHaveLength(1); // one notice, not three
    expect(await balance()).toBe(STARTING_BALANCE + SHIFT_PAY);
  });

  it("pays an offline player: no connection is needed to be paid", async () => {
    await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now());
    h.clock.advance(2 * HOUR_MS);
    await h.game.jobs.settleDueShifts(h.clock.now()); // the scheduled job
    expect(await balance()).toBe(STARTING_BALANCE + SHIFT_PAY);
  });

  it("allows one shift at a time", async () => {
    await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now());
    expect(await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).toEqual({
      ok: false,
      reason: "shift_active",
    });
  });

  it("caps shifts per day, and the cap resets at midnight Lagos time", async () => {
    // 09:00 Lagos. Two shifts allowed per day.
    for (let i = 0; i < 2; i++) {
      expect((await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).ok).toBe(true);
      h.clock.advance(HOUR_MS);
      await setMeters(100, 100);
    }
    expect(await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).toEqual({
      ok: false,
      reason: "daily_limit",
    });

    // 22:59 UTC is 23:59 Lagos: still the same day. 23:01 UTC is 00:01 Lagos: a new day.
    h.clock.set(new Date("2026-10-15T22:59:00Z"));
    await setMeters(100, 100);
    expect((await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).ok).toBe(false);
    h.clock.set(new Date("2026-10-15T23:01:00Z"));
    await setMeters(100, 100);
    expect((await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).ok).toBe(true);
  });

  it("needs enough energy", async () => {
    await setMeters(80, 10);
    expect(await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).toEqual({
      ok: false,
      reason: "no_energy",
    });
    h.clock.advance(4 * HOUR_MS); // regenerates 24 energy
    expect((await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).ok).toBe(true);
  });

  it("refuses to work when starving", async () => {
    await setMeters(0, 100);
    expect(await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).toEqual({
      ok: false,
      reason: "starving",
    });
  });

  it("rejects unknown jobs and unknown players", async () => {
    expect(await h.game.jobs.startShift(PLAYER, "ghost-job", h.clock.now())).toEqual({
      ok: false,
      reason: "unknown_target",
    });
    expect(await h.game.jobs.startShift("ghost", "office-assistant", h.clock.now())).toEqual({
      ok: false,
      reason: "not_signed_in",
    });
  });

  it("keeps draining hunger while time passes, even mid-shift", async () => {
    await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now());
    h.clock.advance(24 * HOUR_MS);
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.hunger).toBe(0);
  });
});

describe("rent", () => {
  it("reports ok, then due, then overdue after the grace period", async () => {
    const state = await h.game.players.getState(PLAYER);
    const due = state!.rentDueAt;
    expect(h.game.rent.status(due, new Date(due.getTime() - 1))).toBe("ok");
    expect(h.game.rent.status(due, due)).toBe("due");
    expect(h.game.rent.status(due, new Date(due.getTime() + 3 * DAY_MS))).toBe("due");
    expect(h.game.rent.status(due, new Date(due.getTime() + 3 * DAY_MS + 1))).toBe("overdue");
  });

  it("cannot be paid without the money", async () => {
    expect(await h.game.rent.payRent(PLAYER, h.clock.now())).toEqual({
      ok: false,
      reason: "insufficient_funds",
    });
    expect(await balance()).toBe(STARTING_BALANCE);
  });

  it("moves the due date forward one period and charges once", async () => {
    await giveMoney(10_000_000n);
    const before = (await h.game.players.getState(PLAYER))!.rentDueAt;
    const paid = await h.game.rent.payRent(PLAYER, h.clock.now());
    expect(paid).toEqual({ ok: true, nextDueAt: new Date(before.getTime() + 30 * DAY_MS) });
    expect(await balance()).toBe(STARTING_BALANCE + 10_000_000n - 4_000_000n);
  });

  it("refuses to stockpile months: a second payment straight away is rejected", async () => {
    await giveMoney(10_000_000n);
    await h.game.rent.payRent(PLAYER, h.clock.now());
    expect(await h.game.rent.payRent(PLAYER, h.clock.now())).toEqual({
      ok: false,
      reason: "rent_not_due",
    });
    h.clock.advance(31 * DAY_MS);
    expect((await h.game.rent.payRent(PLAYER, h.clock.now())).ok).toBe(true);
  });

  it("does not charge twice for the same due date, even if the update was lost", async () => {
    await giveMoney(10_000_000n);
    const original = (await h.game.players.getState(PLAYER))!.rentDueAt;
    await h.game.rent.payRent(PLAYER, h.clock.now());
    // Pretend the server crashed after charging but before moving the due date.
    await h.db.playerState.update({ where: { playerId: PLAYER }, data: { rentDueAt: original } });
    await h.game.rent.payRent(PLAYER, h.clock.now());
    expect(await balance()).toBe(STARTING_BALANCE + 10_000_000n - 4_000_000n);
    expect((await h.game.players.getState(PLAYER))!.rentDueAt.getTime()).toBe(original.getTime() + 30 * DAY_MS);
  });

  it("keeps the schedule when paid late", async () => {
    await giveMoney(10_000_000n);
    const original = (await h.game.players.getState(PLAYER))!.rentDueAt;
    h.clock.advance(32 * DAY_MS); // two days late
    const paid = await h.game.rent.payRent(PLAYER, h.clock.now());
    expect(paid).toEqual({ ok: true, nextDueAt: new Date(original.getTime() + 30 * DAY_MS) });
  });
});

describe("food", () => {
  it("costs money and refills hunger", async () => {
    await setMeters(20, 50);
    const bought = await h.game.food.buy(PLAYER, "jollof-rice", 1, h.clock.now());
    expect(bought).toEqual({ ok: true, priceKobo: JOLLOF });
    expect(await balance()).toBe(STARTING_BALANCE - JOLLOF);
    const stats = await h.game.stats.build(PLAYER, h.clock.now());
    expect(stats).toMatchObject({ hunger: 65, energy: 62 });
  });

  it("never fills past 100", async () => {
    await setMeters(90, 100);
    await h.game.food.buy(PLAYER, "jollof-rice", 1, h.clock.now());
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.hunger).toBe(100);
  });

  it("will not sell to someone who is already full", async () => {
    await setMeters(100, 100);
    expect(await h.game.food.buy(PLAYER, "jollof-rice", 1, h.clock.now())).toEqual({
      ok: false,
      reason: "already_full",
    });
    expect(await balance()).toBe(STARTING_BALANCE);
  });

  it("refuses what the player cannot afford and changes nothing", async () => {
    await setMeters(10, 100);
    expect(await h.game.food.buy(PLAYER, "jollof-rice", 10, h.clock.now())).toEqual({
      ok: false,
      reason: "insufficient_funds",
    });
    expect(await balance()).toBe(STARTING_BALANCE);
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.hunger).toBe(10);
  });

  it("rejects food that does not exist", async () => {
    expect(await h.game.food.buy(PLAYER, "pizza", 1, h.clock.now())).toEqual({
      ok: false,
      reason: "unknown_target",
    });
  });
});

describe("events", () => {
  it("black tax takes an amount within its range, through the ledger", async () => {
    // Draws in order: black tax chance, black tax amount, power cut chance, price rise chance.
    h.setRng([0, 0, 0.99, 0.99]); // black tax fires for the smallest amount; the others do not
    const fired = await h.game.events.processDue(PLAYER, new Date(h.clock.now().getTime() + HOUR_MS));
    expect(fired.map((e) => e.eventId)).toEqual(["black_tax"]);
    expect(await balance()).toBe(STARTING_BALANCE - 200_000n);
  });

  it("black tax never takes more than the player has", async () => {
    await h.wallet.debit({
      playerId: PLAYER,
      currency: "NGN",
      amount: STARTING_BALANCE - 50_000n, // leaves 50,000 kobo; black tax asks for 200,000
      reason: "food",
      reference: "test-spend",
    });
    h.setRng([0, 0, 0.99, 0.99]);
    await h.game.events.processDue(PLAYER, new Date(h.clock.now().getTime() + HOUR_MS));
    expect(await balance()).toBe(0n);
  });

  it("black tax takes nothing from an empty wallet but still counts as having happened", async () => {
    await h.wallet.debit({
      playerId: PLAYER,
      currency: "NGN",
      amount: STARTING_BALANCE,
      reason: "food",
      reference: "test-spend-all",
    });
    h.setRng([0, 0, 0.99, 0.99]);
    await h.game.events.processDue(PLAYER, new Date(h.clock.now().getTime() + HOUR_MS));
    const firing = await h.db.eventFiring.findFirstOrThrow({ where: { eventId: "black_tax" } });
    expect(firing.amountKobo).toBe(0n);
    expect(await balance()).toBe(0n);
  });

  it("respects the minimum gap between firings", async () => {
    h.setRng(0);
    await h.game.events.processDue(PLAYER, new Date(h.clock.now().getTime() + HOUR_MS));
    h.setRng(0);
    await h.game.events.processDue(PLAYER, new Date(h.clock.now().getTime() + 2 * DAY_MS));
    // black tax has a 5-day gap, so it fired once; power cut has a 1-day gap, so it fired twice.
    expect(await h.db.eventFiring.count({ where: { eventId: "black_tax" } })).toBe(1);
    expect(await h.db.eventFiring.count({ where: { eventId: "power_cut" } })).toBe(2);
  });

  it("catches up after a long absence by firing each event at most once", async () => {
    h.setRng(0);
    const fired = await h.game.events.processDue(PLAYER, new Date(h.clock.now().getTime() + 60 * DAY_MS));
    expect(fired.map((e) => e.eventId).sort()).toEqual(["black_tax", "food_price_rise", "power_cut"]);
  });

  it("does nothing when the random draw says no", async () => {
    h.setRng(0.9999);
    const fired = await h.game.events.processDue(PLAYER, new Date(h.clock.now().getTime() + HOUR_MS));
    expect(fired).toEqual([]);
    expect(await balance()).toBe(STARTING_BALANCE);
  });

  it("a power cut lasts its configured time and does not stop work at an office with its own generator", async () => {
    h.setRng([0.99, 0, 0.99]);
    h.clock.advance(HOUR_MS);
    await h.game.events.processDue(PLAYER, h.clock.now());
    const effects = await h.game.events.activeEffects(PLAYER, h.clock.now());
    expect(effects.blackoutEndsAt?.getTime()).toBe(h.clock.now().getTime() + 6 * HOUR_MS);
    expect(effects.blackoutBlocksShifts).toBe(false);
    expect((await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).ok).toBe(true);
  });

  it("a power cut configured to block work blocks starting a shift until it ends", async () => {
    await h.close();
    h = await createHarness((content) => {
      const effect = content.events.power_cut.effect;
      if (effect.type === "blackout") effect.blocksShifts = true;
    });
    await h.game.players.ensurePlayer(PLAYER);
    h.setRng([0.99, 0, 0.99]);
    h.clock.advance(HOUR_MS);
    await h.game.events.processDue(PLAYER, h.clock.now());
    expect(await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).toEqual({
      ok: false,
      reason: "blackout",
    });
    h.clock.advance(6 * HOUR_MS + 60_000);
    expect((await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).ok).toBe(true);
  });

  it("a power cut lowers morale", async () => {
    h.setRng([0.99, 0, 0.99]);
    await h.game.events.processDue(PLAYER, new Date(h.clock.now().getTime() + 1000 * 2));
    const stats = await h.game.stats.build(PLAYER, new Date(h.clock.now().getTime() + 1000 * 2));
    expect(stats?.morale).toBe(70 - 3 - 1); // starting 70, minus 3, and a sliver of drift towards 60
  });

  it("a power cut at night slows energy recovery unless the generator has fuel", async () => {
    // 20:00 Lagos time.
    h.clock.set(new Date("2026-10-15T19:00:00Z"));
    await setMeters(100, 40);
    h.setRng([0.99, 0, 0.99]);
    await h.game.events.processDue(PLAYER, h.clock.now());
    h.clock.advance(4 * HOUR_MS);
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.energy).toBe(46); // 4 hours at a quarter of 6/hour
  });

  it("a power cut does not stop a shift already under way from being paid", async () => {
    await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now());
    h.setRng([0.99, 0, 0.99]);
    h.clock.advance(10 * 60_000);
    await h.game.events.processDue(PLAYER, h.clock.now());
    h.clock.advance(25 * 60_000);
    await h.game.jobs.settleDueShifts(h.clock.now());
    expect(await balance()).toBe(STARTING_BALANCE + SHIFT_PAY);
  });

  it("food price rises are permanent and compound", async () => {
    h.setRng([0.99, 0.99, 0]);
    h.clock.advance(HOUR_MS);
    await h.game.events.processDue(PLAYER, h.clock.now());
    await setMeters(10, 100);
    expect(await h.game.food.buy(PLAYER, "jollof-rice", 1, h.clock.now())).toEqual({ ok: true, priceKobo: 360_500n }); // +3%

    // A year later the first rise is still there, and a second one stacks on top of it.
    h.clock.advance(365 * DAY_MS);
    h.setRng([0.99, 0.99, 0]);
    await h.game.events.processDue(PLAYER, h.clock.now());
    await giveMoney(1_000_000n);
    await setMeters(10, 100);
    expect(await h.game.food.buy(PLAYER, "jollof-rice", 1, h.clock.now())).toEqual({ ok: true, priceKobo: 371_315n }); // 350,000 × 1.03 × 1.03

    const stats = await h.game.stats.build(PLAYER, h.clock.now());
    expect(stats).toMatchObject({ foodPriceRisePercent: 6, fuelPriceRisePercent: 0 }); // 6.09% shown as 6.0
  });
});

describe("morale", () => {
  async function setMorale(morale: number): Promise<void> {
    await h.db.playerState.update({ where: { playerId: PLAYER }, data: { morale, statsAt: h.clock.now() } });
  }

  it("a good meal lifts it", async () => {
    await setMeters(20, 50);
    await setMorale(40);
    await h.game.food.buy(PLAYER, "jollof-rice", 1, h.clock.now());
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.morale).toBe(48);
  });

  it("when low, cuts the pay of a shift started then, and the ledger pays exactly that", async () => {
    await setMorale(10);
    const started = await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now());
    expect(started).toMatchObject({ ok: true, payKobo: (SHIFT_PAY * 80n) / 100n });
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.lowMorale).toBe(true);

    // Morale recovering mid-shift does not change the agreed pay.
    await setMorale(90);
    h.clock.advance(HOUR_MS);
    await h.game.jobs.settleDueShifts(h.clock.now());
    expect(await balance()).toBe(STARTING_BALANCE + (SHIFT_PAY * 80n) / 100n);
  });

  it("pays the full rate when morale is fine", async () => {
    const started = await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now());
    expect(started).toMatchObject({ ok: true, payKobo: SHIFT_PAY });
  });
});

describe("time in the HUD", () => {
  it("reports the city's time zone, the day the player started and whether it is night", async () => {
    // The harness clock starts at 09:00 Lagos time on 2026-10-15.
    const morning = await h.game.stats.build(PLAYER, h.clock.now());
    expect(morning).toMatchObject({ timeZone: "Africa/Lagos", startedOn: "2026-10-15", isNight: false });
    const night = await h.game.stats.build(PLAYER, new Date("2026-10-16T21:00:00Z"));
    expect(night).toMatchObject({ startedOn: "2026-10-15", isNight: true });
  });
});

describe("shop (generator petrol)", () => {
  const PETROL = 90_000n; // content/economy/ngn.json, 2 hours per litre, 12-hour tank

  it("costs money and fills the generator's tank", async () => {
    expect(await h.game.shop.buy(PLAYER, "generator-petrol", 2, h.clock.now())).toEqual({
      ok: true,
      priceKobo: 2n * PETROL,
      generatorFuelHours: 4,
    });
    expect(await balance()).toBe(STARTING_BALANCE - 2n * PETROL);
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.generatorFuelHours).toBe(4);
  });

  it("refuses to overfill the tank, and charges nothing for it", async () => {
    await h.game.shop.buy(PLAYER, "generator-petrol", 6, h.clock.now()); // 12 hours: full
    const before = await balance();
    expect(await h.game.shop.buy(PLAYER, "generator-petrol", 1, h.clock.now())).toEqual({ ok: false, reason: "tank_full" });
    expect(await balance()).toBe(before);
  });

  it("keeps fuel in the tank through the day: the generator only runs at night in a power cut", async () => {
    await h.game.shop.buy(PLAYER, "generator-petrol", 1, h.clock.now());
    h.clock.advance(5 * HOUR_MS); // 09:00 to 14:00, lights on
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.generatorFuelHours).toBe(2);
  });

  it("refuses what the player cannot afford and changes nothing", async () => {
    await h.wallet.debit({ playerId: PLAYER, currency: "NGN", amount: STARTING_BALANCE - 1n, reason: "food", reference: "spend" });
    expect(await h.game.shop.buy(PLAYER, "generator-petrol", 1, h.clock.now())).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(await balance()).toBe(1n);
    expect((await h.game.stats.build(PLAYER, h.clock.now()))?.generatorFuelHours).toBe(0);
  });

  it("cannot spend the same money twice under concurrent purchases, and never goes negative", async () => {
    // Leave exactly enough for two litres, then try five purchases at once.
    await h.wallet.debit({ playerId: PLAYER, currency: "NGN", amount: STARTING_BALANCE - 2n * PETROL, reason: "food", reference: "spend" });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.game.shop.buy(PLAYER, "generator-petrol", 1, h.clock.now())),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    expect(results.filter((result) => !result.ok)).toEqual(Array(3).fill({ ok: false, reason: "insufficient_funds" }));
    expect(await balance()).toBe(0n);
  });

  it("charges the fuel price, which food price rises do not touch", async () => {
    h.setRng([0.99, 0.99, 0]); // a food price rise
    h.clock.advance(HOUR_MS);
    await h.game.events.processDue(PLAYER, h.clock.now());
    expect(await h.game.shop.buy(PLAYER, "generator-petrol", 1, h.clock.now())).toMatchObject({ ok: true, priceKobo: PETROL });
  });

  it("rejects items that do not exist", async () => {
    expect(await h.game.shop.buy(PLAYER, "ghost-diesel", 1, h.clock.now())).toEqual({ ok: false, reason: "unknown_target" });
  });
});
