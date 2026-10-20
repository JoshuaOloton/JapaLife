import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PLAYER_RADIUS, districtObstacles, isBlocked } from "@japalife/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DistrictMap } from "../game/district";
import { ContentError, DEFAULT_CONTENT_DIR, loadContent } from "./loadContent";

/** A valid character look from the shipped catalog. */
const LOOK = { body: "body-1", skinTone: "tone-4", hair: "low-cut", hairColour: "black", outfit: "office", outfitColour: "blue" };

describe("loadContent (real content/)", () => {
  it("loads and validates the shipped Phase 1 content", () => {
    const content = loadContent();
    const districts = content.cities["lagos"]?.districts ?? [];
    expect(districts.map((d) => d.id)).toEqual(["yaba"]);
    expect(districts[0]?.interactables.map((i) => i.kind).sort()).toEqual(
      ["bus_stop", "food_vendor", "fuel_station", "home", "job_site"].sort(),
    );
    // Every location has sign text, and the district has buildings and roads to draw.
    expect(districts[0]?.interactables.every((i) => i.label.length > 0)).toBe(true);
    expect(districts[0]?.buildings.length).toBeGreaterThan(0);
    expect(districts[0]?.roads.length).toBeGreaterThan(0);
    expect(content.jobs.jobs.map((j) => j.id)).toEqual(["office-assistant"]);
    expect(content.jobs.jobs[0]?.energyCost).toBeGreaterThan(0);
    expect(content.ngn.food.length).toBeGreaterThanOrEqual(4);
    expect(content.ngn.food.length).toBeLessThanOrEqual(5);
    expect(content.events.black_tax.effect.type).toBe("request");
    expect(content.events.power_cut.effect.type).toBe("blackout");
    expect(content.events.food_price_rise.effect.type).toBe("price_rise");
    expect(content.ngn.startingBalanceKobo).toBeGreaterThan(0);
  });

  it("reports the unsure values so they get reviewed", () => {
    const todos = loadContent().todos;
    expect(todos.length).toBeGreaterThan(0);
    expect(todos.every((t) => t.includes("TODO"))).toBe(true);
  });
});

