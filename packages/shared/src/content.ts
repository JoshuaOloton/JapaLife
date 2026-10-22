import { z } from "zod";
import { appearanceSchema, type CharacterCatalog, characterCatalogSchema } from "./appearance";
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

export const positionSchema = z.strictObject({ x: z.number(), z: z.number() });

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

export const interactableSchema = z.discriminatedUnion("kind", [
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
/** A rectangle on a colour sheet, in texture coordinates: [u0, v0, u1, v1]. */
const uvRectSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export const modelInfoSchema = z.strictObject({
  /** Path under the client's `/assets`. */
  file: z.string().regex(/^[a-z0-9/_-]+\.glb$/),
  halfWidth: z.number().positive(),
  halfDepth: z.number().positive(),
  height: z.number().positive(),
  triangles: z.int().nonnegative(),
  bytes: z.int().positive(),
  /**
   * Where the window glass is on the model's colour sheet, as texture-space
   * rectangles [u0, v0, u1, v1]. Surfaces painted from these glow at night.
   */
  windows: z.array(uvRectSchema).optional(),
});

export const modelCatalogSchema = z.strictObject({
  /** Written by `pnpm assets`; edit the pipeline, not this file. */
  generated: z.literal(true),
  models: z.record(contentIdSchema, modelInfoSchema),
});

/**
 * How big a street is: a `main` road (danfo routes, no okada), an `inner`
 * street (okada allowed) or a `lane` (narrow, people only, no traffic).
 */
export const ROAD_CLASSES = ["main", "inner", "lane"] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

/** A flat strip of road. Walkable and purely visual. */
export const roadSchema = z.strictObject({
  x: z.number(),
  z: z.number(),
  halfWidth: z.number().positive(),
  halfDepth: z.number().positive(),
  colour: hexColour,
  /** The street's name, for the map. A place name, so it lives in content, not copy. */
  name: z.string().min(1).max(60).optional(),
  class: z.enum(ROAD_CLASSES).optional(),
});

/** A named place drawn on the map (a market, a college). Its buildings and props are listed with the others. */
export const landmarkSchema = z.strictObject({
  id: contentIdSchema,
  name: z.string().min(1).max(60),
  x: z.number(),
  z: z.number(),
});
export type Landmark = z.infer<typeof landmarkSchema>;

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
  "signboard",
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

/** The box a standing NPC blocks: about their shoulders. */
export const NPC_HALF_SIZE = 0.3;

/**
 * A person who stays in one spot (Mama Put, the gateman). Cosmetic, but they
 * block the player like a prop does, so nobody walks through Mama Put.
 */
export const npcSchema = z.strictObject({
  id: contentIdSchema,
  /** From the character catalog, like a player's; NPCs may wear non-starter clothes (a gateman's uniform). */
  look: appearanceSchema,
  pose: z.enum(NPC_POSES),
  x: z.number(),
  z: z.number(),
  /** Degrees: 0 faces the camera (south, +z), 90 faces east (+x). */
  facing: z.number().min(0).max(359).default(0),
  /** A speech bubble line, shown when the player is close. Place flavour, so it lives here, not in copy. */
  says: z.string().min(1).max(60).optional(),
});
export type Npc = z.infer<typeof npcSchema>;

/**
 * A kind of vehicle in the street traffic (`content/traffic/kinds.json`).
 * Traffic is cosmetic and client-only: it never blocks the player and is not
 * synced; it stops for the player instead.
 */
export const vehicleKindSchema = z.strictObject({
  look: z.strictObject({
    /** A model from `content/models/catalog.json`; it faces +z. */
    model: contentIdSchema,
    scale: z.number().positive().max(10).default(1),
  }),
  /** Cruising speed, metres per second. */
  speed: z.number().positive().max(20),
  /** Pauses at bus stops on its lane (the danfo). */
  stopsAtBusStops: z.boolean().default(false),
  /** Rush hours bring every one of these out (danfos); other kinds keep the daytime share. */
  rushHourBoost: z.boolean().default(false),
});
export type VehicleKind = z.infer<typeof vehicleKindSchema>;

/** How much of the traffic and how many people are out, by the city's hour. */
export const trafficScheduleSchema = z.strictObject({
  dayShare: z.number().min(0).max(1),
  nightShare: z.number().min(0).max(1),
  rushShare: z.number().min(0).max(1),
  /** Local hours, from (inclusive) to (exclusive). */
  rushHours: z.array(z.strictObject({ from: z.number().min(0).max(24), to: z.number().min(0).max(24) })),
  /** When the street is "night quiet": from the evening hour to the morning hour. */
  quietFrom: z.number().min(0).max(24),
  quietUntil: z.number().min(0).max(24),
  /** Share of the usual traffic and people on streets away from a district's busy areas (markets, motor parks). */
  calmShare: z.number().min(0).max(1).default(1),
});
export type TrafficSchedule = z.infer<typeof trafficScheduleSchema>;

export const vehicleKindsSchema = z.strictObject({
  schedule: trafficScheduleSchema,
  kinds: z.record(contentIdSchema, vehicleKindSchema),
});
export type VehicleKinds = z.infer<typeof vehicleKindsSchema>;

/**
 * A district's moving life: lanes the traffic drives, which vehicles drive
 * them, where danfos stop, and the walkways people stroll. Visual only, but
 * checked by the server: lanes stay on roads, walkways never cross a wall.
 */
export const trafficSchema = z.strictObject({
  /** A lane runs in the order of its points; it may run past the district edge, so vehicles arrive off-screen. */
  lanes: z.array(z.strictObject({ id: contentIdSchema, points: z.array(positionSchema).min(2) })),
  fleet: z.array(
    z.strictObject({
      kind: contentIdSchema,
      /** Spread over these lanes in turn. */
      lanes: z.array(contentIdSchema).min(1),
      count: z.int().min(1).max(20),
    }),
  ),
  busStops: z
    .array(z.strictObject({ lane: contentIdSchema, at: positionSchema, seconds: z.number().positive().max(30).default(5) }))
    .default([]),
  pedestrians: z.strictObject({
    count: z.int().min(0).max(60),
    /** People walk a walkway to its end and back. */
    walkways: z.array(z.strictObject({ id: contentIdSchema, points: z.array(positionSchema).min(2) })),
  }),
  /** Where the street is at its busiest (markets, motor parks); elsewhere it is calmer (`calmShare`). */
  busyAreas: z
    .array(z.strictObject({ x: z.number(), z: z.number(), halfWidth: z.number().positive(), halfDepth: z.number().positive() }))
    .default([]),
});
export type Traffic = z.infer<typeof trafficSchema>;

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
  landmarks: z.array(landmarkSchema).default([]),
  traffic: trafficSchema.optional(),
});

