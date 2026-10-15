import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contentMetaSchema, ruleValueSchema } from "./content";

describe("ruleValueSchema", () => {
  const feeSchema = ruleValueSchema(z.int().positive());
  const valid = {
    value: 1_000_00,
    source: "https://www.gov.uk/government/publications/visa-regulations-revised-table",
    asOf: "2026-04-09",
    status: "active",
  };

  it("accepts a sourced, dated rule value", () => {
    expect(feeSchema.safeParse(valid).success).toBe(true);
    expect(feeSchema.safeParse({ ...valid, status: "proposed" }).success).toBe(true);
  });

  it.each([
    ["no source", { ...valid, source: undefined }],
    ["a source that is not a URL", { ...valid, source: "gov.uk" }],
    ["no asOf", { ...valid, asOf: undefined }],
    ["a malformed asOf", { ...valid, asOf: "April 2026" }],
    ["no status", { ...valid, status: undefined }],
    ["an unknown status", { ...valid, status: "current" }],
    ["an invalid value", { ...valid, value: 1.5 }],
  ])("rejects %s", (_label, input) => {
    expect(feeSchema.safeParse(input).success).toBe(false);
  });
});

describe("contentMetaSchema", () => {
  it("defaults status to active and needs exactly one of source or basis", () => {
    const ok = contentMetaSchema.parse({ asOf: "2026-10-15", basis: "game-balance" });
    expect(ok.status).toBe("active");
    expect(contentMetaSchema.safeParse({ asOf: "2026-10-15" }).success).toBe(false);
    expect(
      contentMetaSchema.safeParse({
        asOf: "2026-10-15",
        basis: "game-balance",
        source: "https://example.com",
      }).success,
    ).toBe(false);
  });
});
