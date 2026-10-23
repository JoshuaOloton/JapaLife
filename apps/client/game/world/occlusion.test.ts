import { describe, expect, it } from "vitest";
import { blocksView, stepFades } from "./occlusion";

// The church: 10.4 x 12.4 m, nearly 10 m tall, at (16, 44).
const church = { x: 16, z: 44, halfWidth: 5.2, halfDepth: 6.2, height: 9.9 };
const chest = (x: number, z: number) => ({ x, y: 1.2, z });
const cameraFor = (x: number, z: number) => ({ x, y: 9, z: z + 11 });

describe("blocksView", () => {
  it("is true for a tall building between the camera and the player (the player just north of it)", () => {
    expect(blocksView(church, cameraFor(16, 35), chest(16, 35))).toBe(true);
  });

  it("is false for a building beyond the player, or off to the side", () => {
    expect(blocksView(church, cameraFor(16, 60), chest(16, 60))).toBe(false);
    expect(blocksView(church, cameraFor(0, 35), chest(0, 35))).toBe(false);
  });

  it("is false for a low building the line passes over", () => {
    const shelter = { x: 16, z: 38, halfWidth: 1.6, halfDepth: 0.9, height: 2.6 };
    expect(blocksView(shelter, cameraFor(16, 35), chest(16, 35))).toBe(false);
  });
});

describe("stepFades", () => {
  const rule = { faded: 0.7, perSecond: 4, range: 35 };
  // A plain block on the south side of Commercial Avenue, and a rider on the road beside it.
  const block = { x: 63.6, z: 12.7, halfWidth: 5.3, halfDepth: 4.7, height: 9.2 };
  const far = { ...block, x: 200 };

  it("fades a building hiding the player over a few frames, and only that one", () => {
    const amounts = new Float32Array(2);
    expect(stepFades([block, far], amounts, cameraFor(63.6, 3.2), chest(63.6, 3.2), 0.1, rule)).toBe(true);
    expect(amounts[0]).toBeCloseTo(0.4);
    expect(amounts[1]).toBe(0);
    stepFades([block, far], amounts, cameraFor(63.6, 3.2), chest(63.6, 3.2), 0.1, rule);
    expect(amounts[0]).toBeCloseTo(0.7);
  });

  it("brings it back once the player has moved on, and reports no change when nothing moves", () => {
    const amounts = new Float32Array([0.7]);
    stepFades([block], amounts, cameraFor(100, 3.2), chest(100, 3.2), 0.1, rule);
    expect(amounts[0]).toBeCloseTo(0.3);
    stepFades([block], amounts, cameraFor(100, 3.2), chest(100, 3.2), 0.1, rule);
    expect(amounts[0]).toBe(0);
    expect(stepFades([block], amounts, cameraFor(100, 3.2), chest(100, 3.2), 0.1, rule)).toBe(false);
  });
});
