import {
  type Appearance,
  type BodyModel,
  type CharacterCatalog,
  type HairPattern,
  type ModelInfo,
  resolveAppearance,
} from "@japalife/shared";
import type { BodyLook, Outfit } from "./bodyMaterial";

/**
 * Everything needed to draw a character, worked out from its appearance (ids)
 * and the catalog the server sent: which body and hair files to load, and the
 * colours to paint. Pure, so it is tested without a GPU.
 */
export interface CharacterLook {
  body: BodyModel;
  /** Path under `/assets`, or null for no hair (bald). */
  hairFile: string | null;
  /** A close style painted onto the hair file's scalp cap, or null for a hair model drawn as it is. */
  hairPattern: HairPattern | null;
  hairColour: string;
  bodyLook: BodyLook;
}

export function resolveLook(
  appearance: Appearance,
  catalog: CharacterCatalog,
  models: Readonly<Record<string, ModelInfo>>,
): CharacterLook {
  const resolved = resolveAppearance(appearance, catalog);
  const body = option(catalog.bodies, resolved.body);
  const hair = option(catalog.hairs, resolved.hair);
  const outfit = option(catalog.outfits, resolved.outfit);
  const outfitColour = option(catalog.outfitColours, resolved.outfitColour).colour;

  const painted: Outfit = { ...outfit.fixed };
  for (const region of outfit.chosen) painted[region] = outfitColour;

  const hairPart = hair.parts[resolved.body];
  return {
    body: body.model,
    hairFile: hairPart ? (models[hairPart]?.file ?? null) : null,
    hairPattern: hairPart ? (hair.pattern ?? null) : null,
    hairColour: option(catalog.hairColours, resolved.hairColour).colour,
    bodyLook: { outfit: painted, skinTint: option(catalog.skinTones, resolved.skinTone).tint },
  };
}

/** Two hex colours multiplied, as the body shader does with the skin tint (for the creator's swatches). */
export function multiply(a: string, b: string): string {
  const channel = (hex: string, index: number): number => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  let out = "#";
  for (let index = 0; index < 3; index++) {
    out += Math.round((channel(a, index) * channel(b, index)) / 255)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

/** A catalog entry `resolveAppearance` has already guaranteed exists. */
function option<T>(section: Readonly<Record<string, T>>, id: string): T {
  const found = section[id];
  if (found === undefined) throw new Error(`character catalog has no "${id}"`);
  return found;
}
