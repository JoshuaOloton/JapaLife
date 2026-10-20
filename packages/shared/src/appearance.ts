import { z } from "zod";
import { BODY_REGIONS, type BodyRegion } from "./bodyRegions";

/**
 * How a character looks: one id per slot, each pointing into the character
 * catalog (`content/characters/catalog.json`). Only ids travel and are
 * stored; colours, names and model files live in the catalog. It is cosmetic
 * game data about the avatar, never about the real person.
 */

const optionId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const APPEARANCE_SLOTS = ["body", "skinTone", "hair", "hairColour", "outfit", "outfitColour"] as const;
export type AppearanceSlot = (typeof APPEARANCE_SLOTS)[number];

export const appearanceSchema = z.strictObject({
  body: optionId,
  skinTone: optionId,
  hair: optionId,
  hairColour: optionId,
  outfit: optionId,
  outfitColour: optionId,
});
export type Appearance = z.infer<typeof appearanceSchema>;

/**
 * Close-to-the-head styles, painted in code onto a scalp cap (`hair-cap-<body>`)
 * rather than modelled strand by strand. The client has one painter per pattern.
 */
export const HAIR_PATTERNS = ["cornrows", "fade"] as const;
export type HairPattern = (typeof HAIR_PATTERNS)[number];

/**
 * Ankara (wax-print) motifs, painted in code onto a tiling texture. Original
 * designs only, never copies of real prints. The client has one painter per motif.
 */
export const ANKARA_MOTIFS = ["rings", "diamonds", "leaves", "waves", "zigzag", "dots", "suns", "scales"] as const;
export type AnkaraMotif = (typeof ANKARA_MOTIFS)[number];

/** A print: a motif and its colours, in order ground, main, accent and an optional fine detail. */
const ankaraPrintSchema = z.strictObject({
  motif: z.enum(ANKARA_MOTIFS),
  colours: z.array(hexColour).min(3).max(4),
});
export type AnkaraPrint = z.infer<typeof ankaraPrintSchema>;

/** The body models the asset pipeline builds (`characters/body-<model>.glb`). */
export const BODY_MODELS = ["male", "female"] as const;
export type BodyModel = (typeof BODY_MODELS)[number];

/** Free at creation and changeable at home. Anything else (NPC clothes now, shop items later) is not the player's. */
const starter = z.boolean().default(true);
const optionName = z.string().min(1).max(40);

export const characterCatalogSchema = z.strictObject({
  /** Shown as "Body 1", "Body 2": no gender label (decided 2026-10-20). Every hair and outfit fits both. */
  bodies: z.record(optionId, z.strictObject({ model: z.enum(BODY_MODELS), starter })),
  /** Multiplies the skin texture. Shown as swatches only, never named after a group of people. */
  skinTones: z.record(optionId, z.strictObject({ tint: hexColour, starter })),
  hairs: z.record(
    optionId,
    z.strictObject({
      name: optionName,
      /** Body id -> hair model id in `content/models/catalog.json`. Empty for bald. */
      parts: z.record(optionId, optionId),
      /** Painted onto the part (a scalp cap) instead of using the model's own texture. */
      pattern: z.enum(HAIR_PATTERNS).optional(),
      starter,
    }),
  ),
  hairColours: z.record(optionId, z.strictObject({ colour: hexColour, starter })),
  /**
   * Clothes are painted onto body regions. `chosen` regions take the player's
   * outfit colour; `fixed` regions keep their own (jeans stay denim). Regions in
   * neither show skin. Every outfit must cover `torso` and `hips`, or the
   * underwear painted on the base texture shows.
   */
  outfits: z.record(
    optionId,
    z.strictObject({
      name: optionName,
      chosen: z.array(z.enum(BODY_REGIONS)),
      fixed: z.partialRecord(z.enum(BODY_REGIONS), hexColour),
      /**
       * A loose garment worn over the painted regions (a skirt), body id -> model
       * id in `content/models/catalog.json`, one for every body. It takes the
       * outfit colour or print.
       */
      piece: z.record(optionId, optionId).optional(),
      starter,
    }),
  ),
  /**
   * What the outfit's `chosen` regions are painted with: a flat colour, or an
   * Ankara print. A print's `colour` is its main colour, for anything that
   * cannot show the pattern.
   */
  outfitColours: z.record(optionId, z.strictObject({ colour: hexColour, print: ankaraPrintSchema.optional(), starter })),
  /** What a slot falls back to when an id is missing from the catalog. */
  defaults: appearanceSchema,
});
export type CharacterCatalog = z.infer<typeof characterCatalogSchema>;

/** The catalog section each slot's id points into. */
const SECTION: Record<AppearanceSlot, keyof Omit<CharacterCatalog, "defaults">> = {
  body: "bodies",
  skinTone: "skinTones",
  hair: "hairs",
  hairColour: "hairColours",
  outfit: "outfits",
  outfitColour: "outfitColours",
};

/** The regions clothes must always cover. */
export const ALWAYS_COVERED: readonly BodyRegion[] = ["torso", "hips"];

/**
 * Why an appearance is not allowed, or undefined if it is. `starterOnly` is the
 * player's rule (only free starter items until the shop exists); NPCs may wear
 * anything in the catalog.
 */
export function appearanceProblem(
  appearance: Appearance,
  catalog: CharacterCatalog,
  { starterOnly }: { starterOnly: boolean },
): { reason: "unknown" | "not_owned"; slot: AppearanceSlot } | undefined {
  for (const slot of APPEARANCE_SLOTS) {
    const option = optionIn(catalog, slot, appearance[slot]);
    if (!option) return { reason: "unknown", slot };
    if (starterOnly && !option.starter) return { reason: "not_owned", slot };
  }
  const hair = catalog.hairs[appearance.hair];
  if (hair && Object.keys(hair.parts).length > 0 && !hair.parts[appearance.body]) {
    return { reason: "unknown", slot: "hair" };
  }
  return undefined;
}

/**
 * The appearance with any id the catalog no longer has replaced by that
 * slot's default, so a catalog change never breaks a stored character.
 */
export function resolveAppearance(stored: Appearance, catalog: CharacterCatalog): Appearance {
  const resolved = { ...stored };
  for (const slot of APPEARANCE_SLOTS) {
    if (!optionIn(catalog, slot, stored[slot])) resolved[slot] = catalog.defaults[slot];
  }
  const hair = catalog.hairs[resolved.hair];
  if (hair && Object.keys(hair.parts).length > 0 && !hair.parts[resolved.body]) resolved.hair = catalog.defaults.hair;
  return resolved;
}

function optionIn(catalog: CharacterCatalog, slot: AppearanceSlot, id: string): { starter: boolean } | undefined {
  const section = catalog[SECTION[slot]] as Record<string, { starter: boolean }>;
  return Object.hasOwn(section, id) ? section[id] : undefined;
}

/** A compact code for the synced player state ("body-1.tone-4.low-cut..."). Ids never contain dots. */
export function encodeAppearance(appearance: Appearance): string {
  return APPEARANCE_SLOTS.map((slot) => appearance[slot]).join(".");
}

export function decodeAppearance(code: string): Appearance | undefined {
  const ids = code.split(".");
  if (ids.length !== APPEARANCE_SLOTS.length) return undefined;
  const parsed = appearanceSchema.safeParse(Object.fromEntries(APPEARANCE_SLOTS.map((slot, index) => [slot, ids[index]])));
  return parsed.success ? parsed.data : undefined;
}
