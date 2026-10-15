import { MAX_WALLET_BALANCE } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import {
  assertValidAmount,
  BalanceLimitError,
  creditedBalance,
  debitedBalance,
  InsufficientFundsError,
  InvalidAmountError,
} from "./money";

describe("assertValidAmount", () => {
  it("accepts positive bigints up to the cap", () => {
    expect(() => assertValidAmount(1n)).not.toThrow();
    expect(() => assertValidAmount(MAX_WALLET_BALANCE)).not.toThrow();
  });

  it("rejects zero, negatives and over-cap amounts", () => {
    for (const bad of [0n, -1n, -MAX_WALLET_BALANCE, MAX_WALLET_BALANCE + 1n]) {
      expect(() => assertValidAmount(bad), String(bad)).toThrow(InvalidAmountError);
    }
  });

  it("rejects floats, numbers, strings and other non-bigints", () => {
    for (const bad of [1, 1.5, 0.1 + 0.2, Number.NaN, Number.POSITIVE_INFINITY, "100", null, undefined, {}]) {
      expect(() => assertValidAmount(bad), String(bad)).toThrow(InvalidAmountError);
    }
  });
});

describe("negative balances", () => {
  it("never lets a debit take a balance below zero", () => {
    expect(debitedBalance(100n, 100n)).toBe(0n);
    expect(() => debitedBalance(100n, 101n)).toThrow(InsufficientFundsError);
    expect(() => debitedBalance(0n, 1n)).toThrow(InsufficientFundsError);
  });

  it("refuses a debit of a non-positive amount (no sneaky credit via a negative)", () => {
    expect(() => debitedBalance(100n, -50n)).toThrow(InvalidAmountError);
    expect(() => debitedBalance(100n, 0n)).toThrow(InvalidAmountError);
  });
});

describe("overflow", () => {
  it("allows a credit that lands exactly on the cap", () => {
    expect(creditedBalance(MAX_WALLET_BALANCE - 5n, 5n)).toBe(MAX_WALLET_BALANCE);
  });

  it("refuses a credit that would pass the cap", () => {
    expect(() => creditedBalance(MAX_WALLET_BALANCE, 1n)).toThrow(BalanceLimitError);
    expect(() => creditedBalance(MAX_WALLET_BALANCE - 5n, 6n)).toThrow(BalanceLimitError);
  });

  it("keeps the cap inside the range a JSON number can hold exactly", () => {
    expect(MAX_WALLET_BALANCE).toBeLessThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(BigInt(Number(MAX_WALLET_BALANCE))).toBe(MAX_WALLET_BALANCE);
  });
});
