import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAME_EVENT_IDS,
  citySchema,
  gameEventSchema,
  jobsSchema,
  needsSchema,
  ngnEconomySchema,
  type CityConfig,
  type GameEventConfig,
  type GameEventId,
  type JobsConfig,
  type NeedsConfig,
  type NgnEconomyConfig,
} from "@japalife/shared";
import type { z } from "zod";

export type GameContent = {
  ngn: NgnEconomyConfig;
  needs: NeedsConfig;
  jobs: JobsConfig;
  events: Record<GameEventId, GameEventConfig>;
  cities: Record<string, CityConfig>;
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

  if (problems.length > 0 || !ngn || !needs || !jobs) throw new ContentError(problems);
  const allEvents = events as Record<GameEventId, GameEventConfig>;
  return {
    ngn,
    needs,
    jobs,
    events: allEvents,
    cities,
    todos: collectTodos(ngn, needs, jobs, allEvents),
  };
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
