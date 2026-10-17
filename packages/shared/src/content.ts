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
  colour: hexColour,
});

/** A flat strip of road. Walkable and purely visual. */
export const roadSchema = z.strictObject({
  x: z.number(),
  z: z.number(),
  halfWidth: z.number().positive(),
  halfDepth: z.number().positive(),
  colour: hexColour,
});

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
