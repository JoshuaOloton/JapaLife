import { z } from "zod";
import { MAX_WALLET_BALANCE } from "./constants";
import { SINK_REASONS } from "./economy";
import { GAME_EVENT_IDS } from "./events";

/**
 * Schemas for the JSON files in `content/`. The server validates every file at
 * boot and refuses to start on a bad one. Amounts are integers in the smallest
 * unit (kobo for NGN), as plain numbers: they are converted to bigint where
 * they meet the ledger.
 */

/** Content ids are short lowercase slugs, the same shape intents use to refer to them. */
export const contentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

/** A positive whole number of kobo, pence or cents. Never a float. */
const smallestUnits = z.int().positive().max(Number(MAX_WALLET_BALANCE));

const isoDate = z.iso.date();

export const RULE_STATUSES = ["active", "proposed"] as const;

/**
 * Where a file's numbers come from. Real-world rules need a `source` URL and an
 * `asOf` date. Values that are game balance (what a shift pays, what a plate of
 * rice costs in the game) have no official source, so they say
 * `basis: "game-balance"` instead and can be retuned freely.
 */
export const contentMetaSchema = z
  .strictObject({
    asOf: isoDate,
    source: z.url().optional(),
    basis: z.literal("game-balance").optional(),
    /** Proposed rules are not law yet (CLAUDE.md realism rules). */
    status: z.enum(RULE_STATUSES).default("active"),
  })
  .refine((meta) => (meta.source === undefined) !== (meta.basis === undefined), {
    message: 'give exactly one of "source" (a URL) or "basis": "game-balance"',
  });
export type ContentMeta = z.infer<typeof contentMetaSchema>;

/**
 * One real-world rule value (a fee, threshold, processing time). Unlike game
 * balance numbers, it always needs a source URL, an asOf date and a status.
 * Phase 2 rule files (`content/rules/`) are built from this.
 */
export function ruleValueSchema<T extends z.ZodType>(value: T) {
  return z.strictObject({
    value,
    source: z.url(),
    asOf: isoDate,
    status: z.enum(RULE_STATUSES),
  });
}
export type RuleValue<T> = {
  value: T;
  source: string;
  asOf: string;
  status: (typeof RULE_STATUSES)[number];
};

/** A price or amount I am unsure of: the loader prints these at boot so they get reviewed. */
const todoNote = z.string().min(1).max(200).optional();

const positionSchema = z.strictObject({ x: z.number(), z: z.number() });

// ---- economy/ngn.json: starting money, rent, food ---------------------------

export const foodItemSchema = z.strictObject({
  id: contentIdSchema,
  name: z.string().min(1).max(60),
  priceKobo: smallestUnits,
  /** How much of the 0-100 hunger meter one portion refills. */
  hungerRestored: z.int().min(1).max(100),
  /** How much of the 0-100 energy meter one portion refills. */
  energyRestored: z.int().min(0).max(100),
  /** How much of the 0-100 morale meter one portion lifts. A good plate of jollof helps. */
  moraleRestored: z.int().min(0).max(100),
  todo: todoNote,
});

/** What a price rise event can apply to. Food is sold at bukas; fuel at the fuel station. */
export const PRICE_CATEGORIES = ["food", "fuel"] as const;
export type PriceCategory = (typeof PRICE_CATEGORIES)[number];

/** Non-food goods sold in the district, e.g. petrol for the generator. */
export const shopItemSchema = z.strictObject({
  id: contentIdSchema,
  name: z.string().min(1).max(60),
  priceKobo: smallestUnits,
  /** Ledger sink the purchase is logged under. */
  reason: z.enum(SINK_REASONS),
  /** Which price rises apply to it. */
  priceCategory: z.enum(PRICE_CATEGORIES),
  /** Hours of generator running time one unit adds to the player's tank. */
  generatorHours: z.number().positive().max(24),
  todo: todoNote,
});