describe("loadContent (broken content)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "japalife-content-"));
    cpSync(DEFAULT_CONTENT_DIR, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Rewrites one JSON file in the temp copy. */
  function edit(file: string, change: (json: Record<string, any>) => void): void { // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper pokes arbitrary JSON shapes
    const full = path.join(dir, file);
    const json = JSON.parse(readFileSync(full, "utf8"));
    change(json);
    writeFileSync(full, JSON.stringify(json));
  }

  function interactable(json: Record<string, any>, kind: string): Record<string, any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper pokes arbitrary JSON shapes
    return json["districts"][0].interactables.find((i: { kind: string }) => i.kind === kind);
  }

  function problemsOf(): string[] {
    try {
      loadContent(dir);
    } catch (error) {
      expect(error).toBeInstanceOf(ContentError);
      return (error as ContentError).problems;
    }
    throw new Error("expected loadContent to throw");
  }

  it("rejects a float amount (money is whole kobo)", () => {
    edit("economy/ngn.json", (j) => (j["startingBalanceKobo"] = 100.5));
    expect(problemsOf().join("\n")).toContain("economy/ngn.json at startingBalanceKobo");
  });

  it("rejects a file with neither a source nor a game-balance basis", () => {
    edit("economy/jobs.json", (j) => delete j["meta"].basis);
    expect(problemsOf().join("\n")).toContain("economy/jobs.json at meta");
  });

  it("refuses to boot on a copy file with a misspelled placeholder", () => {
    edit("copy/en.json", (j) => (j["notices"].shiftPaid = "You earned {amout}."));
    const problems = problemsOf().join("\n");
    expect(problems).toContain("copy/en.json at notices.shiftPaid: must contain {amount}");
    expect(problems).toContain("unknown placeholder {amout}");
  });

  it("rejects a request with no asks to pick from", () => {
    edit("events/black_tax.json", (j) => (j["effect"].asks = []));
    expect(problemsOf().join("\n")).toContain("events/black_tax.json at effect.asks");
  });

  it("rejects a request event that uses a reason that is not a ledger sink", () => {
    edit("events/black_tax.json", (j) => (j["effect"].reason = "shift_pay"));
    expect(problemsOf().join("\n")).toContain("events/black_tax.json at effect.reason");
  });

  it("rejects an event whose min amount exceeds its max", () => {
    edit("events/black_tax.json", (j) => (j["effect"].minKobo = j["effect"].maxKobo + 1));
    expect(problemsOf().join("\n")).toContain("minKobo must not exceed maxKobo");
  });

  it("rejects a missing event file", () => {
    rmSync(path.join(dir, "events/power_cut.json"));
    expect(problemsOf()).toContain("events/power_cut.json: missing (every game event needs a file)");
  });

  it("rejects a city job site that points at an unknown job", () => {
    edit("cities/lagos.json", (j) => (interactable(j, "job_site").jobId = "ghost-job"));
    expect(problemsOf().join("\n")).toContain('unknown job "ghost-job"');
  });

  it("rejects a food vendor that sells unknown food", () => {
    edit("cities/lagos.json", (j) => (interactable(j, "food_vendor").foodIds = ["ghost-rice"]));
    expect(problemsOf().join("\n")).toContain('unknown food "ghost-rice"');
  });

  it("rejects a fuel station that sells an unknown shop item", () => {
    edit("cities/lagos.json", (j) => (interactable(j, "fuel_station").shopItemIds = ["ghost-diesel"]));
    expect(problemsOf().join("\n")).toContain('unknown shop item "ghost-diesel"');
  });

  it("rejects an interactable placed outside the walkable area", () => {
    edit("cities/lagos.json", (j) => (interactable(j, "home").position.x = 999));
    expect(problemsOf().join("\n")).toContain("outside the walkable area");
  });

  it("rejects a spawn point inside a building", () => {
    edit("cities/lagos.json", (j) => {
      j["districts"][0].buildings.push({
        id: "on-spawn", name: "Oops", x: 0, z: 0, halfWidth: 3, halfDepth: 3, height: 3, colour: "#ffffff",
      });
    });
    expect(problemsOf().join("\n")).toContain("the spawn point is inside a building");
  });

  it("rejects a location that is inside a building", () => {
    edit("cities/lagos.json", (j) => {
      const office = interactable(j, "job_site").position;
      j["districts"][0].buildings.push({
        id: "over-office", name: "Oops", x: office.x, z: office.z, halfWidth: 3, halfDepth: 3, height: 3, colour: "#ffffff",
      });
    });
    expect(problemsOf().join("\n")).toContain('"yaba-office" is inside a building');
  });

  it("rejects a location walled in by buildings so nobody can walk to it", () => {
    edit("cities/lagos.json", (j) => {
      const { x, z } = interactable(j, "fuel_station").position;
      const wallOf = (id: string, dx: number, dz: number, halfWidth: number, halfDepth: number) => ({
        id, name: "Wall", x: x + dx, z: z + dz, halfWidth, halfDepth, height: 3, colour: "#ffffff",
      });
      j["districts"][0].buildings.push(
        wallOf("w-north", 0, -8, 9, 0.5),
        wallOf("w-south", 0, 8, 9, 0.5),
        wallOf("w-east", 8, 0, 0.5, 9),
        wallOf("w-west", -8, 0, 0.5, 9),
      );
    });
    expect(problemsOf().join("\n")).toContain('"yaba-fuel-station" cannot be reached on foot');
  });

  it("rejects a building that sticks out of the district", () => {
    edit("cities/lagos.json", (j) => {
      j["districts"][0].buildings[0].x = 58;
    });
    expect(problemsOf().join("\n")).toContain("sticks out of the walkable area");
  });

  it("rejects a building whose model is not in the catalog", () => {
    edit("cities/lagos.json", (j) => (j["districts"][0].buildings[0].model = "ghost-tower"));
    expect(problemsOf().join("\n")).toContain('unknown model "ghost-tower"');
  });

  describe("props and NPCs", () => {
    function addProp(prop: Record<string, unknown>): void {
      edit("cities/lagos.json", (j) => j["districts"][0].props.push(prop));
    }
    function addNpc(npc: Record<string, unknown>): void {
      edit("cities/lagos.json", (j) => j["districts"][0].npcs.push(npc));
    }

    it("rejects a prop on the spawn point", () => {
      addProp({ kind: "generator", x: 0.2, z: 0 });
      expect(problemsOf().join("\n")).toContain("the spawn point is inside a building, prop or person");
    });

    it("rejects a prop over a place", () => {
      edit("cities/lagos.json", (j) => {
        const { x, z } = interactable(j, "job_site").position;
        j["districts"][0].props.push({ kind: "kiosk", x, z });
      });
      expect(problemsOf().join("\n")).toContain('"yaba-office" is inside a building, prop or person');
    });

    it("rejects props that wall a place off", () => {
      edit("cities/lagos.json", (j) => {
        const { x, z } = interactable(j, "fuel_station").position;
        // A ring of container shops (6 x 2.4 m each), 5 m out from the pump.
        for (const dx of [-6, 0, 6]) {
          j["districts"][0].props.push({ kind: "container-shop", x: x + dx, z: z - 5 });
          j["districts"][0].props.push({ kind: "container-shop", x: x + dx, z: z + 5 });
        }
        for (const dz of [-3, 3]) {
          j["districts"][0].props.push({ kind: "container-shop", x: x - 7.8, z: z + dz, rotation: 90 });
          j["districts"][0].props.push({ kind: "container-shop", x: x + 7.8, z: z + dz, rotation: 90 });
        }
      });
      expect(problemsOf().join("\n")).toContain('"yaba-fuel-station" cannot be reached on foot');
    });

    it("rejects a blocking prop in the road, but not a speed bump", () => {
      addProp({ kind: "generator", x: 20, z: 2 });
      addProp({ kind: "speed-bump", x: 25, z: 0 });
      const problems = problemsOf().join("\n");
      expect(problems).toContain('("generator" at 20, 2) blocks a road');
      expect(problems).not.toContain('"speed-bump" at 25, 0');
    });

    it("rejects a prop that sticks out of the district", () => {
      addProp({ kind: "container-shop", x: 58.5, z: 20 });
      expect(problemsOf().join("\n")).toContain('"container-shop" at 58.5, 20) sticks out of the walkable area');
    });

    it("rejects an unknown prop kind", () => {
      addProp({ kind: "ghost-kiosk", x: 20, z: 20 });
      expect(problemsOf().join("\n")).toContain('"ghost-kiosk" at 20, 20) is an unknown kind');
    });

    it("rejects a prop kind whose model is not in the catalog", () => {
      edit("props/kinds.json", (j) => (j["kinds"]["bench"].look.model = "ghost-bench"));
      expect(problemsOf().join("\n")).toContain('props/kinds.json "bench": unknown model "ghost-bench"');
    });

    it("rejects a blocking box bigger than what is drawn (an invisible wall)", () => {
      edit("props/kinds.json", (j) => (j["kinds"]["palm"].blocks = { halfWidth: 3, halfDepth: 0.25 }));
      expect(problemsOf().join("\n")).toContain('props/kinds.json "palm": blocking width 6.00 m is bigger than the drawn 4.40 m');
    });

    it("rejects a wire with only one pole", () => {
      addProp({ kind: "electric-pole", x: 20, z: 20, wire: "lonely" });
      expect(problemsOf().join("\n")).toContain('wire "lonely" has only one pole');
    });

    it("rejects a wire on something that is not a pole", () => {
      addProp({ kind: "generator", x: 20, z: 20, wire: "main-north-east" });
      expect(problemsOf().join("\n")).toContain("has a wire but is not an electric pole");
    });

    it("rejects an NPC standing in the road, and duplicate NPC ids", () => {
      addNpc({ id: "mama-put", look: LOOK, pose: "idle", x: 20, z: 1 });
      const problems = problemsOf().join("\n");
      expect(problems).toContain('duplicate NPC id "mama-put"');
      expect(problems).toContain('NPC "mama-put" stands in a road');
    });

    it("rejects an NPC wearing something the character catalog does not have, but allows non-starter clothes", () => {
      addNpc({ id: "ghost", look: { ...LOOK, outfit: "agbada" }, pose: "idle", x: 20, z: 20 });
      addNpc({ id: "guard", look: { ...LOOK, outfit: "security-uniform" }, pose: "idle", x: 22, z: 20 });
      const problems = problemsOf().join("\n");
      expect(problems).toContain('NPC "ghost": look outfit is not in characters/catalog.json');
      expect(problems).not.toContain('NPC "guard"');
    });

    it("stops the player at a prop on the server, exactly where the shared obstacles say", () => {
      const content = loadContent();
      const yaba = new DistrictMap(content.cities["lagos"]!.districts[0]!, content);
      // The kiosk at (-8, 8) is 2 m wide: walking east into it from (-14, 8) stops at its west face.
      const end = yaba.move({ x: -14, z: 8 }, { x: 10, z: 0 });
      const westFace = -8 - 1 - PLAYER_RADIUS;
      expect(end.x).toBeLessThanOrEqual(westFace);
      expect(end.x).toBeGreaterThan(westFace - 0.2);
      expect(isBlocked(end, districtObstacles(yaba.layout))).toBe(false);
    });
  });

  describe("traffic", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper pokes arbitrary JSON shapes
    const traffic = (j: Record<string, any>): Record<string, any> => j["districts"][0].traffic;

    it("rejects a lane that leaves the road inside the district", () => {
      edit("cities/lagos.json", (j) => traffic(j).lanes.push({ id: "shortcut", points: [{ x: -20, z: 2 }, { x: -20, z: 30 }] }));
      expect(problemsOf().join("\n")).toContain('lane "shortcut" leaves the road');
    });

    it("lets a lane run past the district edge, so vehicles arrive off-screen", () => {
      // The shipped lanes start and end at +-75, outside the 60 m district.
      expect(() => loadContent(dir)).not.toThrow();
    });

    it("rejects a walkway that runs through a building", () => {
      edit("cities/lagos.json", (j) =>
        traffic(j).pedestrians.walkways.push({ id: "through-the-office", points: [{ x: 20, z: -18 }, { x: 36, z: -18 }] }),
      );
      expect(problemsOf().join("\n")).toContain('walkway "through-the-office" runs into something');
    });

    it("rejects a walkway through Mama Put", () => {
      edit("cities/lagos.json", (j) =>
        traffic(j).pedestrians.walkways.push({ id: "past-the-buka", points: [{ x: -15.2, z: 10 }, { x: -15.2, z: 15.5 }] }),
      );
      expect(problemsOf().join("\n")).toContain('walkway "past-the-buka" runs into something');
    });

    it("rejects a fleet of an unknown kind or on an unknown lane, and a bus stop off its lane", () => {
      edit("cities/lagos.json", (j) => {
        traffic(j).fleet.push({ kind: "molue", lanes: ["main-east"], count: 1 });
        traffic(j).fleet.push({ kind: "keke", lanes: ["flyover"], count: 1 });
        traffic(j).busStops.push({ lane: "main-east", at: { x: 10, z: -2 } });
      });
      const problems = problemsOf().join("\n");
      expect(problems).toContain('unknown vehicle kind "molue"');
      expect(problems).toContain('uses unknown lane "flyover"');
      expect(problems).toContain('bus stop at 10, -2 is not on lane "main-east"');
    });

    it("rejects a vehicle model not in the catalog, and paint on a model with no measured paint", () => {
      edit("traffic/kinds.json", (j) => {
        j["kinds"]["sedan"].look.model = "molue";
        j["kinds"]["taxi"].look.paint = "#f2b705";
      });
      const problems = problemsOf().join("\n");
      expect(problems).toContain('traffic/kinds.json "sedan": unknown model "molue"');
      expect(problems).toContain('traffic/kinds.json "taxi": model "taxi" has no measured paint cells');
    });
  });

  describe("character catalog", () => {
    it("rejects a hair part that is not a built model", () => {
      edit("characters/catalog.json", (j) => (j["hairs"]["low-cut"].parts["body-1"] = "hair-ghost"));
      expect(problemsOf().join("\n")).toContain('hair "low-cut": unknown model "hair-ghost"');
    });

    it("rejects a hair that does not fit every body", () => {
      edit("characters/catalog.json", (j) => delete j["hairs"]["low-cut"].parts["body-2"]);
      expect(problemsOf().join("\n")).toContain('hair "low-cut": no part for body "body-2"');
    });

    it("rejects an outfit that leaves the hips bare", () => {
      edit("characters/catalog.json", (j) => (j["outfits"]["tshirt-jeans"].fixed = { foot: "#262626" }));
      expect(problemsOf().join("\n")).toContain('outfit "tshirt-jeans": leaves "hips" bare');
    });

    it("rejects defaults that are not free starter options", () => {
      edit("characters/catalog.json", (j) => (j["defaults"].outfit = "security-uniform"));
      expect(problemsOf().join("\n")).toContain("defaults: outfit is not a starter option");
    });
  });

  describe("model footprints", () => {
    // Gives the office block a 14 m wide (x) by 12 m deep (z) footprint, dressed by a test model.
    function withOfficeModel(halfWidth: number, halfDepth: number, building: Record<string, unknown> = {}): void {
      edit("models/catalog.json", (j) => {
        j["models"]["test-office"] = { file: "buildings/test-office.glb", halfWidth, halfDepth, height: 9, triangles: 100, bytes: 1000 };
      });
      edit("cities/lagos.json", (j) =>
        Object.assign(j["districts"][0].buildings[0], { halfWidth: 7, halfDepth: 6, model: "test-office", scale: 1, ...building }),
      );
    }

    it("accepts a model that fills its footprint, and sends only the models a district uses", () => {
      withOfficeModel(7.2, 5.8);
      edit("models/catalog.json", (j) => {
        j["models"]["unused"] = { file: "buildings/unused.glb", halfWidth: 1, halfDepth: 1, height: 1, triangles: 1, bytes: 1 };
      });
      const content = loadContent(dir);
      const yaba = new DistrictMap(content.cities["lagos"]!.districts[0]!, content);
      expect(Object.keys(yaba.layout.models)).toContain("test-office");
      expect(Object.keys(yaba.layout.models)).not.toContain("unused");
      expect(Object.keys(yaba.layout.models)).not.toContain("office-block"); // replaced by the test model
    });

    it("rejects a model bigger than its footprint (an invisible wall would let you walk into it)", () => {
      withOfficeModel(7.5, 6);
      expect(problemsOf().join("\n")).toContain("model width 15.00 m is bigger than the footprint's 14.00 m");
    });

    it("rejects a model too small for its footprint (you would bump into thin air)", () => {
      withOfficeModel(7, 4);
      expect(problemsOf().join("\n")).toContain("model depth 8.00 m fills too little");
    });

    it("swaps width and depth for a quarter turn", () => {
      withOfficeModel(6, 7, { rotation: 90 });
      expect(() => loadContent(dir)).not.toThrow();
    });

    it("applies the building's scale", () => {
      withOfficeModel(3.5, 3, { scale: 2 });
      expect(() => loadContent(dir)).not.toThrow();
    });

    it("rejects a rotation that is not a quarter turn", () => {
      withOfficeModel(7, 6, { rotation: 45 });
      expect(problemsOf().join("\n")).toContain("buildings.0.rotation");
    });
  });

  it("rejects an invalid building colour", () => {
    edit("cities/lagos.json", (j) => (j["districts"][0].buildings[0].colour = "red"));
    expect(problemsOf().join("\n")).toContain("buildings.0.colour");
  });

  it("rejects a location with no sign text", () => {
    edit("cities/lagos.json", (j) => delete interactable(j, "bus_stop").label);
    expect(problemsOf().join("\n")).toContain("label");
  });

  it("rejects duplicate ids", () => {
    edit("economy/ngn.json", (j) => j["food"].push({ ...j["food"][0] }));
    expect(problemsOf().join("\n")).toContain('duplicate id "agege-bread"');
  });

  it("rejects unknown fields (typos must not pass silently)", () => {
    edit("economy/ngn.json", (j) => (j["rent"].amountKobbo = 1));
    expect(problemsOf().join("\n")).toContain("economy/ngn.json at rent");
  });

  it("rejects malformed JSON and reports every problem, not just the first", () => {
    writeFileSync(path.join(dir, "economy/jobs.json"), "{ not json");
    edit("economy/ngn.json", (j) => (j["rent"].periodDays = 0));
    const problems = problemsOf();
    expect(problems.some((p) => p.startsWith("economy/jobs.json"))).toBe(true);
    expect(problems.some((p) => p.startsWith("economy/ngn.json"))).toBe(true);
  });

  it("rejects an event file whose name does not match its id", () => {
    edit("events/black_tax.json", (j) => (j["id"] = "power_cut"));
    expect(problemsOf().join("\n")).toContain("file name must match the event id");
  });
});
