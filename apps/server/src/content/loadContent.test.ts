import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentError, DEFAULT_CONTENT_DIR, loadContent } from "./loadContent";

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
    expect(content.events.black_tax.effect.type).toBe("debit");
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

  it("rejects a debit event that uses a reason that is not a ledger sink", () => {
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