export const ngnEconomySchema = z.strictObject({
  meta: contentMetaSchema,
  startingBalanceKobo: smallestUnits,
  busFareKobo: smallestUnits,
  busFareTodo: todoNote,
  rent: z.strictObject({
    todo: todoNote,
    amountKobo: smallestUnits,
    /** Real days between rent due dates (game time is real time). */
    periodDays: z.int().min(1).max(366),
    /** Real days after the due date before the missed payment has consequences. */
    graceDays: z.int().min(0).max(31),
    /** Charged when the grace period ends, then every `everyDays` until the rent is paid. */
    lateFee: z.strictObject({
      amountKobo: smallestUnits,
      everyDays: z.int().min(1).max(31),
      /** Morale change when the fee is charged. */
      moraleChange: z.int().min(-50).max(0),
      /** Morale change when the player cannot pay the fee: nothing is taken, the landlord shouts instead. */
      brokeMoraleChange: z.int().min(-50).max(0),
    }),
  }),
  food: z.array(foodItemSchema).min(1),
  shop: z.array(shopItemSchema),
});
export type NgnEconomyConfig = z.infer<typeof ngnEconomySchema>;
export type FoodItem = z.infer<typeof foodItemSchema>;
export type ShopItem = z.infer<typeof shopItemSchema>;

// ---- economy/needs.json: hunger and energy meters ---------------------------------

/**
 * The meters run 0-100 in real time. Hunger is fullness (100 is full) and
 * drains; energy regenerates while the player rests; morale drifts back towards
 * a resting level. Values are computed from a stored timestamp when needed, so
 * they keep moving while the player is offline.
 */
export const needsSchema = z.strictObject({
  meta: contentMetaSchema,
  startingHunger: z.int().min(1).max(100),
  startingEnergy: z.int().min(1).max(100),
  startingMorale: z.int().min(0).max(100),
  hungerDecayPerHour: z.number().min(0).max(100),
  energyRegenPerHour: z.number().min(0).max(100),
  /** Where morale settles with time: good and bad moments fade. */
  moraleRestingLevel: z.int().min(0).max(100),
  moraleDriftPerHour: z.number().min(0).max(100),
  /** Below `below` morale, energy recovers slower and shifts pay less. */
  lowMorale: z.strictObject({
    below: z.int().min(1).max(100),
    energyRegenPercent: z.int().min(0).max(100),
    shiftPayPercent: z.int().min(1).max(100),
  }),
  /**
   * Energy recovery at night during a power cut with no generator running, as a
   * percent of normal: a hot room with no fan is hard to sleep in.
   */
  blackoutNightEnergyRegenPercent: z.int().min(0).max(100),
  /** Most generator running time a player can hold, in hours (the size of the jerrycan). */
  generatorTankHours: z.number().positive().max(72),
  /** The player's relationship with family back home, 0-100. No effect yet; Phase 4 reads it. */
  startingFamily: z.int().min(0).max(100),
  /**
   * How far past 100 a meal may fill hunger. Anything bigger is refused, so a
   * full player cannot keep eating (or keep buying morale with food).
   */
  overeatAllowance: z.int().min(0).max(30),
  todo: todoNote,
});
export type NeedsConfig = z.infer<typeof needsSchema>;

// ---- economy/jobs.json: work that pays per shift ------------------------------

export const jobSchema = z.strictObject({
  id: contentIdSchema,
  name: z.string().min(1).max(60),
  shiftPayKobo: smallestUnits,
  /** How much of the 0-100 energy meter one shift uses; a tired player cannot work. */
  energyCost: z.int().min(1).max(100),
  todo: todoNote,
  /** How long a shift takes in real minutes. */
  shiftMinutes: z.int().min(1).max(24 * 60),
  /** The earn rate limit: a faucet cannot be farmed past this (CLAUDE.md). */
  maxShiftsPerDay: z.int().min(1).max(24),
});

export const jobsSchema = z.strictObject({
  meta: contentMetaSchema,
  jobs: z.array(jobSchema).min(1),
});
export type JobConfig = z.infer<typeof jobSchema>;
export type JobsConfig = z.infer<typeof jobsSchema>;

// ---- events/<id>.json: black tax, power cuts ------------------------------------

/** What answering a request does to the player. `{amount}` in the message becomes the naira amount. */
const choiceOutcomeSchema = z.strictObject({
  familyChange: z.int().min(-100).max(100),
  moraleChange: z.int().min(-100).max(100),
  message: z.string().min(1).max(280),
});

/** The answers a player can give to a request. Shared with the `answerEvent` intent. */
export const EVENT_ANSWERS = ["pay", "decline"] as const;
export type EventAnswer = (typeof EVENT_ANSWERS)[number];

