import {
  ROAD_CLASSES,
  buildingSchema,
  citySchema,
  contentIdSchema,
  interactableSchema,
  npcSchema,
  positionSchema,
  propSchema,
} from "@japalife/shared";
import { z } from "zod";

/**
 * The hand-written description of a district that `pnpm city` turns into the
 * full city file (`content/cities/<city>.json`). People decide the shape here
 * (streets, landmarks, what kind of buildings line each street) and the
 * generator does the repetitive placing. Only the generator reads these files;
 * the game reads what it writes.
 */

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** A [smallest, largest] range, picked from at random. */
const rangeSchema = z.tuple([z.number().positive(), z.number().positive()]).refine(([low, high]) => low <= high, {
  message: "a range is [smallest, largest]",
});
const areaSchema = z.strictObject({
  halfWidth: z.number().positive(),
  halfDepth: z.number().positive(),
});

/** One kind of thing that can stand along a street. */
const buildingTypeSchema = z.union([
  /** A model from the catalog, sized by its scale; its footprint is measured, not typed. */
  z.strictObject({ name: z.string().min(1).max(60), model: contentIdSchema, scale: z.number().positive().max(10).default(1) }),
  /** A plain painted box (one storey to a few), in the world's single instanced box call. */
  z.strictObject({ name: z.string().min(1).max(60), frontage: rangeSchema, depth: rangeSchema, height: rangeSchema }),
  /** A street prop that works as a small shop front (a kiosk, a container shop), sometimes with a painted name. */
  z.strictObject({ prop: contentIdSchema, labelled: z.boolean().default(false) }),
]);
export type BuildingType = z.infer<typeof buildingTypeSchema>;

/** Which building types line a street, and how often each comes up. */
const mixSchema = z.array(z.strictObject({ type: contentIdSchema, weight: z.number().positive() })).min(1);

const classSchema = z.strictObject({
  /** Half the road's width, metres. */
  halfWidth: z.number().positive(),
  /** Bare ground between the road edge and the building fronts, metres (gutters and poles stand in it). */
  setback: z.number().positive(),
  /** Two traffic lanes, one each way. */
  traffic: z.boolean(),
  /** Electric poles strung along both sides. */
  poles: z.boolean(),
  /** Speed bumps between junctions. */
  bumps: z.boolean().default(false),
  mix: mixSchema,
});

export const streetSchema = z.strictObject({
  id: contentIdSchema,
  /** Shown on the map. Lanes may go unnamed. */
  name: z.string().min(1).max(60).optional(),
  /** "ns" runs north to south (along z), "ew" east to west (along x). */
  axis: z.enum(["ns", "ew"]),
  /** Where it runs: its x for "ns", its z for "ew". */
  at: z.number(),
  /** Where it starts and ends along its length; the district edge if left out. */
  from: z.number().optional(),
  to: z.number().optional(),
  class: z.enum(ROAD_CLASSES),
});
export type Street = z.infer<typeof streetSchema>;

/**
 * A hand-placed place: everything in it is copied as written, positioned
 * relative to (x, z), so moving a landmark is one edit. Nothing generated is
 * put inside its `clear` area.
 */
const landmarkPlanSchema = z.strictObject({
  id: contentIdSchema,
  /** Drawn on the map. Leave out for a cluster that needs no label. */
  name: z.string().min(1).max(60).optional(),
  x: z.number(),
  z: z.number(),
  clear: areaSchema.optional(),
  interactables: z.array(interactableSchema).default([]),
  buildings: z.array(buildingSchema).default([]),
  props: z.array(propSchema).default([]),
  npcs: z.array(npcSchema).default([]),
});
export type LandmarkPlan = z.infer<typeof landmarkPlanSchema>;

export const districtPlanSchema = z
  .strictObject({
    id: contentIdSchema,
    name: z.string().min(1).max(60),
    /** The same plan and seed always give the same district, byte for byte. */
    seed: z.int().nonnegative(),
    halfWidth: z.number().positive(),
    halfDepth: z.number().positive(),
    spawn: positionSchema,
    interactRadius: z.number().positive(),
    roadColour: hexColour,
    /** Wall colours for plain buildings: Lagos's painted concrete. */
    colours: z.array(hexColour).min(1),
    /** Names painted on generated kiosks and container shops. Place flavour, so content, not copy. */
    shopLabels: z.array(z.string().min(1).max(60)).min(1),
    classes: z.strictObject({ main: classSchema, inner: classSchema, lane: classSchema }),
    buildingTypes: z.record(contentIdSchema, buildingTypeSchema),
    /** Areas whose streets get a different mix (markets), checked in order. */
    zones: z.array(z.strictObject({ id: contentIdSchema, x: z.number(), z: z.number(), ...areaSchema.shape, mix: mixSchema })).default([]),
    streets: z.array(streetSchema).min(1),
    landmarks: z.array(landmarkPlanSchema).default([]),
    /** Trees and palms dotted over open ground, away from roads and buildings. */
    scatter: z.strictObject({ count: z.int().nonnegative(), kinds: z.array(contentIdSchema).min(1) }),
    traffic: z.strictObject({
      fleet: z.array(
        z.strictObject({ kind: contentIdSchema, classes: z.array(z.enum(ROAD_CLASSES)).min(1), count: z.int().min(1).max(20) }),
      ),
      /** Where danfos pause; the lane ids are `<street id>-<east|west|north|south>`. */
      busStops: z.array(z.strictObject({ lane: contentIdSchema, at: positionSchema, seconds: z.number().positive().max(30).default(5) })).default([]),
      pedestrians: z.int().nonnegative(),
    }),
  })
  .superRefine((plan, context) => {
    for (const [index, entry] of [...Object.values(plan.classes).flatMap((c) => c.mix), ...plan.zones.flatMap((zone) => zone.mix)].entries()) {
      if (!plan.buildingTypes[entry.type]) {
        context.addIssue({ code: "custom", message: `mix entry ${index} uses unknown building type "${entry.type}"` });
      }
    }
  });
export type DistrictPlan = z.infer<typeof districtPlanSchema>;

/** The city's own fields (time zone, night hours) and the order of its districts. */
export const cityPlanSchema = citySchema
  .omit({ generated: true, districts: true })
  .extend({ districts: z.array(contentIdSchema).min(1) });
export type CityPlan = z.infer<typeof cityPlanSchema>;
