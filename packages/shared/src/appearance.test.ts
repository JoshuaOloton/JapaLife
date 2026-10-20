import { describe, expect, it } from "vitest";
import {
  type Appearance,
  type CharacterCatalog,
  appearanceProblem,
  characterCatalogSchema,
  decodeAppearance,
  encodeAppearance,
  resolveAppearance,
} from "./appearance";
import { setAppearanceIntentSchema } from "./intents";

const catalog: CharacterCatalog = characterCatalogSchema.parse({
  bodies: { "body-1": { model: "male" }, "body-2": { model: "female" } },
  skinTones: { "tone-1": { tint: "#ffffff" }, "tone-2": { tint: "#9c765f" } },
  hairs: {
    "low-cut": { name: "Low cut", parts: { "body-1": "hair-buzzed", "body-2": "hair-buzzed-female" } },
    bald: { name: "Bald", parts: {} },
  },
  hairColours: { black: { colour: "#2a1f1a" } },
  outfits: {
    "tshirt-jeans": { name: "T-shirt and jeans", chosen: ["torso", "upperArm"], fixed: { hips: "#2f4a6d" } },
    uniform: { name: "Uniform", chosen: [], fixed: { torso: "#24365c", hips: "#1d2433" }, starter: false },
  },
  outfitColours: { red: { colour: "#c8553d" } },
  defaults: { body: "body-1", skinTone: "tone-1", hair: "low-cut", hairColour: "black", outfit: "tshirt-jeans", outfitColour: "red" },
});

const mine: Appearance = { body: "body-2", skinTone: "tone-2", hair: "bald", hairColour: "black", outfit: "tshirt-jeans", outfitColour: "red" };

describe("appearanceProblem", () => {
  it("accepts a starter look", () => {
    expect(appearanceProblem(mine, catalog, { starterOnly: true })).toBeUndefined();
  });

  it("refuses an id the catalog does not have", () => {
    expect(appearanceProblem({ ...mine, outfit: "agbada" }, catalog, { starterOnly: true })).toEqual({ reason: "unknown", slot: "outfit" });
    expect(appearanceProblem({ ...mine, skinTone: "tone-9" }, catalog, { starterOnly: false })).toEqual({ reason: "unknown", slot: "skinTone" });
  });

  it("refuses items that are not free starters for players, but lets NPCs wear them", () => {
    const guard = { ...mine, outfit: "uniform" };
    expect(appearanceProblem(guard, catalog, { starterOnly: true })).toEqual({ reason: "not_owned", slot: "outfit" });
    expect(appearanceProblem(guard, catalog, { starterOnly: false })).toBeUndefined();
  });

  it("does not let a catalog key that is not an option (like a prototype name) through", () => {
    expect(appearanceProblem({ ...mine, hair: "constructor" }, catalog, { starterOnly: true })).toEqual({ reason: "unknown", slot: "hair" });
  });
});

describe("resolveAppearance", () => {
  it("keeps a valid look as it is", () => {
    expect(resolveAppearance(mine, catalog)).toEqual(mine);
  });

  it("falls back to the default, slot by slot, for ids removed from the catalog", () => {
    const stored = { ...mine, outfit: "retired-outfit", hairColour: "retired-colour" };
    expect(resolveAppearance(stored, catalog)).toEqual({ ...mine, outfit: "tshirt-jeans", hairColour: "black" });
  });
});

describe("appearance codes", () => {
  it("round-trips through the synced code", () => {
    const code = encodeAppearance(mine);
    expect(code).toBe("body-2.tone-2.bald.black.tshirt-jeans.red");
    expect(decodeAppearance(code)).toEqual(mine);
  });

  it("rejects a malformed code", () => {
    expect(decodeAppearance("body-1.tone-1")).toBeUndefined();
    expect(decodeAppearance("a.b.c.d.e.F!")).toBeUndefined();
  });
});

describe("setAppearance intent", () => {
  it("accepts ids only, and nothing extra", () => {
    expect(setAppearanceIntentSchema.safeParse(mine).success).toBe(true);
    expect(setAppearanceIntentSchema.safeParse({ ...mine, skinTint: "#000000" }).success).toBe(false);
    expect(setAppearanceIntentSchema.safeParse({ ...mine, body: "Body 1" }).success).toBe(false);
  });
});
