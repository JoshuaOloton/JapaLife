import { writeFileSync } from "node:fs";
import path from "node:path";
import { formatJson } from "./city/format";
import { PLANS_DIR, generateCities } from "./city/plans";
import { ContentError, DEFAULT_CONTENT_DIR, loadContent } from "./content/loadContent";

/**
 * `pnpm city`: writes `content/cities/<city>.json` from the plans in
 * `content/cities/plans/`, then loads all of content the way the server does,
 * so a plan that makes a broken district fails here, not at server start.
 * Developer-only output, so the text stays in code.
 */
const cities = generateCities(DEFAULT_CONTENT_DIR);
for (const city of cities) {
  const file = path.join(DEFAULT_CONTENT_DIR, "cities", `${city.id}.json`);
  const text = formatJson(city);
  writeFileSync(file, text);
  console.log(`wrote cities/${city.id}.json (${(text.length / 1000).toFixed(0)} KB) from ${PLANS_DIR}/${city.id}/`);
  for (const district of city.districts) {
    console.log(
      `  ${district.id}: ${district.halfWidth * 2} x ${district.halfDepth * 2} m, ${district.roads.length} roads, ` +
        `${district.buildings.length} buildings (${district.buildings.filter((b) => b.model).length} models), ` +
        `${district.props.length} props, ${district.npcs.length} NPCs, ${district.traffic?.lanes.length ?? 0} lanes`,
    );
  }
}

try {
  const started = Date.now();
  loadContent();
  console.log(`content check passed (${Date.now() - started} ms)`);
} catch (error) {
  if (!(error instanceof ContentError)) throw error;
  console.error(`the generated city fails the content check (${error.problems.length} problem(s)):`);
  for (const problem of error.problems.slice(0, 40)) console.error(`  - ${problem}`);
  process.exit(1);
}
