import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALWAYS_COVERED,
  GAME_EVENT_IDS,
  appearanceProblem,
  buildDistrictLayout,
  characterCatalogSchema,
  citySchema,
  copySchema,
  type Copy,
  gameEventSchema,
  jobsSchema,
  modelCatalogSchema,
  modelFootprintProblem,
  needsSchema,
  ngnEconomySchema,
  propBlockProblem,
  propKindsSchema,
  vehicleKindsSchema,
  type CharacterCatalog,
  type CityConfig,
  type GameEventConfig,
  type GameEventId,
  type JobsConfig,
  type LayoutCatalogs,
  type ModelCatalog,
  type NeedsConfig,
  type NgnEconomyConfig,
  type PropKinds,
  type VehicleKinds,
} from "@japalife/shared";
import type { z } from "zod";
import { checkLayout } from "./checkLayout";

export type GameContent = {
  ngn: NgnEconomyConfig;
  needs: NeedsConfig;
  jobs: JobsConfig;
  events: Record<GameEventId, GameEventConfig>;
  cities: Record<string, CityConfig>;
  /** 3D models by id, measured by the asset pipeline. */
  models: ModelCatalog["models"];
  /** Kinds of street prop by id: how each looks and what of it blocks. */
  propKinds: PropKinds["kinds"];
  /** Every option a character can have; players and NPCs store only ids into it. */
  characters: CharacterCatalog;
  /** Kinds of vehicle in the street traffic, and the schedule of how many are out by the hour. */
  vehicles: VehicleKinds;
  /** Player-facing text. The client bundles the same file; checking it here stops a bad edit at boot. */
  copy: Copy;
  /** Values flagged `TODO` in the files, unsure and waiting for review. Printed at boot. */
  todos: string[];
};

/** Thrown when `content/` is unusable. The message lists every problem, not just the first. */
export class ContentError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid content:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ContentError";
  }
}

export const DEFAULT_CONTENT_DIR = fileURLToPath(
  new URL("../../../../content", import.meta.url),
);

/**
 * For the server's startup: loads content, and if it is invalid prints a short,
 * readable list of what to fix (no stack trace) and exits with code 1, so the
 * server never runs on bad data. Anything other than a ContentError is a real
 * bug and is rethrown untouched.
 */
export function loadContentOrExit(contentDir?: string): GameContent {
  try {
    return loadContent(contentDir);
  } catch (error) {
    if (!(error instanceof ContentError)) throw error;
    console.error(
      [
        `japalife server cannot start: ${error.problems.length} problem(s) in content/`,
        ...error.problems.map((problem) => `  - ${problem}`),
        "",
        "Fix the file(s) above and start the server again.",
      ].join("\n"),
    );
    process.exit(1);
  }
}

/**
 * Reads and validates everything in `content/` that Phase 1 needs. Throws a
 * ContentError listing all problems, so the server refuses to start on bad data.
 */
export function loadContent(contentDir: string = DEFAULT_CONTENT_DIR): GameContent {
  const problems: string[] = [];

  function readJson<T extends z.ZodType>(relativePath: string, schema: T): z.infer<T> | undefined {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path.join(contentDir, relativePath), "utf8"));
    } catch (error) {
      problems.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const where = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
        problems.push(`${relativePath}${where}: ${issue.message}`);
      }
      return undefined;
    }
    return result.data;
  }

  function jsonFilesIn(dir: string): string[] {
    try {
      return readdirSync(path.join(contentDir, dir)).filter((name) => name.endsWith(".json"));
    } catch {
      problems.push(`${dir}/: folder not found`);
      return [];
    }
  }

  const ngn = readJson("economy/ngn.json", ngnEconomySchema);
  const needs = readJson("economy/needs.json", needsSchema);
  const jobs = readJson("economy/jobs.json", jobsSchema);
  const copy = readJson("copy/en.json", copySchema);
  const modelCatalog = readJson("models/catalog.json", modelCatalogSchema);
  const propKinds = readJson("props/kinds.json", propKindsSchema);
  const characters = readJson("characters/catalog.json", characterCatalogSchema);
  const vehicles = readJson("traffic/kinds.json", vehicleKindsSchema);

  const events: Partial<Record<GameEventId, GameEventConfig>> = {};
  for (const file of jsonFilesIn("events")) {
    const event = readJson(`events/${file}`, gameEventSchema);
    if (!event) continue;
    if (file !== `${event.id}.json`) {
      problems.push(`events/${file}: file name must match the event id "${event.id}"`);
    } else {
      events[event.id] = event;
    }
  }
  for (const id of GAME_EVENT_IDS) {
    if (!events[id]) problems.push(`events/${id}.json: missing (every game event needs a file)`);
  }

  const cities: Record<string, CityConfig> = {};
  for (const file of jsonFilesIn("cities")) {
    const city = readJson(`cities/${file}`, citySchema);
    if (!city) continue;
    if (file !== `${city.id}.json`) {
      problems.push(`cities/${file}: file name must match the city id "${city.id}"`);
    } else {
      cities[city.id] = city;
    }
  }
  if (!cities["lagos"]) problems.push("cities/lagos.json: missing (Phase 1 starts in Lagos)");

  if (ngn && jobs) problems.push(...crossCheck(ngn, jobs, Object.values(cities)));
  if (modelCatalog && characters) problems.push(...checkCharacters(characters, modelCatalog));
  if (modelCatalog && vehicles) problems.push(...checkVehicles(vehicles, modelCatalog));
  if (modelCatalog && propKinds && characters && vehicles) {
    const catalogs = { models: modelCatalog.models, propKinds: propKinds.kinds, characters, vehicles };
    problems.push(...checkWorld(catalogs, Object.values(cities)));
  }

  if (problems.length > 0 || !ngn || !needs || !jobs || !copy || !modelCatalog || !propKinds || !characters || !vehicles) {
    throw new ContentError(problems);
  }
  const allEvents = events as Record<GameEventId, GameEventConfig>;
  return {
    ngn,
    needs,
    jobs,
    events: allEvents,
    cities,
    models: modelCatalog.models,
    propKinds: propKinds.kinds,
    characters,
    vehicles,
    copy,
    todos: collectTodos(ngn, needs, jobs, allEvents),
  };
}