export const citySchema = z.strictObject({
  /** Written by `pnpm city` from `content/cities/plans/`; edit the plan, not the city file. */
  generated: z.literal(true).optional(),
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
  /** The whole character catalog: NPCs are drawn from it, and the creator offers its starter options. */
  characters: characterCatalogSchema,
  /** The traffic schedule and the vehicle kinds this district's fleet uses. */
  vehicles: vehicleKindsSchema,
});
export type DistrictLayout = z.infer<typeof districtLayoutSchema>;

/**
 * What the server sends on join: the layout without its buildings and props,
 * which come in chunks as the player walks (`chunks.ts`). Everything here is
 * small or needed from the start whatever the district's size: the places,
 * roads, traffic lanes, catalogs, the outline map, and the NPCs (a few dozen,
 * and each new kind of character compiles a shader, which must happen at load,
 * not when one streams in mid-walk).
 */
export const districtHeaderSchema = districtLayoutSchema.omit({ buildings: true, props: true }).extend({
  /** Props lying on roads (speed bumps): the traffic needs every one from the start. */
  roadProps: z.array(propSchema),
  /** Every building model the district uses, and how many buildings use it: loaded and warmed up before any chunk arrives. */
  buildingModels: z.record(contentIdSchema, z.int().positive()),
  /** Every building's footprint as x, z, halfWidth, halfDepth, one after another, to a tenth of a metre: for the 2D map. */
  mapBuildings: z.array(z.number()),
});
export type DistrictHeader = z.infer<typeof districtHeaderSchema>;

const chunkCoordSchema = z.strictObject({ cx: z.int(), cz: z.int() });

/** Chunks of the district, sent as the player walks. `centre` is the player's chunk when sent: keep what is near it. */
export const chunksMessageSchema = z.strictObject({
  centre: chunkCoordSchema,
  chunks: z.array(
    chunkCoordSchema.extend({
      buildings: z.array(buildingSchema),
      props: z.array(propSchema),
    }),
  ),
});
export type ChunksMessage = z.infer<typeof chunksMessageSchema>;

/** Everything a district's layout draws on, from `content/`. */
export interface LayoutCatalogs {
  models: Readonly<Record<string, ModelInfo>>;
  propKinds: Readonly<Record<string, PropKind>>;
  characters: CharacterCatalog;
  vehicles: VehicleKinds;
}

/**
 * The district plus only the models, prop kinds and vehicle kinds it uses,
 * and the character catalog with its hair and garment models. The server sends this on
 * join and the content check tests the same thing, so what is checked is what
 * is played. Unknown ids are left out here; the content check reports them.
 */
export function buildDistrictLayout(
  config: DistrictConfig,
  { models, propKinds, characters, vehicles }: LayoutCatalogs,
): DistrictLayout {
  const usedModels: Record<string, ModelInfo> = {};
  const usedKinds: Record<string, PropKind> = {};
  const usedVehicles: Record<string, VehicleKind> = {};
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
  for (const hair of Object.values(characters.hairs)) {
    for (const part of Object.values(hair.parts)) useModel(part);
  }
  for (const outfit of Object.values(characters.outfits)) {
    for (const piece of Object.values(outfit.piece ?? {})) useModel(piece);
  }
  for (const group of config.traffic?.fleet ?? []) {
    const kind = vehicles.kinds[group.kind];
    if (!kind) continue;
    usedVehicles[group.kind] = kind;
    useModel(kind.look.model);
  }
  return {
    ...config,
    models: usedModels,
    propKinds: usedKinds,
    characters,
    vehicles: { schedule: vehicles.schedule, kinds: usedVehicles },
  };
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
