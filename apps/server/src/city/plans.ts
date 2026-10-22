import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  type CityConfig,
  modelCatalogSchema,
  propKindsSchema,
} from "@japalife/shared";
import type { z } from "zod";
import { generateDistrict } from "./generate";
import { cityPlanSchema, districtPlanSchema } from "./plan";

/** Where the hand-written plans live: one folder per city, with `city.json` and one file per district. */
export const PLANS_DIR = "cities/plans";

function readJson<T extends z.ZodType>(file: string, schema: T): z.infer<T> {
  const result = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".") || "(top)"}: ${issue.message}`);
    throw new Error(`${file}:\n${problems.join("\n")}`);
  }
  return result.data;
}

/**
 * Every city the plans describe, generated. Reads only the catalogs the
 * generator needs (models and prop kinds), not the city files it replaces, so
 * a broken city file never stops it from being regenerated.
 */
export function generateCities(contentDir: string): CityConfig[] {
  const catalogs = {
    models: readJson(path.join(contentDir, "models/catalog.json"), modelCatalogSchema).models,
    propKinds: readJson(path.join(contentDir, "props/kinds.json"), propKindsSchema).kinds,
  };
  const plansDir = path.join(contentDir, PLANS_DIR);
  return readdirSync(plansDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((cityFolder) => {
      const { districts, ...city } = readJson(path.join(plansDir, cityFolder, "city.json"), cityPlanSchema);
      if (city.id !== cityFolder) throw new Error(`${PLANS_DIR}/${cityFolder}/city.json: id "${city.id}" must match its folder`);
      return {
        generated: true as const,
        ...city,
        districts: districts.map((id) => {
          const plan = readJson(path.join(plansDir, cityFolder, `${id}.json`), districtPlanSchema);
          if (plan.id !== id) throw new Error(`${PLANS_DIR}/${cityFolder}/${id}.json: id "${plan.id}" must match its file name`);
          return generateDistrict(plan, catalogs);
        }),
      };
    });
}
