import { LEDGER_REASONS } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { directionOf, isLedgerReason } from "./definitions";

describe("faucet and sink definitions", () => {
  it("classifies every ledger reason as exactly one of faucet or sink", () => {
    for (const reason of LEDGER_REASONS) {
      expect(["faucet", "sink"]).toContain(directionOf(reason));
    }
  });

  it("puts salary on the faucet side and rent, food and black tax on the sink side", () => {
    expect(directionOf("shift_pay")).toBe("faucet");
    expect(directionOf("starting_balance")).toBe("faucet");
    expect(directionOf("rent")).toBe("sink");
    expect(directionOf("food")).toBe("sink");
    expect(directionOf("black_tax")).toBe("sink");
  });

  it("recognises only declared reasons", () => {
    expect(isLedgerReason("rent")).toBe(true);
    expect(isLedgerReason("free_money")).toBe(false);
    expect(isLedgerReason("__proto__")).toBe(false);
    expect(isLedgerReason("")).toBe(false);
  });
});
