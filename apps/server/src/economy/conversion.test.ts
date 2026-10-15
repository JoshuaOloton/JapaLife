import { MAX_WALLET_BALANCE } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { convertAmount, RATE_SCALE } from "./conversion";
import { InvalidAmountError } from "./money";

// 1 NGN = 0.00051 GBP, so 510 / 1_000_000.
const NGN_TO_GBP = 510n;

describe("convertAmount", () => {
  it("converts with integer maths and no spread", () => {
    // 1_000_000 kobo (N10,000) * 0.00051 = 510 pence (GBP 5.10)
    expect(convertAmount({ fromAmount: 1_000_000n, midRateMicro: NGN_TO_GBP, spreadBps: 0 })).toBe(510n);
  });

  it("applies the channel spread (2% off)", () => {
    expect(convertAmount({ fromAmount: 1_000_000n, midRateMicro: NGN_TO_GBP, spreadBps: 200 })).toBe(499n);
  });

  it("rounds DOWN so rounding never creates money", () => {
    // 3 * 1_500_000 / 1_000_000 = 4.5 -> 4
    expect(convertAmount({ fromAmount: 3n, midRateMicro: 1_500_000n, spreadBps: 0 })).toBe(4n);
    // 999_999 * 0.5 = 499_999.5 -> 499_999
    expect(convertAmount({ fromAmount: 999_999n, midRateMicro: 500_000n, spreadBps: 0 })).toBe(499_999n);
  });

  it("never returns more than the exact rational value", () => {
    for (let from = 1n; from <= 2_000n; from += 37n) {
      const out = convertAmount({ fromAmount: from * 100n, midRateMicro: 1_234_567n, spreadBps: 150 });
      // out * 1e6 * 1e4 must not exceed from * rate * kept
      expect(out * RATE_SCALE * 10_000n).toBeLessThanOrEqual(from * 100n * 1_234_567n * 9_850n);
    }
  });

  it("uses a rate of exactly 1 as a straight swap (before spread)", () => {
    expect(convertAmount({ fromAmount: 12_345n, midRateMicro: RATE_SCALE, spreadBps: 0 })).toBe(12_345n);
  });

  it("refuses a conversion that rounds to zero instead of taking money for nothing", () => {
    expect(() => convertAmount({ fromAmount: 1n, midRateMicro: NGN_TO_GBP, spreadBps: 0 })).toThrow(
      InvalidAmountError,
    );
  });

  it("refuses bad inputs", () => {
    const base = { fromAmount: 1_000n, midRateMicro: 1_000_000n, spreadBps: 0 };
    expect(() => convertAmount({ ...base, fromAmount: 0n })).toThrow(InvalidAmountError);
    expect(() => convertAmount({ ...base, fromAmount: -5n })).toThrow(InvalidAmountError);
    expect(() => convertAmount({ ...base, midRateMicro: 0n })).toThrow(InvalidAmountError);
    expect(() => convertAmount({ ...base, midRateMicro: -1n })).toThrow(InvalidAmountError);
    expect(() => convertAmount({ ...base, spreadBps: -1 })).toThrow(InvalidAmountError);
    expect(() => convertAmount({ ...base, spreadBps: 10_000 })).toThrow(InvalidAmountError);
    expect(() => convertAmount({ ...base, spreadBps: 1.5 })).toThrow(InvalidAmountError);
  });

  it("does not overflow on large inputs and refuses results over the cap", () => {
    // fromAmount * rate is far beyond 2^53 here; bigint handles it exactly.
    expect(
      convertAmount({ fromAmount: MAX_WALLET_BALANCE, midRateMicro: RATE_SCALE, spreadBps: 0 }),
    ).toBe(MAX_WALLET_BALANCE);
    expect(() =>
      convertAmount({ fromAmount: MAX_WALLET_BALANCE, midRateMicro: 2n * RATE_SCALE, spreadBps: 0 }),
    ).toThrow(InvalidAmountError);
  });
});
