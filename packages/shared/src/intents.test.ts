import { describe, expect, it } from "vitest";
import {
  INTENT_TYPES,
  MAX_FOOD_PURCHASE_QUANTITY,
  MAX_SHOP_PURCHASE_QUANTITY,
  parseIntent,
} from "./intents";

describe("parseIntent", () => {
  it("accepts every valid intent", () => {
    const valid: Array<[string, unknown]> = [
      ["move", { seq: 0, dx: 0.5, dz: -0.5 }],
      ["move", { seq: 12, dx: 1, dz: 0 }],
      ["interact", { targetId: "buka-1" }],
      ["work", { jobId: "danfo-conductor" }],
      ["buyFood", { itemId: "jollof-rice", quantity: 2 }],
      ["payRent", {}],
      ["buyItem", { itemId: "generator-petrol", quantity: 3 }],
      ["answerEvent", { choiceId: "0199f0a0-1234-7abc-8def-0123456789ab", answer: "pay" }],
      ["answerEvent", { choiceId: "0199f0a0-1234-7abc-8def-0123456789ab", answer: "decline" }],
    ];
    for (const [type, payload] of valid) {
      expect(parseIntent(type, payload).ok, type).toBe(true);
    }
  });

  it("covers every declared intent type in the valid cases", () => {
    expect([...INTENT_TYPES].sort()).toEqual(
      ["answerEvent", "buyFood", "buyItem", "interact", "move", "payRent", "work"].sort(),
    );
  });

  it("rejects answers that are not pay or decline, bad ids, and any amount the client tries to set", () => {
    const choiceId = "0199f0a0-1234-7abc-8def-0123456789ab";
    expect(parseIntent("answerEvent", { choiceId, answer: "maybe" }).ok).toBe(false);
    expect(parseIntent("answerEvent", { choiceId: "black_tax", answer: "pay" }).ok).toBe(false);
    expect(parseIntent("answerEvent", { choiceId, answer: "pay", amountKobo: 1 }).ok).toBe(false);
  });

  it("returns the typed intent on success", () => {
    const result = parseIntent("buyFood", { itemId: "agege-bread", quantity: 3 });
    expect(result).toEqual({
      ok: true,
      intent: { type: "buyFood", payload: { itemId: "agege-bread", quantity: 3 } },
    });
  });

  it("lets a field-less intent arrive with no body", () => {
    expect(parseIntent("payRent", undefined).ok).toBe(true);
    expect(parseIntent("payRent", null).ok).toBe(true);
  });

  it("rejects unknown intent types, including prototype keys", () => {
    for (const type of ["", "teleport", "setBalance", "__proto__", "constructor", "toString"]) {
      expect(parseIntent(type, {}).ok, type).toBe(false);
    }
  });

  it("rejects extra fields so a client cannot smuggle in outcomes", () => {
    expect(parseIntent("payRent", { amount: 1 }).ok).toBe(false);
    expect(parseIntent("work", { jobId: "danfo-conductor", pay: 999999 }).ok).toBe(false);
    expect(parseIntent("buyFood", { itemId: "x", quantity: 1, price: 0 }).ok).toBe(false);
  });

  it("rejects move directions that are out of range or too long", () => {
    expect(parseIntent("move", { seq: 1, dx: 2, dz: 0 }).ok).toBe(false);
    expect(parseIntent("move", { seq: 1, dx: 1, dz: 1 }).ok).toBe(false);
    expect(parseIntent("move", { seq: -1, dx: 0, dz: 0 }).ok).toBe(false);
    expect(parseIntent("move", { seq: 1.5, dx: 0, dz: 0 }).ok).toBe(false);
  });

  it("rejects NaN, Infinity and wrong types", () => {
    expect(parseIntent("move", { seq: 1, dx: Number.NaN, dz: 0 }).ok).toBe(false);
    expect(parseIntent("move", { seq: 1, dx: Number.POSITIVE_INFINITY, dz: 0 }).ok).toBe(false);
    expect(parseIntent("move", { seq: 1, dx: "0.5", dz: 0 }).ok).toBe(false);
    expect(parseIntent("move", "up").ok).toBe(false);
    expect(parseIntent("move", [1, 2, 3]).ok).toBe(false);
  });

  it("rejects bad food quantities", () => {
    const bad = [0, -1, 1.5, MAX_FOOD_PURCHASE_QUANTITY + 1, Number.MAX_SAFE_INTEGER, "2", null];
    for (const quantity of bad) {
      expect(parseIntent("buyFood", { itemId: "jollof-rice", quantity }).ok, String(quantity)).toBe(
        false,
      );
    }
  });

  it("rejects bad shop quantities and any price the client tries to set", () => {
    const bad = [0, -1, 1.5, MAX_SHOP_PURCHASE_QUANTITY + 1, Number.MAX_SAFE_INTEGER, "2", null];
    for (const quantity of bad) {
      expect(parseIntent("buyItem", { itemId: "generator-petrol", quantity }).ok, String(quantity)).toBe(false);
    }
    expect(parseIntent("buyItem", { itemId: "generator-petrol", quantity: 1, priceKobo: 1 }).ok).toBe(false);
  });

  it("rejects ids that are empty, too long, or not slugs", () => {
    for (const targetId of ["", "A B", "../etc/passwd", "x".repeat(65), "<script>"]) {
      expect(parseIntent("interact", { targetId }).ok, targetId).toBe(false);
    }
  });

  it("never throws on hostile input", () => {
    const hostile: unknown[] = [undefined, null, 0, "", [], {}, () => 1, Symbol("x")];
    for (const payload of hostile) {
      for (const type of INTENT_TYPES) {
        expect(() => parseIntent(type, payload)).not.toThrow();
      }
    }
  });

  it("does not leak the offending payload in the error", () => {
    const result = parseIntent("work", { jobId: "SECRET VALUE" });
    expect(result).toEqual({ ok: false, error: "invalid work intent" });
  });
});
