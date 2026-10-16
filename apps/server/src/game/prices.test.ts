import { MAX_WALLET_BALANCE } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { compoundRise, NO_RISE_BP, priceWithFactor, risePercent } from "./prices";

describe("compoundRise", () => {
  it("compounds: two 10% rises make prices 21% higher, not 20%", () => {
    const once = compoundRise(NO_RISE_BP, 10);
    expect(once).toBe(11_000n);
    expect(compoundRise(once, 10)).toBe(12_100n);
  });

  it("rounds up at every step, never in the player's favour", () => {
    expect(compoundRise(10_001n, 3)).toBe(10_302n); // 10,301.03 rounds up
  });

  it("stays exact after years of monthly rises", () => {
    let factor = NO_RISE_BP;
    for (let month = 0; month < 600; month++) factor = compoundRise(factor, 3);
    expect(typeof factor).toBe("bigint");
    expect(factor).toBeGreaterThan(10n ** 11n); // 1.03^600 is about 50 million
  });
});

describe("priceWithFactor", () => {
  it("is the plain price with no rise", () => {
    expect(priceWithFactor(250_000, 2, NO_RISE_BP)).toBe(500_000n);
  });

  it("applies the factor and rounds up to a whole kobo", () => {
    expect(priceWithFactor(250_000, 1, 11_500n)).toBe(287_500n);
    expect(priceWithFactor(101, 1, 11_500n)).toBe(117n); // 116.15 rounds up
  });

  it("works in bigint, so huge prices cannot overflow or lose kobo", () => {
    const price = priceWithFactor(Number(MAX_WALLET_BALANCE), 10, 12_345n);
    expect(price).toBe((MAX_WALLET_BALANCE * 10n * 12_345n) / 10_000n);
    expect(price).toBeGreaterThan(MAX_WALLET_BALANCE); // the ledger then refuses it as unaffordable
  });
});

describe("risePercent", () => {
  it("shows the total rise, rounded down to one decimal place", () => {
    expect(risePercent(NO_RISE_BP)).toBe(0);
    expect(risePercent(12_100n)).toBe(21);
    expect(risePercent(10_309n)).toBe(3);
    expect(risePercent(10_310n)).toBe(3.1);
  });
});
