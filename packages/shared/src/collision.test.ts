import { describe, expect, it } from "vitest";
import { type Box, isBlocked, moveWithCollisions, reachableTargets } from "./collision";
import { PLAYER_RADIUS } from "./constants";

const bounds = { halfWidth: 50, halfDepth: 50 };
/** A wall segment: x from 10 to 12, long in z. */
const wall: Box = { x: 11, z: 0, halfWidth: 1, halfDepth: 20 };

describe("moveWithCollisions", () => {
  it("moves freely through open ground", () => {
    const end = moveWithCollisions({ x: 0, z: 0 }, { x: 3, z: -2 }, [], bounds);
    expect(end.x).toBeCloseTo(3, 9);
    expect(end.z).toBeCloseTo(-2, 9);
  });

  it("stops flush against a building and never overlaps it", () => {
    const end = moveWithCollisions({ x: 0, z: 0 }, { x: 20, z: 0 }, [wall], bounds);
    const edge = 10 - PLAYER_RADIUS; // the wall's near face, less the player's body
    expect(end.x).toBeLessThanOrEqual(edge);
    expect(end.x).toBeGreaterThan(edge - 0.2); // close to the wall, not stopped early
    expect(isBlocked(end, [wall])).toBe(false);
  });

  it("slides along a wall instead of sticking to it", () => {
    const end = moveWithCollisions({ x: 8, z: 0 }, { x: 5, z: 5 }, [wall], bounds);
    expect(end.z).toBeCloseTo(5, 5); // the sideways part of the move still happened
    expect(end.x).toBeLessThanOrEqual(10 - PLAYER_RADIUS);
  });

  it("cannot tunnel through a thin wall however far it moves in one go", () => {
    const thin: Box = { x: 5, z: 0, halfWidth: 0.05, halfDepth: 10 };
    const end = moveWithCollisions({ x: 0, z: 0 }, { x: 100, z: 0 }, [thin], bounds);
    expect(end.x).toBeLessThan(5);
  });

  it("stops at the edge of the district with the player's body inside it", () => {
    const end = moveWithCollisions({ x: 0, z: 0 }, { x: 500, z: -500 }, [], bounds);
    expect(end).toEqual({ x: 50 - PLAYER_RADIUS, z: -(50 - PLAYER_RADIUS) });
  });

  it("is deterministic, so client and server agree on the same inputs", () => {
    const a = moveWithCollisions({ x: 1.3, z: -2.7 }, { x: 9.1, z: 4.4 }, [wall], bounds);
    const b = moveWithCollisions({ x: 1.3, z: -2.7 }, { x: 9.1, z: 4.4 }, [wall], bounds);
    expect(a).toEqual(b);
  });

  it("does not move on a zero delta", () => {
    expect(moveWithCollisions({ x: 4, z: 4 }, { x: 0, z: 0 }, [wall], bounds)).toEqual({ x: 4, z: 4 });
  });

  it("gives the same result whether a walk is taken in one move or many small ones", () => {
    let walked = { x: 0, z: 0 };
    for (let i = 0; i < 100; i++) walked = moveWithCollisions(walked, { x: 0.2, z: 0.05 }, [wall], bounds);
    const jumped = moveWithCollisions({ x: 0, z: 0 }, { x: 20, z: 5 }, [wall], bounds);
    expect(walked.x).toBeCloseTo(jumped.x, 1);
    expect(walked.z).toBeCloseTo(jumped.z, 1);
  });
});

describe("reachableTargets", () => {
  it("finds open ground reachable", () => {
    expect(reachableTargets({ x: 0, z: 0 }, [{ x: 20, z: 20 }], 3, [wall], bounds)).toEqual([true]);
  });

  /** Four walls closing a 10 by 10 yard around (30, 30). */
  const yard: Box[] = [
    { x: 30, z: 25, halfWidth: 6, halfDepth: 0.5 },
    { x: 30, z: 35, halfWidth: 6, halfDepth: 0.5 },
    { x: 24, z: 30, halfWidth: 0.5, halfDepth: 6 },
    { x: 36, z: 30, halfWidth: 0.5, halfDepth: 6 },
  ];

  it("spots a location walled off by buildings", () => {
    expect(reachableTargets({ x: 0, z: 0 }, [{ x: 30, z: 30 }], 1, yard, bounds)).toEqual([false]);
  });

  it("still counts a spot just outside the wall as reachable", () => {
    expect(reachableTargets({ x: 0, z: 0 }, [{ x: 30, z: 22 }], 1, yard, bounds)).toEqual([true]);
  });

  it("treats a gap narrower than the player's body as closed, and a wide one as open", () => {
    const target = [{ x: 30, z: 30 }];
    // Open the south wall with a gap in the middle.
    const withGap = (gapHalf: number): Box[] => [
      { x: 30 - (gapHalf + 3), z: 25, halfWidth: 3, halfDepth: 0.5 },
      { x: 30 + (gapHalf + 3), z: 25, halfWidth: 3, halfDepth: 0.5 },
      ...yard.slice(1),
    ];
    const narrow = reachableTargets({ x: 30, z: 20 }, target, 1, withGap(0.3), bounds); // 0.6 wide
    const wide = reachableTargets({ x: 30, z: 20 }, target, 1, withGap(1.5), bounds); // 3 wide
    expect(narrow).toEqual([false]);
    expect(wide).toEqual([true]);
  });
});
