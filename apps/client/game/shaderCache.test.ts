import { Color, MeshLambertMaterial, Texture } from "three";
import { describe, expect, it } from "vitest";
import { createBodyMaterial } from "./character/bodyMaterial";
import { addBuildingEffects } from "./world/windowGlass";

/**
 * A shader compiled mid-game freezes a phone (11f-4: 2.8 s on the vivo Y29).
 * These materials vary per building and per person, so they must share one
 * compiled shader each, and anything that changes during play must be a
 * uniform, never something that makes three.js build a new shader.
 */
describe("one shader per kind of material", () => {
  it("every building, faded or not, glowing or not, uses the same building shader", () => {
    // Fading and lighting are per-copy instance attributes, so they never touch the material at all.
    const glow = { value: new Color(1, 0.8, 0.4) };
    const first = new MeshLambertMaterial();
    const second = new MeshLambertMaterial({ map: new Texture() });
    addBuildingEffects(first, glow);
    addBuildingEffects(second, glow);
    expect(first.customProgramCacheKey()).toBe(second.customProgramCacheKey());
    expect(first.transparent).toBe(false);
  });

  it("every body, in a print or a flat colour, uses the same body shader", () => {
    const skin = new Texture();
    const mask = new Texture();
    const plain = createBodyMaterial(skin, mask, { outfit: { torso: "#c8553d" }, skinTint: "#ffffff", print: null }, null);
    const printed = createBodyMaterial(
      skin,
      mask,
      {
        outfit: { torso: "#1f3a8a", hips: "#1f3a8a" },
        skinTint: "#9c765f",
        print: { pattern: { motif: "rings", colours: ["#1f3a8a", "#f2a516", "#e8452c"] }, regions: ["torso", "hips"] },
      },
      new Texture(),
    );
    expect(plain.customProgramCacheKey()).toBe(printed.customProgramCacheKey());
  });
});
