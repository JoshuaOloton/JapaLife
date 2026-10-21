import { describe, expect, it } from "vitest";
import { RUN_SPEED, WALK_SPEED } from "../gait";
import {
  CADENCE,
  type CharacterMotion,
  RUN_STANCE_MIX,
  calmBounce,
  chooseClip,
  moveTimeScale,
  runStanceWeight,
} from "./animation";
import clipInfo from "./clipInfo.generated.json";

const still: CharacterMotion = { speed: 0, working: false, gestureAt: Number.NEGATIVE_INFINITY };
const NOW = 100_000;
const GESTURE_SECONDS = 1.5;

describe("chooseClip", () => {
  it("idles when standing", () => {
    expect(chooseClip(still, NOW, GESTURE_SECONDS)).toBe("idle");
  });

  it("walks at walking pace and runs at running pace", () => {
    expect(chooseClip({ ...still, speed: WALK_SPEED }, NOW, GESTURE_SECONDS)).toBe("walk");
    expect(chooseClip({ ...still, speed: RUN_SPEED }, NOW, GESTURE_SECONDS)).toBe("run");
  });

  it("keeps moving animations even at work", () => {
    expect(chooseClip({ ...still, speed: WALK_SPEED, working: true }, NOW, GESTURE_SECONDS)).toBe("walk");
  });

  it("treats a crawl along a wall as standing", () => {
    expect(chooseClip({ ...still, speed: 0.1 }, NOW, GESTURE_SECONDS)).toBe("idle");
  });

  it("works only while working and standing", () => {
    expect(chooseClip({ ...still, working: true }, NOW, GESTURE_SECONDS)).toBe("work_phone");
  });

  it("gestures briefly after using a place, then goes back", () => {
    const used = { ...still, working: true, gestureAt: NOW - 500 };
    expect(chooseClip(used, NOW, GESTURE_SECONDS)).toBe("interact");
    expect(chooseClip(used, NOW + 2000, GESTURE_SECONDS)).toBe("work_phone");
  });

  it("drops the gesture as soon as the player moves off", () => {
    expect(chooseClip({ ...still, speed: WALK_SPEED, gestureAt: NOW - 100 }, NOW, GESTURE_SECONDS)).toBe("walk");
  });
});

describe("moveTimeScale", () => {
  it("applies each gait's cadence to an exact ground match, with the run's shortened stride", () => {
    const runStride = clipInfo.run.metresPerSecond * (1 - RUN_STANCE_MIX);
    expect(moveTimeScale("run", runStride)).toBeCloseTo(CADENCE.run);
    expect(moveTimeScale("walk", clipInfo.walk.metresPerSecond)).toBeCloseTo(CADENCE.walk);
  });

  it("scales with the character's real speed", () => {
    expect(moveTimeScale("run", RUN_SPEED / 2)).toBeCloseTo(moveTimeScale("run", RUN_SPEED) / 2);
  });

  it("plays the run a little quicker than its recorded rate at running pace, so the steps look swift, not hopping", () => {
    const rate = moveTimeScale("run", RUN_SPEED);
    expect(rate).toBeGreaterThan(1.1);
    expect(rate).toBeLessThan(1.4);
  });
});

describe("calmBounce", () => {
  it("halves the hips' up-and-down around the average height, leaving sway and posture alone", () => {
    // Three keys: x (sway), y (height: 0.9 to 1.1 around 1.0), z.
    const values = [0.1, 0.9, 0, -0.1, 1.1, 0, 0, 1.0, 0];
    calmBounce(values, 0.5);
    expect(values[1]).toBeCloseTo(0.95);
    expect(values[4]).toBeCloseTo(1.05);
    expect(values[7]).toBeCloseTo(1.0);
    expect([values[0], values[3]]).toEqual([0.1, -0.1]);
  });
});

describe("runStanceWeight", () => {
  it("makes the idle pose a quarter of a full run, and nothing when not running", () => {
    const run = 1;
    const stance = runStanceWeight(run);
    expect(stance / (run + stance)).toBeCloseTo(RUN_STANCE_MIX);
    expect(runStanceWeight(0)).toBe(0);
  });
});
