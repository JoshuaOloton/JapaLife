import { type Appearance, type CharacterCatalog, characterCatalogSchema } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { multiply, resolveLook } from "./appearance";

const catalog: CharacterCatalog = characterCatalogSchema.parse({
  bodies: { "body-1": { model: "male" }, "body-2": { model: "female" } },
  skinTones: { "tone-1": { tint: "#ffffff" }, "tone-2": { tint: "#9c765f" } },
  hairs: {
    "low-cut": { name: "Low cut", parts: { "body-1": "hair-buzzed", "body-2": "hair-buzzed-female" } },
    cornrows: { name: "Cornrows", parts: { "body-1": "hair-cap-male", "body-2": "hair-cap-female" }, pattern: "cornrows" },
    bald: { name: "Bald", parts: {} },
  },
  hairColours: { black: { colour: "#2a1f1a" }, grey: { colour: "#8c8c8c" } },
  outfits: {
    "tshirt-jeans": { name: "T-shirt and jeans", chosen: ["torso", "upperArm"], fixed: { hips: "#2f4a6d", foot: "#262626" } },
    dress: {
      name: "Dress",
      chosen: ["torso", "hips"],
      fixed: {},
      piece: { "body-1": "dress-skirt-male", "body-2": "dress-skirt-female" },
    },
  },
  outfitColours: {
    red: { colour: "#c8553d" },
    blue: { colour: "#2f6db5" },
    "print-suns": { colour: "#f2b134", print: { motif: "suns", colours: ["#f2b134", "#8c2f39", "#1d4e89"] } },
  },
  defaults: { body: "body-1", skinTone: "tone-1", hair: "low-cut", hairColour: "black", outfit: "tshirt-jeans", outfitColour: "red" },
});
const models = {
  "hair-buzzed": { file: "characters/hair-buzzed.glb", halfWidth: 0.1, halfDepth: 0.1, height: 0.2, triangles: 1, bytes: 1 },
  "hair-buzzed-female": { file: "characters/hair-buzzed-female.glb", halfWidth: 0.1, halfDepth: 0.1, height: 0.2, triangles: 1, bytes: 1 },
  "hair-cap-female": { file: "characters/hair-cap-female.glb", halfWidth: 0.1, halfDepth: 0.1, height: 0.2, triangles: 1, bytes: 1 },
  "dress-skirt-female": { file: "characters/dress-skirt-female.glb", halfWidth: 0.2, halfDepth: 0.2, height: 0.6, triangles: 1, bytes: 1 },
};
const look: Appearance = { body: "body-2", skinTone: "tone-2", hair: "low-cut", hairColour: "grey", outfit: "tshirt-jeans", outfitColour: "blue" };

describe("resolveLook", () => {
  it("picks the body's own hair file, the colours, and paints the chosen colour on the outfit's regions", () => {
    expect(resolveLook(look, catalog, models)).toEqual({
      body: "female",
      hairFile: "characters/hair-buzzed-female.glb",
      hairPattern: null,
      hairColour: "#8c8c8c",
      bodyLook: {
        outfit: { torso: "#2f6db5", upperArm: "#2f6db5", hips: "#2f4a6d", foot: "#262626" },
        skinTint: "#9c765f",
        print: null,
      },
      piece: null,
    });
  });

  it("puts the body's own skirt on a dress, in the outfit colour", () => {
    const dressed = resolveLook({ ...look, outfit: "dress" }, catalog, models);
    expect(dressed.piece).toEqual({ file: "characters/dress-skirt-female.glb", colour: "#2f6db5" });
  });

  it("puts a print on the regions the player colours, and keeps the fixed ones plain", () => {
    const { bodyLook } = resolveLook({ ...look, outfitColour: "print-suns" }, catalog, models);
    expect(bodyLook.print).toEqual({
      pattern: { motif: "suns", colours: ["#f2b134", "#8c2f39", "#1d4e89"] },
      regions: ["torso", "upperArm"],
    });
    expect(bodyLook.outfit.torso).toBe("#f2b134");
    expect(bodyLook.outfit.hips).toBe("#2f4a6d");
  });

  it("loads no hair file for bald", () => {
    expect(resolveLook({ ...look, hair: "bald" }, catalog, models).hairFile).toBeNull();
  });

  it("puts a painted style on the body's own scalp cap", () => {
    const cornrows = resolveLook({ ...look, hair: "cornrows" }, catalog, models);
    expect(cornrows.hairFile).toBe("characters/hair-cap-female.glb");
    expect(cornrows.hairPattern).toBe("cornrows");
  });

  it("draws the default for an option the catalog no longer has, instead of breaking", () => {
    expect(resolveLook({ ...look, outfitColour: "retired" }, catalog, models).bodyLook.outfit.torso).toBe("#c8553d");
  });
});

describe("skin swatches", () => {
  it("multiply like the body shader: white leaves the colour as painted", () => {
    expect(multiply("#b98463", "#ffffff")).toBe("#b98463");
    expect(multiply("#b98463", "#808080")).toBe("#5d4232");
  });
});
