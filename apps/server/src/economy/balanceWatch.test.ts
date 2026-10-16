import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, createHarness, type Harness } from "../test/gameHarness";
import { BalanceWatch, earningCeilings } from "./balanceWatch";

const PLAYER = "watched";
// content/economy: office-assistant pays 500,000 kobo a shift, 2 shifts a day, 30 minutes long.
const SHIFT_PAY = 500_000n;
const DAILY_SHIFT_PAY = 2n * SHIFT_PAY;
const STARTING_BALANCE = 2_000_000n;

let h: Harness;

beforeEach(async () => {
  await h?.close();
  h = await createHarness();
  await h.game.players.ensurePlayer(PLAYER);
});

afterAll(() => h?.close());

async function credit(reason: "shift_pay" | "starting_balance" | "family_help", amount: bigint, reference: string) {
  await h.wallet.credit({ playerId: PLAYER, currency: "NGN", amount, reason, reference });
}

const storedFlags = () => h.db.balanceFlag.findMany({ orderBy: { reason: "asc" } });

describe("earningCeilings", () => {
  it("allows a day of shifts across every calendar day the window touches, plus one late shift", () => {
    const ceilingFor = earningCeilings(h.content, DAY_MS);
    // 24 hours plus a 30-minute shift touches at most 3 Lagos calendar days.
    expect(ceilingFor("NGN", "shift_pay")).toBe(3n * DAILY_SHIFT_PAY + SHIFT_PAY);
    expect(ceilingFor("NGN", "starting_balance")).toBe(STARTING_BALANCE);
  });

  it("scales with a sped-up dev clock", () => {
    // GAME_CLOCK=60: one real day is 60 game days, so 62 calendar days are touched.
    expect(earningCeilings(h.content, 60 * DAY_MS)("NGN", "shift_pay")).toBe(62n * DAILY_SHIFT_PAY + SHIFT_PAY);
  });

  it("gives every reason without a rule, and every other currency, a ceiling of zero", () => {
    const ceilingFor = earningCeilings(h.content, DAY_MS);
    expect(ceilingFor("NGN", "family_help")).toBe(0n);
    expect(ceilingFor("NGN", "player_transfer")).toBe(0n);
    expect(ceilingFor("GBP", "shift_pay")).toBe(0n);
  });
});

describe("BalanceWatch", () => {
  it("never flags honest play", async () => {
    for (let day = 0; day < 2; day++) {
      for (let shift = 0; shift < 2; shift++) {
        // Fed and rested, so only the daily cap limits earning.
        await h.db.playerState.update({
          where: { playerId: PLAYER },
          data: { energy: 100, hunger: 100, statsAt: h.clock.now() },
        });
        expect(await h.game.jobs.startShift(PLAYER, "office-assistant", h.clock.now())).toMatchObject({ ok: true });
        h.clock.advance(HOUR_MS);
        await h.game.jobs.settleDueShifts(h.clock.now());
      }
      h.clock.advance(DAY_MS);
    }
    expect(await h.game.balanceWatch.scan()).toEqual([]);
    expect(await storedFlags()).toEqual([]);
  });

  it("flags shift pay beyond what the daily caps allow", async () => {
    const ceiling = 3n * DAILY_SHIFT_PAY + SHIFT_PAY;
    for (let i = 0n; i * SHIFT_PAY <= ceiling; i++) await credit("shift_pay", SHIFT_PAY, `replayed-shift:${i}`);

    const flags = await h.game.balanceWatch.scan();
    expect(flags).toEqual([
      { playerId: PLAYER, currency: "NGN", reason: "shift_pay", receivedInWindow: ceiling + SHIFT_PAY, ceiling },
    ]);
  });

  it("flags a second starting balance", async () => {
    await credit("starting_balance", STARTING_BALANCE, "second-start");
    const flags = await h.game.balanceWatch.scan();
    expect(flags.map((flag) => flag.reason)).toEqual(["starting_balance"]);
  });

  it("flags any money from a faucet that has no rule yet", async () => {
    await credit("family_help", 1n, "unplanned-gift");
    const [flag] = await h.game.balanceWatch.scan();
    expect(flag).toMatchObject({ reason: "family_help", receivedInWindow: 1n, ceiling: 0n });
  });

  it("flags money received from another player", async () => {
    await h.game.players.ensurePlayer("sender");
    await h.wallet.transfer({ fromPlayerId: "sender", toPlayerId: PLAYER, currency: "NGN", amount: 100n, reference: "gift" });
    const flags = await h.game.balanceWatch.scan();
    expect(flags).toEqual([expect.objectContaining({ playerId: PLAYER, reason: "player_transfer" })]);
  });

  it("only counts money inside the window", async () => {
    await credit("family_help", 1n, "old-gift");
    expect(await h.game.balanceWatch.scan(new Date(Date.now() + 2 * DAY_MS))).toEqual([]);
    expect(await h.game.balanceWatch.scan(new Date(Date.now() - HOUR_MS))).toEqual([]);
    expect(await storedFlags()).toEqual([]);
  });

  it("keeps one flag per player, reason and day, holding the worst amount", async () => {
    await credit("family_help", 100n, "gift-1");
    expect(await h.game.balanceWatch.scan()).toHaveLength(1);
    expect(await h.game.balanceWatch.scan()).toEqual([]);

    await credit("family_help", 50n, "gift-2");
    expect(await h.game.balanceWatch.scan()).toEqual([expect.objectContaining({ receivedInWindow: 150n })]);

    const stored = await storedFlags();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ playerId: PLAYER, currency: "NGN", reason: "family_help", receivedInWindow: 150n, ceiling: 0n });
  });

  it("uses the clock speed it was given", async () => {
    const fast = new BalanceWatch(h.db, h.content, 60, "Africa/Lagos");
    const ceiling = 3n * DAILY_SHIFT_PAY + SHIFT_PAY;
    for (let i = 0n; i * SHIFT_PAY <= ceiling; i++) await credit("shift_pay", SHIFT_PAY, `fast-shift:${i}`);
    expect(await fast.scan()).toEqual([]);
    expect(await h.game.balanceWatch.scan()).toHaveLength(1);
  });
});