const eventEffectSchema = z.discriminatedUnion("type", [
  /**
   * Someone asks the player for money (black tax). The player chooses: pay,
   * logged under `reason` (a real ledger sink), or decline. The request waits
   * in the database, so it survives the player going offline.
   */
  z
    .strictObject({
      type: z.literal("request"),
      reason: z.enum(SINK_REASONS),
      minKobo: smallestUnits,
      maxKobo: smallestUnits,
      /** Who is asking and why; one is picked at random. `{amount}` becomes the naira amount. */
      asks: z.array(z.string().min(1).max(200)).min(1).max(20),
      /** Real hours to answer. An unanswered request counts as declined. */
      answerWithinHours: z.int().min(1).max(14 * 24),
      payLabel: z.string().min(1).max(30),
      declineLabel: z.string().min(1).max(30),
      pay: choiceOutcomeSchema,
      decline: choiceOutcomeSchema,
      /** Declining when the player could not have paid: the family understands, mostly. */
      declineBroke: choiceOutcomeSchema,
      /** The request ran out unanswered. Effects are the decline (or declineBroke) ones. */
      expiredMessage: z.string().min(1).max(280),
    })
    .refine((effect) => effect.minKobo <= effect.maxKobo, {
      message: "minKobo must not exceed maxKobo",
    }),
  /**
   * The district loses power for a real-time stretch. At night, energy recovers
   * slower unless the player's generator has fuel.
   */
  z.strictObject({
    type: z.literal("blackout"),
    durationMinutes: z.int().min(1).max(24 * 60),
    /** Whether work stops too. Offices with their own generator keep going. */
    blocksShifts: z.boolean(),
  }),
  /**
   * Prices in a category go up by a percentage. Without `durationDays` the rise
   * is permanent, and rises compound like real inflation.
   */
  z.strictObject({
    type: z.literal("price_rise"),
    category: z.enum(PRICE_CATEGORIES),
    percent: z.int().min(1).max(500),
    durationDays: z.int().min(1).max(365).optional(),
  }),
]);

export const gameEventSchema = z.strictObject({
  meta: contentMetaSchema,
  id: z.enum(GAME_EVENT_IDS),
  title: z.string().min(1).max(80),
  /** Toast text shown to the player. */
  message: z.string().min(1).max(280),
  /** Chance the event fires on a given real day, once the minimum gap has passed. */
  chancePerDay: z.number().gt(0).max(1),
  /** Fewest real days between two firings for the same player. */
  minGapDays: z.int().min(0).max(365),
  effect: eventEffectSchema,
  /** Added to the 0-100 morale meter when the event fires (negative lowers it). */
  moraleChange: z.int().min(-100).max(100),
  todo: todoNote,
});
export type GameEventConfig = z.infer<typeof gameEventSchema>;

// ---- cities/<id>.json: one district in Phase 1 ------------------------------------

/** Something in the district the player can walk up to and `interact` with. */
/** What every interactable has: an id, the text on its sign, and where the player stands to use it. */
const signedSpot = {
  id: contentIdSchema,
  label: z.string().min(1).max(40),
  /**
   * What the action button says when the player stands here, e.g. "Buy food at
   * Mama Put". Without it, the kind's template in `copy/en.json` is used.
   */
  prompt: z.string().min(1).max(40).optional(),
  position: positionSchema,
};

const interactableSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...signedSpot, kind: z.literal("job_site"), jobId: contentIdSchema }),
  z.strictObject({
    ...signedSpot,
    kind: z.literal("food_vendor"),
    foodIds: z.array(contentIdSchema).min(1),
  }),
  /** Where the player lives (their room); rent is paid here and sleeping restores energy. */
  z.strictObject({ ...signedSpot, kind: z.literal("home") }),
  /** Where the player pays the bus fare (`busFareKobo`) to travel. */
  z.strictObject({ ...signedSpot, kind: z.literal("bus_stop") }),
  z.strictObject({
    ...signedSpot,
    kind: z.literal("fuel_station"),
    shopItemIds: z.array(contentIdSchema).min(1),
  }),
]);

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Quarter turns only, so footprints stay axis-aligned boxes for collision. */
const quarterTurnSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type QuarterTurn = z.infer<typeof quarterTurnSchema>;

