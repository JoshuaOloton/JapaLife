import { z } from "zod";
import type { Interactable } from "./content";
import { REJECT_REASONS, type RejectReason } from "./messages";

/**
 * Every player-facing string lives in `content/copy/<language>.json`, so the
 * whole voice of the game can be read, reviewed and translated in one place.
 * Code reaches it through `COPY` in `copyText.ts` (typed from the file, so a
 * missing key fails typecheck) and fills `{placeholders}` with `fill`. Place
 * names, food, jobs and event text live with their own content files.
 */

/**
 * A string with exactly these `{placeholders}`: the ones in `required` must
 * appear, and any not listed in `required` or `optional` is a typo.
 */
function text(required: string[] = [], optional: string[] = []) {
  return z
    .string()
    .min(1)
    .max(400)
    .superRefine((value, ctx) => {
      const found = new Set(Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1] ?? ""));
      for (const name of required) {
        if (!found.has(name)) ctx.addIssue({ code: "custom", message: `must contain {${name}}` });
      }
      for (const name of found) {
        if (!required.includes(name) && !optional.includes(name)) {
          ctx.addIssue({ code: "custom", message: `unknown placeholder {${name}}` });
        }
      }
    });
}

const promptsSchema = z.strictObject({
  job_site: text([], ["place"]),
  food_vendor: text([], ["place"]),
  home: text([], ["place"]),
  bus_stop: text([], ["place"]),
  fuel_station: text([], ["place"]),
} satisfies Record<Interactable["kind"], unknown>);

const rejectionsSchema = z.strictObject(
  Object.fromEntries(REJECT_REASONS.map((reason) => [reason, text()])) as Record<RejectReason, ReturnType<typeof text>>,
);

export const copySchema = z.strictObject({
  language: z.string().regex(/^[a-z]{2,3}$/),
  app: z.strictObject({
    title: text(),
    description: text(),
    loading: text(),
    connecting: text(),
    serverUnreachable: text(),
    connectionLost: text(),
    reconnecting: text(),
    tryAgain: text(),
    badDistrict: text(),
  }),
  welcome: z.strictObject({
    title: text(),
    lead: text(),
    disclaimerHeading: text(),
    /** Paragraphs. `**text**` is shown bold. */
    disclaimer: z.array(text()).min(1).max(6),
    ageQuestion: text(),
    ageYes: text(),
    ageNo: text(),
    underage: text(),
  }),
  hud: z.strictObject({
    wallet: text(),
    clock: text(["day", "time"]),
    clockAtNight: text(["clock"]),
    rentIn: text(["time"]),
    rentDueNow: text(["time"]),
    rentOverdue: text(),
    hunger: text(),
    energy: text(),
    morale: text(),
    atWork: text(["time"]),
    noLight: text(["time"]),
    generatorRunning: text(["hours"]),
    noFuel: text(),
    generatorFuel: text(["hours"]),
    lowMorale: text(),
    foodPrices: text(["percent"]),
    fuelPrices: text(["percent"]),
    shiftsToday: text(["done", "max"]),
    disclaimer: text(),
    joystick: text(),
    close: text(),
    inbox: text(),
    inboxUnread: text(["count"]),
  }),
  inbox: z.strictObject({
    title: text(),
    empty: text(),
    new: text(),
  }),
  places: z.strictObject({
    /** The action button's text for each kind of place, unless the place sets its own `prompt`. */
    prompts: promptsSchema,
    jobTerms: text(["pay", "minutes", "energy"]),
    jobShiftsToday: text(["done", "max"]),
    startShift: text(),
    foodHunger: text(["hunger"]),
    foodEnergy: text(["energy"]),
    rent: text(),
    rentDueIn: text(["amount", "time"]),
    rentDueNow: text(["amount"]),
    rentOverdue: text(["amount"]),
    rentLateFee: text(["fee", "time"]),
    payRent: text(),
    noBuses: text(),
    fuelRuns: text(["hours"]),
    fuelInTank: text(["hours"]),
  }),
  /** The character creator, first time and "Change clothes" at home. Option names live in the character catalog. */
  creator: z.strictObject({
    title: text(),
    changeTitle: text(),
    body: text(),
    /** "Body 1", "Body 2": no gender label (decided 2026-10-20). */
    bodyOption: text(["number"]),
    skin: text(),
    hair: text(),
    hairColour: text(),
    outfit: text(),
    outfitColour: text(),
    /** Screen-reader label for a colour swatch, e.g. "Skin tone 3". */
    swatch: text(["row", "number"]),
    done: text(),
    cancel: text(),
    saving: text(),
    changeClothes: text(),
    /** Over the bedroom view: dragging turns your character round. */
    turnHint: text(),
  }),
  eventCard: z.strictObject({
    replyWithin: text(["time"]),
    cannotAfford: text(["amount"]),
  }),
  notices: z.strictObject({
    shiftPaidTitle: text(),
    shiftPaid: text(["amount"]),
    rentLateFeeTitle: text(),
    rentLateFee: text(["amount"]),
    rentLateFeeBroke: text(["amount"]),
  }),
  /** What the player is told when the server refuses an intent, one per reason. */
  rejections: rejectionsSchema,
});
export type Copy = z.infer<typeof copySchema>;