/**
 * The character catalog can always dress someone: every hair part is a real
 * model and fits every body, every outfit covers what it must, every section
 * offers at least one free starter option, and the defaults are free starters.
 */
function checkCharacters(characters: CharacterCatalog, catalog: ModelCatalog): string[] {
  const problems: string[] = [];
  const where = "characters/catalog.json";
  const bodies = Object.keys(characters.bodies);
  for (const [id, hair] of Object.entries(characters.hairs)) {
    const parts = Object.entries(hair.parts);
    for (const [body, model] of parts) {
      if (!characters.bodies[body]) problems.push(`${where} hair "${id}": part for unknown body "${body}"`);
      if (!catalog.models[model]) problems.push(`${where} hair "${id}": unknown model "${model}" (not in models/catalog.json; run pnpm assets?)`);
    }
    // Every hair fits every body (decided 2026-10-20), unless it has no parts at all (bald).
    if (parts.length > 0) {
      for (const body of bodies) {
        if (!hair.parts[body]) problems.push(`${where} hair "${id}": no part for body "${body}"`);
      }
    }
  }
  for (const [id, outfit] of Object.entries(characters.outfits)) {
    for (const region of ALWAYS_COVERED) {
      if (!outfit.chosen.includes(region) && !outfit.fixed[region]) {
        problems.push(`${where} outfit "${id}": leaves "${region}" bare (the underwear on the base texture would show)`);
      }
    }
  }
  for (const section of ["bodies", "skinTones", "hairs", "hairColours", "outfits", "outfitColours"] as const) {
    if (!Object.values(characters[section]).some((option) => option.starter)) {
      problems.push(`${where} ${section}: no starter option, so the creator would have nothing to offer`);
    }
  }
  const defaults = appearanceProblem(characters.defaults, characters, { starterOnly: true });
  if (defaults) problems.push(`${where} defaults: ${defaults.slot} is ${defaults.reason === "unknown" ? "not in the catalog" : "not a starter option"}`);
  return problems;
}

/** Every vehicle model exists. */
function checkVehicles(vehicles: VehicleKinds, catalog: ModelCatalog): string[] {
  const problems: string[] = [];
  for (const [id, kind] of Object.entries(vehicles.kinds)) {
    if (!catalog.models[kind.look.model]) {
      problems.push(`traffic/kinds.json "${id}": unknown model "${kind.look.model}" (not in models/catalog.json; run pnpm assets?)`);
    }
  }
  return problems;
}

/**
 * What you see is what stops you: every model exists, every building's model
 * fills its footprint, no prop blocks more than it shows, and each district's
 * layout (with its props, NPCs and traffic) passes `checkLayout`. Every NPC
 * wears something the character catalog has.
 */
