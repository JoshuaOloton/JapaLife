import { describe, expect, it } from "vitest";
import { type Copy, copySchema } from "./copy";
import { COPY, fill } from "./copyText";

const clone = (): Copy => JSON.parse(JSON.stringify(COPY)) as Copy;

describe("copy", () => {
  it("the English copy file is valid: every key, and exactly the placeholders the code fills", () => {
    const result = copySchema.safeParse(COPY);
    expect(result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
  });

  it("catches a misspelled placeholder and a missing one", () => {
    const typo = clone();
    typo.notices.shiftPaid = "You earned {amout} for your shift.";
    const messages = copySchema.safeParse(typo).error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain("must contain {amount}");
    expect(messages).toContain("unknown placeholder {amout}");
  });

  it("refuses a missing or an unknown key", () => {
    const missing = clone() as unknown as Record<string, unknown>;
    delete (missing["hud"] as Record<string, unknown>)["wallet"];
    expect(copySchema.safeParse(missing).success).toBe(false);
    expect(copySchema.safeParse({ ...COPY, extra: "x" }).success).toBe(false);
  });

  it("fills placeholders, and leaves unknown ones visible rather than blank", () => {
    expect(fill("Rent in {time}", { time: "5h 03m" })).toBe("Rent in 5h 03m");
    expect(fill("{a} and {a}, not {b}", { a: 1 })).toBe("1 and 1, not {b}");
    expect(fill("{toString}", {})).toBe("{toString}");
  });
});
