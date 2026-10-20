import { describe, expect, it } from "vitest";
import { skirtWeights } from "./skirtSkin";

const joints = {
  pelvis: { x: 0, y: 0.95, z: 0 },
  thighLeft: { x: 0.11, y: 0.95, z: 0 },
  thighRight: { x: -0.11, y: 0.95, z: 0 },
  knee: 0.54,
};
const bones = { pelvis: 1, thighLeft: 52, thighRight: 57 };

/** Weights of one vertex as { pelvis, left, right }. */
function weightsAt(x: number, y: number) {
  const { indices, weights } = skirtWeights([x, y, 0.1], joints, bones);
  expect([...indices.slice(0, 3)]).toEqual([1, 52, 57]);
  return { pelvis: weights[0]!, left: weights[1]!, right: weights[2]! };
}

describe("skirtWeights", () => {
  it("ties the waistband to the hips alone", () => {
    expect(weightsAt(0.12, 1.06)).toEqual({ pelvis: 1, left: 0, right: 0 });
  });

  it("lets the hem follow the nearer leg, never all the way", () => {
    const hem = weightsAt(0.14, 0.48);
    expect(hem.left).toBeCloseTo(0.8);
    expect(hem.right).toBe(0);
    expect(hem.pelvis).toBeCloseTo(0.2);
  });

  it("shares the middle of the hem between both legs", () => {
    const middle = weightsAt(0, 0.48);
    expect(middle.left).toBeCloseTo(middle.right);
  });

  it("always adds up to one", () => {
    for (const [x, y] of [[0.05, 0.8], [-0.2, 0.6], [0, 1.2], [0.3, 0.3]] as const) {
      const { pelvis, left, right } = weightsAt(x, y);
      expect(pelvis + left + right).toBeCloseTo(1);
    }
  });
});