/**
 * A building. The ONE definition of it: the client draws it from these numbers
 * and the server (and the client's own prediction) stops the player at the same
 * footprint, so what you see is exactly what blocks you. Centred on (x, z).
 */
export const buildingSchema = z.strictObject({
  id: contentIdSchema,
  name: z.string().min(1).max(60),
  x: z.number(),
  z: z.number(),
  halfWidth: z.number().positive(),
  halfDepth: z.number().positive(),
  /** Drawn height only; the player cannot jump or climb, so it does not affect collision. */
  height: z.number().positive().max(100),
  /** The plain box's colour, drawn when there is no `model` or while it downloads. */
  colour: hexColour,
  /**
   * A model from `content/models/catalog.json` that dresses the footprint. The
   * footprint above stays the collision truth: the content check refuses a
   * model that does not fill it (see `modelFootprintProblem`).
   */
  model: contentIdSchema.optional(),
  /** Quarter turns only, so the footprint stays an axis-aligned box for collision. */
  rotation: quarterTurnSchema.default(0),
  /** Uniform scale of the model, to size a kit piece to its footprint. */
  scale: z.number().positive().max(10).default(1),
});

/**
 * One 3D model the asset pipeline (`pnpm assets`) produced, measured from its
 * real geometry: centred on its footprint, standing on y = 0. Generated into
 * `content/models/catalog.json` so the server can check footprints without
 * reading GLB files.
 */
export const modelInfoSchema = z.strictObject({
  /** Path under the client's `/assets`. */
  file: z.string().regex(/^[a-z0-9/_-]+\.glb$/),
  halfWidth: z.number().positive(),
  halfDepth: z.number().positive(),
  height: z.number().positive(),
  triangles: z.int().nonnegative(),
  bytes: z.int().positive(),
});

export const modelCatalogSchema = z.strictObject({
  /** Written by `pnpm assets`; edit the pipeline, not this file. */
  generated: z.literal(true),
  models: z.record(contentIdSchema, modelInfoSchema),
});

/** A flat strip of road. Walkable and purely visual. */
export const roadSchema = z.strictObject({
  x: z.number(),
  z: z.number(),
  halfWidth: z.number().positive(),
  halfDepth: z.number().positive(),
  colour: hexColour,
});

/** Half the width and depth of a box on the ground. */
const halfSizeSchema = z.strictObject({
  halfWidth: z.number().positive(),
  halfDepth: z.number().positive(),
});
export type HalfSize = z.infer<typeof halfSizeSchema>;

/**
 * Street props the client builds in code from coloured boxes, at the size the
 * kind declares: no download, and no extra draw call (they join the world's one
 * instanced box mesh). Each has a builder in the client's `world/props.ts`.
 */
export const BUILT_PROP_SHAPES = [
  "generator",
  "kiosk",
  "container_shop",
  "electric_pole",
  "palm",
  "billboard",
  "hawker_table",
  "plastic_chair",
  "speed_bump",
] as const;
export type BuiltPropShape = (typeof BUILT_PROP_SHAPES)[number];

/**
 * A kind of street prop (`content/props/kinds.json`): what it looks like and
 * what of it blocks the player. Every placement of a kind shares this, so all
 * generators are the same size.
 */
export const propKindSchema = z.strictObject({
  look: z.union([
    z.strictObject({
      /** A model from `content/models/catalog.json`. */
      model: contentIdSchema,
      scale: z.number().positive().max(10).default(1),
      /** Multiplies the model's colours (greener leaves, say). */
      tint: hexColour.optional(),
    }),
    z.strictObject({
      built: z.enum(BUILT_PROP_SHAPES),
      ...halfSizeSchema.shape,
      height: z.number().positive().max(20),
      /** The main colour; the builder picks the details. */
      colour: hexColour.optional(),
    }),
  ]),
  /**
   * What stops the player. "footprint" is the whole drawn footprint (measured
   * for a model, declared for a built shape), so no size is typed twice. A box
   * is for things whose base is smaller than their top: a trunk, a pole, a
   * billboard's legs. "none" for things you walk over or under.
   */
  blocks: z.union([z.literal("footprint"), z.literal("none"), halfSizeSchema]),
});
export type PropKind = z.infer<typeof propKindSchema>;

export const propKindsSchema = z.strictObject({
  kinds: z.record(contentIdSchema, propKindSchema),
});
export type PropKinds = z.infer<typeof propKindsSchema>;

