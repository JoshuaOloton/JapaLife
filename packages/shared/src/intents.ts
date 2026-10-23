import { z } from "zod";
import { appearanceSchema } from "./appearance";
import { EVENT_ANSWERS } from "./content";

/**
 * Messages the client sends to the server. They are intents, never outcomes:
 * no balances, prices, positions or results travel from client to server.
 * The server validates every message with these schemas before acting on it.
 */

/** Largest food quantity a player can ask for in one purchase. */
export const MAX_FOOD_PURCHASE_QUANTITY = 10;

/** Largest shop quantity (litres of petrol) a player can ask for in one purchase. */
export const MAX_SHOP_PURCHASE_QUANTITY = 10;

/** Content ids (jobs, items, entities) are short lowercase slugs. */
const contentId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

/**
 * Where the player is trying to go this tick, as a direction (not a position).
 * The server integrates movement and enforces speed and bounds.
 */
export const moveIntentSchema = z
  .strictObject({
    /** Increasing counter so the server can ignore stale or reordered inputs. */
    seq: z.int().nonnegative(),
    dx: z.number().min(-1).max(1),
    dz: z.number().min(-1).max(1),
  })
  .refine((move) => Math.hypot(move.dx, move.dz) <= 1 + 1e-6, {
    message: "direction must not be longer than 1",
  });

export const interactIntentSchema = z.strictObject({
  targetId: contentId,
});

export const workIntentSchema = z.strictObject({
  jobId: contentId,
});

export const buyFoodIntentSchema = z.strictObject({
  itemId: contentId,
  quantity: z.int().min(1).max(MAX_FOOD_PURCHASE_QUANTITY),
});

export const payRentIntentSchema = z.strictObject({});

/** Buying from a shop, e.g. petrol for the generator at the fuel station. */
export const buyItemIntentSchema = z.strictObject({
  itemId: contentId,
  quantity: z.int().min(1).max(MAX_SHOP_PURCHASE_QUANTITY),
});

/** Answering a request the server asked (black tax): pay or decline. The amount is the server's, never sent. */
export const answerEventIntentSchema = z.strictObject({
  choiceId: z.uuid(),
  answer: z.enum(EVENT_ANSWERS),
});

/** Show the inbox; the server replies with the latest messages and marks them read. */
export const openInboxIntentSchema = z.strictObject({});

/**
 * Make or change your character: catalog ids only. The server checks every id,
 * that each item is yours, and (after the first time) that you are at home.
 */
export const setAppearanceIntentSchema = appearanceSchema;

/**
 * Take a danfo or okada from the stop you are at to another on the same ride.
 * The server checks you are at `from`, works out the route and the fare, and
 * moves you; the fare is never sent.
 */
export const takeRideIntentSchema = z.strictObject({
  rideId: contentId,
  from: contentId,
  to: contentId,
});

export const intentSchemas = {
  move: moveIntentSchema,
  interact: interactIntentSchema,
  work: workIntentSchema,
  buyFood: buyFoodIntentSchema,
  payRent: payRentIntentSchema,
  buyItem: buyItemIntentSchema,
  answerEvent: answerEventIntentSchema,
  openInbox: openInboxIntentSchema,
  setAppearance: setAppearanceIntentSchema,
  takeRide: takeRideIntentSchema,
} as const;

export type IntentType = keyof typeof intentSchemas;
export const INTENT_TYPES = Object.keys(intentSchemas) as IntentType[];

export type IntentPayloads = {
  [T in IntentType]: z.infer<(typeof intentSchemas)[T]>;
};

export type Intent = {
  [T in IntentType]: { type: T; payload: IntentPayloads[T] };
}[IntentType];

export type ParseIntentResult =
  | { ok: true; intent: Intent }
  | { ok: false; error: string };

function isIntentType(type: string): type is IntentType {
  return Object.hasOwn(intentSchemas, type);
}

/**
 * Validates a raw message from the wire. Never throws, so a hostile client
 * cannot crash a room handler with a malformed message.
 */
export function parseIntent(type: string, payload: unknown): ParseIntentResult {
  if (!isIntentType(type)) {
    return { ok: false, error: `unknown intent: ${type.slice(0, 32)}` };
  }
  // Intents with no fields may arrive with no body at all.
  const body = payload === undefined || payload === null ? {} : payload;
  const result = intentSchemas[type].safeParse(body);
  if (!result.success) {
    return { ok: false, error: `invalid ${type} intent` };
  }
  // The schema was chosen by `type`, so the parsed payload matches it; TS cannot
  // correlate the two across the lookup, so the union is asserted here.
  return { ok: true, intent: { type, payload: result.data } as Intent };
}
