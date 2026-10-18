import { describe, expect, it } from "vitest";
import { RUN_SPEED, WALK_SPEED } from "../gait";
import { CADENCE, type CharacterMotion, chooseClip, moveTimeScale } from "./animation";
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
  it("applies each gait's cadence to an exact ground match", () => {
    expect(moveTimeScale("run", clipInfo.run.metresPerSecond)).toBeCloseTo(CADENCE.run);
    expect(moveTimeScale("walk", clipInfo.walk.metresPerSecond)).toBeCloseTo(CADENCE.walk);
  });

  it("scales with the character's real speed", () => {
    expect(moveTimeScale("run", clipInfo.run.metresPerSecond / 2)).toBeCloseTo(CADENCE.run / 2);
  });

  it("plays the run near its recorded rate at running pace, so it does not look like hopping", () => {
    const rate = moveTimeScale("run", RUN_SPEED);
    expect(rate).toBeGreaterThan(0.9);
    expect(rate).toBeLessThan(1.1);
  });
});