function checkWorld(catalogs: LayoutCatalogs, cities: CityConfig[]): string[] {
  const { models, propKinds, characters } = catalogs;
  const problems: string[] = [];
  for (const [id, kind] of Object.entries(propKinds)) {
    const where = `props/kinds.json "${id}"`;
    if ("model" in kind.look && !models[kind.look.model]) {
      problems.push(`${where}: unknown model "${kind.look.model}" (not in models/catalog.json; run pnpm assets?)`);
      continue;
    }
    const problem = propBlockProblem(kind, models);
    if (problem) problems.push(`${where}: ${problem}`);
  }
  for (const city of cities) {
    for (const district of city.districts) {
      const where = `cities/${city.id}.json district "${district.id}"`;
      problems.push(...checkLayout(where, buildDistrictLayout(district, catalogs)));
      for (const group of district.traffic?.fleet ?? []) {
        if (!catalogs.vehicles.kinds[group.kind]) {
          problems.push(`${where}: fleet uses unknown vehicle kind "${group.kind}" (not in traffic/kinds.json)`);
        }
      }
      for (const npc of district.npcs) {
        // NPCs may wear non-starter clothes (a gateman's uniform); they only need to exist.
        const problem = appearanceProblem(npc.look, characters, { starterOnly: false });
        if (problem) problems.push(`cities/${city.id}.json NPC "${npc.id}": look ${problem.slot} is not in characters/catalog.json`);
      }
      for (const building of district.buildings) {
        if (!building.model) continue;
        const where = `cities/${city.id}.json building "${building.id}"`;
        const model = models[building.model];
        if (!model) {
          problems.push(`${where}: unknown model "${building.model}" (not in models/catalog.json; run pnpm assets?)`);
          continue;
        }
        const problem = modelFootprintProblem(building, model);
        if (problem) problems.push(`${where}: ${problem}`);
      }
    }
  }
  return problems;
}

function collectTodos(
  ngn: NgnEconomyConfig,
  needs: NeedsConfig,
  jobs: JobsConfig,
  events: Record<GameEventId, GameEventConfig>,
): string[] {
  const todos: string[] = [];
  const add = (where: string, note: string | undefined): void => {
    if (note) todos.push(`${where}: ${note}`);
  };
  add("economy/needs.json", needs.todo);
  add("economy/ngn.json busFareKobo", ngn.busFareTodo);
  add("economy/ngn.json rent", ngn.rent.todo);
  for (const item of ngn.food) add(`economy/ngn.json food "${item.id}"`, item.todo);
  for (const item of ngn.shop) add(`economy/ngn.json shop "${item.id}"`, item.todo);
  for (const job of jobs.jobs) add(`economy/jobs.json "${job.id}"`, job.todo);
  for (const event of Object.values(events)) add(`events/${event.id}.json`, event.todo);
  return todos;
}

/** Checks that ids are unique and that every reference points at something real. */
function crossCheck(ngn: NgnEconomyConfig, jobs: JobsConfig, cities: CityConfig[]): string[] {
  const problems: string[] = [];

  const duplicates = (label: string, ids: string[]): void => {
    for (const id of new Set(ids.filter((value, i) => ids.indexOf(value) !== i))) {
      problems.push(`${label}: duplicate id "${id}"`);
    }
  };

  const foodIds = new Set(ngn.food.map((item) => item.id));
  const jobIds = new Set(jobs.jobs.map((job) => job.id));
  duplicates("economy/ngn.json food", ngn.food.map((item) => item.id));
  duplicates("economy/jobs.json jobs", jobs.jobs.map((job) => job.id));
  duplicates("economy/ngn.json shop", ngn.shop.map((item) => item.id));
  const shopIds = new Set(ngn.shop.map((item) => item.id));

  for (const city of cities) {
    duplicates(`cities/${city.id}.json districts`, city.districts.map((d) => d.id));
    for (const district of city.districts) {
      const where = `cities/${city.id}.json district "${district.id}"`;
      duplicates(`${where} interactables`, district.interactables.map((i) => i.id));
      if (
        Math.abs(district.spawn.x) > district.halfWidth ||
        Math.abs(district.spawn.z) > district.halfDepth
      ) {
        problems.push(`${where}: spawn is outside the walkable area`);
      }
      for (const thing of district.interactables) {
        if (
          Math.abs(thing.position.x) > district.halfWidth ||
          Math.abs(thing.position.z) > district.halfDepth
        ) {
          problems.push(`${where}: "${thing.id}" is outside the walkable area`);
        }
        if (thing.kind === "job_site" && !jobIds.has(thing.jobId)) {
          problems.push(`${where}: "${thing.id}" uses unknown job "${thing.jobId}"`);
        }
        if (thing.kind === "fuel_station") {
          for (const shopId of thing.shopItemIds) {
            if (!shopIds.has(shopId)) {
              problems.push(`${where}: "${thing.id}" sells unknown shop item "${shopId}"`);
            }
          }
        }
        if (thing.kind === "food_vendor") {
          for (const foodId of thing.foodIds) {
            if (!foodIds.has(foodId)) {
              problems.push(`${where}: "${thing.id}" sells unknown food "${foodId}"`);
            }
          }
        }
      }
    }
  }
  return problems;
}
