import { describe, expect, it } from "vitest";
import {
  FAUCET_REASONS,
  LEDGER_REASONS,
  SINK_REASONS,
  TRANSFER_REASONS,
  VISA_FEE_REASONS,
} from "./economy";

describe("ledger reasons", () => {
  it("has no duplicates", () => {
    expect(new Set(LEDGER_REASONS).size).toBe(LEDGER_REASONS.length);
  });

  it("never lists a reason as both a faucet and a sink", () => {
    const sinks = new Set<string>(SINK_REASONS);
    for (const reason of FAUCET_REASONS) {
      expect(sinks.has(reason), reason).toBe(false);
    }
  });

  it("uses lowercase snake_case names", () => {
    for (const reason of LEDGER_REASONS) {
      expect(reason).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it("treats every visa and immigration fee as a sink", () => {
    const sinks = new Set<string>(SINK_REASONS);
    for (const reason of VISA_FEE_REASONS) {
      expect(sinks.has(reason), reason).toBe(true);
    }
  });

  it("keeps transfers out of the faucet and sink lists", () => {
    const money = new Set<string>(LEDGER_REASONS);
    for (const reason of TRANSFER_REASONS) {
      expect(money.has(reason), reason).toBe(false);
    }
  });

  it("keeps the reasons the ledger already relies on", () => {
    for (const reason of ["starting_balance", "shift_pay", "rent", "food", "black_tax"]) {
      expect(LEDGER_REASONS as readonly string[]).toContain(reason);
    }
  });
});
