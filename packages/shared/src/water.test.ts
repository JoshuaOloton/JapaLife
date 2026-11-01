import { describe, expect, it } from "vitest";
import { bridges, crossing, partlyOver, waterPieces } from "./water";

// A canal 8 m wide running north-south, and the roads around it.
const canal = { x: -183, z: 0, halfWidth: 4, halfDepth: 300 };
const eastWest = (z: number, halfDepth = 4) => ({ x: 0, z, halfWidth: 300, halfDepth });
const northSouth = { x: -150, z: 0, halfWidth: 3, halfDepth: 300 };

describe("crossing", () => {
  it("knows a road that crosses the water from side to side, and one that only clips it", () => {
    expect(crossing(canal, eastWest(0))).toBe("x");
    expect(crossing(canal, northSouth)).toBeNull(); // beside it, not over it
    expect(partlyOver(canal, { x: -180, z: 0, halfWidth: 2, halfDepth: 3 })).toBe(true); // a stub ending in the water
    expect(partlyOver(canal, eastWest(0))).toBe(false);
  });
});

describe("waterPieces", () => {
  it("cuts a canal at every road that bridges it, keeping the rest", () => {
    const pieces = waterPieces([canal], [eastWest(-120, 3), eastWest(0), northSouth]);
    expect(pieces).toEqual([
      { x: -183, halfWidth: 4, z: -211.5, halfDepth: 88.5 },
      { x: -183, halfWidth: 4, z: -60.5, halfDepth: 56.5 }, // from the first road's south edge (-117) to the second's north (-4)
      { x: -183, halfWidth: 4, z: 152, halfDepth: 148 },
    ]);
  });

  it("leaves a pond with no road over it whole", () => {
    const pond = { x: 80, z: -178, halfWidth: 9, halfDepth: 6 };
    expect(waterPieces([pond], [eastWest(0), northSouth])).toEqual([pond]);
  });

  it("drops a sliver where a road edge meets the water's edge", () => {
    const short = { x: 0, z: 10, halfWidth: 4, halfDepth: 6 }; // z 4 to 16
    expect(waterPieces([short], [eastWest(0, 4.01)])).toEqual([
      { x: 0, halfWidth: 4, z: expect.closeTo(10.005, 9), halfDepth: expect.closeTo(5.995, 9) },
    ]);  });
});

describe("bridges", () => {
  it("is the road over the water at each crossing", () => {
    expect(bridges([canal], [eastWest(0), northSouth])).toEqual([{ x: -183, z: 0, halfWidth: 4, halfDepth: 4 }]);
  });
});
