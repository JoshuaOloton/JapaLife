import { readFileSync } from "node:fs";
import { BUILT_PROP_SHAPES, type Prop, type PropKind, type QuarterTurn, propKindsSchema, turnHalfSize } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { builtPropSlabs, palmFronds, propLabels, turnPoint, wireSegments } from "./propShapes";

const shippedKinds = propKindsSchema.parse(
  JSON.parse(readFileSync(new URL("../../../../content/props/kinds.json", import.meta.url), "utf8")),
).kinds;
const ROTATIONS: QuarterTurn[] = [0, 90, 180, 270];
const EPSILON = 1e-9;

function builtKinds(): [string, Extract<PropKind["look"], { built: string }>][] {
  return Object.entries(shippedKinds).flatMap(([id, kind]) => ("built" in kind.look ? [[id, kind.look]] : []));
}

describe("builtPropSlabs", () => {
  it("has a builder for every built shape, and the shipped kinds use them", () => {
    const used = new Set(builtKinds().map(([, look]) => look.built));
    for (const shape of BUILT_PROP_SHAPES) expect(used, shape).toContain(shape);
  });

  it("never draws past the kind's declared footprint, at any rotation (so it never pokes through its collision box)", () => {
    for (const [id, look] of builtKinds()) {
      for (const rotation of ROTATIONS) {
        const prop: Prop = { kind: id, x: 10, z: -5, rotation };
        const footprint = turnHalfSize(look, rotation);
        for (const slab of builtPropSlabs(prop, look)) {
          expect(Math.abs(slab.x - prop.x) + slab.halfWidth, `${id} at ${rotation}`).toBeLessThanOrEqual(footprint.halfWidth + EPSILON);
          expect(Math.abs(slab.z - prop.z) + slab.halfDepth, `${id} at ${rotation}`).toBeLessThanOrEqual(footprint.halfDepth + EPSILON);
        }
      }
    }
  });

  it("turns parts the way three.js turns a model about y", () => {
    // A quarter turn takes the front (+z) to the east (+x).
    expect(turnPoint(0, 1, 90)).toEqual([1, -0]);
    expect(turnPoint(1, 0, 90)).toEqual([0, -1]);
    expect(turnPoint(1, 2, 180)).toEqual([-1, -2]);
    expect(turnPoint(1, 2, 270)).toEqual([-2, 1]);
  });
});

describe("wireSegments", () => {
  const pole = { look: { built: "electric_pole", halfWidth: 1, halfDepth: 0.15, height: 8 }, blocks: "none" } as const;
  const layout = {
    propKinds: { pole, generator: { look: { built: "generator", halfWidth: 0.5, halfDepth: 0.4, height: 0.8 }, blocks: "footprint" } } as const,
    props: [
      { kind: "pole", x: 0, z: 0, rotation: 0, wire: "a" },
      { kind: "pole", x: 0, z: 10, rotation: 0, wire: "a" },
      { kind: "pole", x: 0, z: 20, rotation: 0, wire: "a" },
      { kind: "pole", x: 50, z: 0, rotation: 0, wire: "b" },
      { kind: "pole", x: 50, z: 10, rotation: 0, wire: "b" },
      { kind: "pole", x: 99, z: 99, rotation: 0 },
    ] satisfies Prop[],
  };
  const points = wireSegments(layout);
  const segments = Array.from({ length: points.length / 6 }, (_, index) => points.slice(index * 6, index * 6 + 6));

  it("strings two wires per span, only between poles on the same line", () => {
    // Line a has 2 spans, line b has 1: 3 spans x 2 wires x 6 pieces.
    expect(segments).toHaveLength(3 * 2 * 6);
    for (const [ax, , az, bx, , bz] of segments) {
      expect(Math.abs((ax ?? 0) - (bx ?? 0))).toBeLessThan(1); // never from line a (x 0) to line b (x 50)
      expect(az).not.toBe(99);
      expect(bz).not.toBe(99);
    }
  });

  it("hangs from the crossarm ends and sags in the middle of a span", () => {
    const first = segments[0] ?? [];
    expect(first[0]).toBeCloseTo(-0.8, 9); // the west end of the crossarm
    expect(first[1]).toBeCloseTo(8 - 0.36, 9);
    const lowest = Math.min(...segments.slice(0, 6).map((segment) => segment[4] ?? 0));
    expect(lowest).toBeLessThan(8 - 0.36 - 0.2);
  });
});

describe("palms and labels", () => {
  const layout = {
    propKinds: shippedKinds,
    props: [
      { kind: "palm", x: 3, z: 4, rotation: 0 },
      { kind: "billboard", x: 0, z: 0, rotation: 90, label: "ChopRite Noodles" },
      { kind: "generator", x: 0, z: 0, rotation: 0, label: "ignored: generators have no face" },
    ] satisfies Prop[],
  };

  it("grows fronds from the top of each palm, the same way every time", () => {
    const fronds = palmFronds(layout);
    expect(fronds).toHaveLength(7);
    expect(fronds).toEqual(palmFronds(layout));
    for (const frond of fronds) expect(Math.hypot(frond.x - 3, frond.z - 4)).toBeLessThan(0.5);
  });

  it("puts a billboard's advert on its front, turned with it", () => {
    const labels = propLabels(layout);
    expect(labels).toHaveLength(1);
    const [advert] = labels;
    expect(advert?.text).toBe("ChopRite Noodles");
    expect(advert?.x).toBeGreaterThan(0); // a quarter turn faces the front east
    expect(advert?.rotationY).toBeCloseTo(Math.PI / 2, 9);
  });
});
