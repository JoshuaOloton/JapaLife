import { characterCatalogSchema } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { type Walker, randomStarterLook, stepWalker, walkerPose } from "./walkers";
import { QualityGovernor } from "./quality";
import { buildLane } from "./trafficSim";

const FAR_AWAY = { x: 500, z: 500 };

function walker(s: number, extra: Partial<Walker> = {}): Walker {
  return {
    id: 1,
    path: buildLane("edge", [{ x: 0, z: 3.6 }, { x: 20, z: 3.6 }]),
    s,
    direction: 1,
    pace: 1.2,
    hash: 0.3,
    appearance: { body: "body-1", skinTone: "tone-1", hair: "bald", hairColour: "black", outfit: "office", outfitColour: "red" },
    shown: true,
    moving: true,
    ...extra,
  };
}

describe("walkers", () => {
  it("walk to the end of their walkway and turn back", () => {
    const w = walker(19);
    for (let t = 0; t < 2; t += 0.1) stepWalker(w, 0.1, FAR_AWAY, 1);
    expect(w.direction).toBe(-1);
    expect(w.s).toBeLessThan(20);
    expect(walkerPose(w).heading).toBeCloseTo(Math.PI / 2 + Math.PI, 9); // facing back west
  });

  it("pause when the player stands right in front of them, and walk on once they move", () => {
    const w = walker(5);
    stepWalker(w, 0.1, { x: 5.8, z: 3.6 }, 1);
    expect(w.moving).toBe(false);
    expect(w.s).toBe(5);
    stepWalker(w, 0.1, { x: 5.8, z: 8 }, 1);
    expect(w.moving).toBe(true);
  });

  it("walk on past a player behind them", () => {
    const w = walker(5);
    stepWalker(w, 0.1, { x: 4.5, z: 3.6 }, 1);
    expect(w.moving).toBe(true);
  });

  it("only go home out of the player's sight when fewer people are out", () => {
    const w = walker(5, { hash: 0.6 });
    stepWalker(w, 0.1, { x: 6, z: 10 }, 0.35); // player close by: stays out
    expect(w.shown).toBe(true);
    stepWalker(w, 0.1, FAR_AWAY, 0.35);
    expect(w.shown).toBe(false);
  });

  it("wear random free starter clothes, never NPC uniforms", () => {
    const catalog = characterCatalogSchema.parse({
      bodies: { "body-1": { model: "male" } },
      skinTones: { "tone-1": { tint: "#ffffff" } },
      hairs: { bald: { name: "Bald", parts: {} } },
      hairColours: { black: { colour: "#000000" } },
      outfits: {
        office: { name: "Office", chosen: ["torso"], fixed: { hips: "#000000" } },
        uniform: { name: "Uniform", chosen: [], fixed: { torso: "#111111", hips: "#000000" }, starter: false },
      },
      outfitColours: { red: { colour: "#ff0000" } },
      defaults: { body: "body-1", skinTone: "tone-1", hair: "bald", hairColour: "black", outfit: "office", outfitColour: "red" },
    });
    let n = 0;
    const random = (): number => (n++ % 10) / 10;
    for (let i = 0; i < 20; i++) expect(randomStarterLook(catalog, random).outfit).toBe("office");
  });
});

describe("QualityGovernor", () => {
  /** Feeds frames at a steady rate for a while. */
  function feed(governor: QualityGovernor, from: number, seconds: number, fps: number): number {
    let now = from;
    for (let frame = 0; frame < seconds * fps; frame++) {
      now += 1000 / fps;
      governor.frame(now);
    }
    return now;
  }

  it("halves the street after 5 s below 30 fps, once the warm-up is over", () => {
    const governor = new QualityGovernor();
    let now = feed(governor, 0, 6, 20); // warm-up plus a little: not yet
    expect(governor.scale).toBe(1);
    now = feed(governor, now, 6, 20);
    expect(governor.scale).toBe(0.5);
    feed(governor, now, 10, 60); // and stays halved
    expect(governor.scale).toBe(0.5);
  });

  it("ignores a short dip", () => {
    const governor = new QualityGovernor();
    let now = feed(governor, 0, 6, 60);
    now = feed(governor, now, 3, 20);
    feed(governor, now, 10, 60);
    expect(governor.scale).toBe(1);
  });
});
