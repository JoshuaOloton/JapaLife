import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDistrictLayout } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { checkLayout } from "../content/checkLayout";
import { DEFAULT_CONTENT_DIR, loadContent } from "../content/loadContent";
import { formatJson } from "./format";
import { generateDistrict } from "./generate";
import { type DistrictPlan, districtPlanSchema } from "./plan";
import { generateCities } from "./plans";

const content = loadContent();
const catalogs = { models: content.models, propKinds: content.propKinds };

/** A small district: a main road crossed by an inner street, and one landmark with a shop in it. */
function smallPlan(changes: Partial<DistrictPlan> = {}): DistrictPlan {
  return districtPlanSchema.parse({
    id: "test-district",
    name: "Test",
    seed: 1,
    halfWidth: 80,
    halfDepth: 80,
    spawn: { x: 0, z: 0 },
    interactRadius: 3,
    roadColour: "#4a4a4f",
    colours: ["#e8dcc0", "#a9c4d6"],
    shopLabels: ["Provisions"],
    classes: {
      main: { halfWidth: 4, setback: 4, traffic: true, poles: true, bumps: true, mix: [{ type: "shop", weight: 1 }, { type: "flats", weight: 1 }] },
      inner: { halfWidth: 3, setback: 3, traffic: true, poles: true, mix: [{ type: "house", weight: 1 }, { type: "kiosk", weight: 1 }] },
      lane: { halfWidth: 2, setback: 2.5, traffic: false, poles: false, mix: [{ type: "house", weight: 1 }] },
    },
    buildingTypes: {
      shop: { name: "Shop", frontage: [6, 9], depth: [6, 8], height: [3, 4] },
      house: { name: "House", frontage: [8, 12], depth: [7, 10], height: [3, 4] },
      flats: { name: "Flats", model: "flats-three-storey", scale: 5 },
      kiosk: { prop: "kiosk", labelled: true },
    },
    streets: [
      { id: "high-street", name: "High Street", axis: "ew", at: 0, class: "main" },
      { id: "side-street", name: "Side Street", axis: "ns", at: 20, class: "inner" },
      { id: "back-lane", axis: "ns", at: -40, class: "lane" },
    ],
    landmarks: [
      {
        id: "corner-shop",
        name: "Corner Shop",
        x: -20,
        z: -30,
        clear: { halfWidth: 10, halfDepth: 8 },
        interactables: [{ id: "corner-shop", label: "Corner Shop", kind: "home", position: { x: 0, z: 5 } }],
        buildings: [{ id: "corner-shop", name: "Corner Shop", x: 0, z: 0, halfWidth: 4, halfDepth: 3, height: 3, colour: "#ffffff" }],
      },
    ],
    scatter: { count: 10, kinds: ["tree-small", "palm"] },
    traffic: { fleet: [{ kind: "sedan", classes: ["main", "inner"], count: 4 }], pedestrians: 4 },
    ...changes,
  });
}

function layoutOf(plan: DistrictPlan) {
  return buildDistrictLayout(generateDistrict(plan, catalogs), content);
}

describe("generateDistrict", () => {
  it("makes a district that passes the layout check", () => {
    expect(checkLayout("test", layoutOf(smallPlan()))).toEqual([]);
  });

  it("gives the same district every time for the same plan, and another for another seed", () => {
    const once = generateDistrict(smallPlan(), catalogs);
    expect(generateDistrict(smallPlan(), catalogs)).toEqual(once);
    expect(generateDistrict(smallPlan({ seed: 2 }), catalogs)).not.toEqual(once);
  });

  it("copies a landmark as written, moved to where it stands, and builds nothing in its clear area", () => {
    const district = generateDistrict(smallPlan(), catalogs);
    expect(district.buildings.find((b) => b.id === "corner-shop")).toMatchObject({ x: -20, z: -30 });
    expect(district.interactables).toEqual([expect.objectContaining({ id: "corner-shop", position: { x: -20, z: -25 } })]);
    expect(district.landmarks).toEqual([{ id: "corner-shop", name: "Corner Shop", x: -20, z: -30 }]);
    const inClearArea = (thing: { x: number; z: number }) => Math.abs(thing.x + 20) < 10 && Math.abs(thing.z + 30) < 8;
    expect(district.buildings.filter((b) => b.id !== "corner-shop" && inClearArea(b))).toEqual([]);
    expect(district.props.filter(inClearArea)).toEqual([]);
  });

  it("turns each model building's front to its street", () => {
    const district = generateDistrict(smallPlan(), catalogs);
    const models = district.buildings.filter((b) => b.model && b.id.startsWith("high-street"));
    expect(models.length).toBeGreaterThan(0);
    for (const building of models) {
      // North of the road faces south (0), south of it faces north (180).
      expect(building.rotation).toBe(building.z < 0 ? 0 : 180);
    }
  });

  it("names roads after their streets and drives on the right", () => {
    const district = generateDistrict(smallPlan(), catalogs);
    expect(district.roads.map((road) => road.name)).toEqual(["High Street", "Side Street", undefined]);
    const lane = (id: string) => district.traffic?.lanes.find((l) => l.id === id)?.points;
    // Eastbound on the south half of an east-west road, northbound on the east half of a north-south one.
    expect(lane("high-street-east")?.every((p) => p.z > 0)).toBe(true);
    expect(lane("side-street-north")?.every((p) => p.x > 20)).toBe(true);
    expect(lane("side-street-north")?.[0]?.z).toBeGreaterThan(lane("side-street-north")?.[1]?.z ?? 0);
    // A lane has a walkway but no traffic.
    expect(lane("back-lane-north")).toBeUndefined();
    expect(district.traffic?.pedestrians.walkways.map((w) => w.id)).toContain("back-lane-walk");
  });

  it("strings every wire between at least two poles", () => {
    const district = generateDistrict(smallPlan(), catalogs);
    const poles = new Map<string, number>();
    for (const prop of district.props) if (prop.wire) poles.set(prop.wire, (poles.get(prop.wire) ?? 0) + 1);
    expect(poles.size).toBeGreaterThan(0);
    expect([...poles.values()].every((count) => count >= 2)).toBe(true);
  });
});

describe("the shipped city files", () => {
  it("are exactly what their plans generate (edit the plan and run pnpm city, never the city file)", () => {
    for (const city of generateCities(DEFAULT_CONTENT_DIR)) {
      const shipped = readFileSync(path.join(DEFAULT_CONTENT_DIR, "cities", `${city.id}.json`), "utf8");
      expect(shipped === formatJson(city), `cities/${city.id}.json is out of date: run pnpm city`).toBe(true);
    }
  });
});

describe("formatJson", () => {
  it("writes JSON that reads back the same, short things on one line", () => {
    const value = { name: "Yaba", list: [{ x: 1, z: -2.5 }, { x: 3, z: 4 }], nested: { deep: { deeper: [1, 2, 3] } }, gone: undefined };
    const text = formatJson(value);
    expect(JSON.parse(text)).toEqual({ name: "Yaba", list: [{ x: 1, z: -2.5 }, { x: 3, z: 4 }], nested: { deep: { deeper: [1, 2, 3] } } });
    expect(text).toContain('{ "x": 1, "z": -2.5 }');
  });
});