/** One prop standing in a district. */
export const propSchema = z.strictObject({
  kind: contentIdSchema,
  x: z.number(),
  z: z.number(),
  rotation: quarterTurnSchema.default(0),
  /** Text painted on it (a billboard's advert, a kiosk's name). Place flavour, so it lives here, not in copy. */
  label: z.string().min(1).max(60).optional(),
  /** Electric poles with the same `wire` are strung together, in the order listed. */
  wire: contentIdSchema.optional(),
});
export type Prop = z.infer<typeof propSchema>;

/** Looping clips a standing NPC can hold. */
export const NPC_POSES = ["idle", "talk", "fold_arms", "sit", "sit_talk", "call"] as const;
export type NpcPose = (typeof NPC_POSES)[number];

/** Each NPC's look is a preset in the client (`world/npcLooks.ts`) until the character catalog (11d) replaces them. */
export const NPC_LOOK_IDS = ["mama_put", "okada_rider_a", "okada_rider_b", "hawker", "gateman", "conductor"] as const;
export type NpcLookId = (typeof NPC_LOOK_IDS)[number];

/** The box a standing NPC blocks: about their shoulders. */
export const NPC_HALF_SIZE = 0.3;

/**
 * A person who stays in one spot (Mama Put, the gateman). Cosmetic, but they
 * block the player like a prop does, so nobody walks through Mama Put.
 */
export const npcSchema = z.strictObject({
  id: contentIdSchema,
  look: z.enum(NPC_LOOK_IDS),
  pose: z.enum(NPC_POSES),
  x: z.number(),
  z: z.number(),
  /** Degrees: 0 faces the camera (south, +z), 90 faces east (+x). */
  facing: z.number().min(0).max(359).default(0),
  /** A speech bubble line, shown when the player is close. Place flavour, so it lives here, not in copy. */
  says: z.string().min(1).max(60).optional(),
});
export type Npc = z.infer<typeof npcSchema>;

export const districtSchema = z.strictObject({
  id: contentIdSchema,
  name: z.string().min(1).max(60),
  /** Walkable area is a rectangle centred on the origin; movement stops at its edge. */
  halfWidth: z.number().positive(),
  halfDepth: z.number().positive(),
  spawn: positionSchema,
  /** How far the player may be from an interactable for `interact` to count. */
  interactRadius: z.number().positive(),
  interactables: z.array(interactableSchema).min(1),
  buildings: z.array(buildingSchema),
  roads: z.array(roadSchema),
  props: z.array(propSchema).default([]),
  npcs: z.array(npcSchema).default([]),
});

export const citySchema = z.strictObject({
  meta: contentMetaSchema,
  id: contentIdSchema,
  name: z.string().min(1).max(60),
  /** IANA time zone for calendar logic (Lagos has no daylight saving). */
  timeZone: z.string().min(1),
  /** Night in local hours: from `startsHour` until `endsHour` the next morning. */
  night: z
    .strictObject({ startsHour: z.int().min(0).max(23), endsHour: z.int().min(0).max(23) })
    .refine((night) => night.startsHour > night.endsHour, {
      message: "night must start in the evening and end the next morning (startsHour > endsHour)",
    }),
  currency: z.literal("NGN"),
  districts: z.array(districtSchema).min(1),
});
export type CityConfig = z.infer<typeof citySchema>;
export type DistrictConfig = z.infer<typeof districtSchema>;
export type Interactable = z.infer<typeof interactableSchema>;
export type Building = z.infer<typeof buildingSchema>;
export type Road = z.infer<typeof roadSchema>;
export type ModelInfo = z.infer<typeof modelInfoSchema>;
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

/**
 * What the server sends on join: the district, plus the catalog entries of the
 * models and the prop kinds it uses, so the client knows what to draw and
 * which files to download.
 */
export const districtLayoutSchema = districtSchema.extend({
  models: z.record(contentIdSchema, modelInfoSchema),
  propKinds: z.record(contentIdSchema, propKindSchema),
});
export type DistrictLayout = z.infer<typeof districtLayoutSchema>;

/**
 * The district plus only the models and prop kinds it uses. The server sends
 * this on join and the content check tests the same thing, so what is checked
 * is what is played. Unknown ids are left out here; the content check reports them.
 */
