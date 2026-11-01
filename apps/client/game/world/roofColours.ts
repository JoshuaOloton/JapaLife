import { MODEL_ROOF_TONE_COUNT, ZINC_TONE_COUNT } from "@japalife/shared";

/**
 * Roof colours by tone (`roofTone` in packages/shared): the street's zinc,
 * which goes from new grey to rusty brown, then the concrete roofs the map
 * gives model buildings. Shared by the street and the map so a roof is the
 * same colour on both.
 */
export const ZINC_COLOURS = ["#8d9196", "#7b7f82", "#8a6a52", "#7a5640", "#96999c"] as const;
const CONCRETE_ROOF_COLOURS = ["#a9a49b", "#bab4a8", "#99948b"] as const;

export const ROOF_COLOURS: readonly string[] = [...ZINC_COLOURS, ...CONCRETE_ROOF_COLOURS];

// Each palette must have exactly as many colours as the shared tones count.
if (ZINC_COLOURS.length !== ZINC_TONE_COUNT || CONCRETE_ROOF_COLOURS.length !== MODEL_ROOF_TONE_COUNT) {
  throw new Error("roof palettes do not match the roof tone counts in packages/shared");
}