export function buildDistrictLayout(
  config: DistrictConfig,
  models: Readonly<Record<string, ModelInfo>>,
  propKinds: Readonly<Record<string, PropKind>>,
): DistrictLayout {
  const usedModels: Record<string, ModelInfo> = {};
  const usedKinds: Record<string, PropKind> = {};
  const useModel = (id: string | undefined): void => {
    const model = id ? models[id] : undefined;
    if (id && model) usedModels[id] = model;
  };
  for (const building of config.buildings) useModel(building.model);
  for (const prop of config.props) {
    const kind = propKinds[prop.kind];
    if (!kind) continue;
    usedKinds[prop.kind] = kind;
    if ("model" in kind.look) useModel(kind.look.model);
  }
  return { ...config, models: usedModels, propKinds: usedKinds };
}

/** How far a model may stick out past its footprint, in metres: a roof edge or a step, never a walk-through wall. */
export const MODEL_OVERHANG_METRES = 0.3;
/** A model must cover at least this much of its footprint on each axis, or you would bump into thin air. */
export const MODEL_MIN_FILL = 0.85;

/** A box's half sizes after a quarter turn: 90 and 270 swap width and depth. */
export function turnHalfSize(size: HalfSize, rotation: QuarterTurn): HalfSize {
  const turned = rotation === 90 || rotation === 270;
  return turned ? { halfWidth: size.halfDepth, halfDepth: size.halfWidth } : { ...size };
}

/** The model's footprint on the ground once the building's rotation and scale are applied. */
export function placedModelFootprint(building: Building, model: ModelInfo): HalfSize {
  const turned = turnHalfSize(model, building.rotation);
  return { halfWidth: turned.halfWidth * building.scale, halfDepth: turned.halfDepth * building.scale };
}

/** A prop kind's drawn footprint, before rotation: measured for a model, declared for a built shape. */
export function propFootprint(kind: PropKind, models: Readonly<Record<string, ModelInfo>>): HalfSize | undefined {
  if ("built" in kind.look) return { halfWidth: kind.look.halfWidth, halfDepth: kind.look.halfDepth };
  const model = models[kind.look.model];
  if (!model) return undefined;
  return { halfWidth: model.halfWidth * kind.look.scale, halfDepth: model.halfDepth * kind.look.scale };
}

/** What of a prop kind stops the player, before rotation, or undefined if nothing does. */
export function propBlockSize(kind: PropKind, models: Readonly<Record<string, ModelInfo>>): HalfSize | undefined {
  if (kind.blocks === "none") return undefined;
  if (kind.blocks === "footprint") return propFootprint(kind, models);
  return kind.blocks;
}

/** Why a prop kind's blocking box would be an invisible wall (bigger than what is drawn), or undefined if it is fine. */
export function propBlockProblem(kind: PropKind, models: Readonly<Record<string, ModelInfo>>): string | undefined {
  if (typeof kind.blocks !== "object") return undefined;
  const drawn = propFootprint(kind, models);
  if (!drawn) return undefined;
  for (const [axis, block, seen] of [
    ["width", kind.blocks.halfWidth, drawn.halfWidth],
    ["depth", kind.blocks.halfDepth, drawn.halfDepth],
  ] as const) {
    if (block > seen + MODEL_OVERHANG_METRES) {
      return `blocking ${axis} ${(block * 2).toFixed(2)} m is bigger than the drawn ${(seen * 2).toFixed(2)} m (people would bump into thin air)`;
    }
  }
  return undefined;
}

/** Why a model does not fit its building's footprint, or undefined if it does. */
export function modelFootprintProblem(building: Building, model: ModelInfo): string | undefined {
  const placed = placedModelFootprint(building, model);
  for (const [axis, drawn, box] of [
    ["width", placed.halfWidth, building.halfWidth],
    ["depth", placed.halfDepth, building.halfDepth],
  ] as const) {
    const metres = (half: number): string => (half * 2).toFixed(2);
    if (drawn > box + MODEL_OVERHANG_METRES) {
      return `model ${axis} ${metres(drawn)} m is bigger than the footprint's ${metres(box)} m (people would walk into it)`;
    }
    if (drawn < box * MODEL_MIN_FILL) {
      return `model ${axis} ${metres(drawn)} m fills too little of the footprint's ${metres(box)} m (people would bump into thin air)`;
    }
  }
  return undefined;
}
