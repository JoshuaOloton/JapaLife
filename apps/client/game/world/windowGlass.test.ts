import { describe, expect, it } from "vitest";
import { uvCellFlags } from "./windowGlass";
import { modelWindowsLit } from "./windows";

const glass = [[0.5, 0.5, 0.75, 0.75]] as const;

describe("uvCellFlags", () => {
  it("flags the corners of triangles painted from the glass cell, and nothing else", () => {
    // Triangle 0 sits inside the glass cell; triangle 1 is wall.
    const uvs = [0.55, 0.55, 0.7, 0.55, 0.6, 0.7, 0.1, 0.1, 0.2, 0.1, 0.1, 0.2];
    expect([...uvCellFlags(uvs, null, glass)]).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it("decides by a triangle's centre, so a corner on the cell's edge does not drag the wall in", () => {
    // A wall triangle with one corner exactly on the glass cell's corner; a glass triangle filling the cell.
    const uvs = [0.5, 0.5, 0.4, 0.5, 0.4, 0.4, 0.5, 0.5, 0.75, 0.5, 0.75, 0.75];
    const flags = uvCellFlags(uvs, [0, 1, 2, 3, 4, 5], glass);
    expect([...flags]).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("follows the index for shared corners", () => {
    const uvs = [0.55, 0.55, 0.7, 0.55, 0.6, 0.7, 0.1, 0.1];
    expect([...uvCellFlags(uvs, [0, 1, 2, 0, 2, 3], glass)]).toEqual([1, 1, 1, 0]);
  });
});

describe("modelWindowsLit", () => {
  it("lights every model building at night, none by day", () => {
    expect(modelWindowsLit("yaba-office-block", "night")).toBe(true);
    expect(modelWindowsLit("yaba-office-block", "day")).toBe(false);
  });

  it("keeps only some buildings lit in a power cut, the same ones every time", () => {
    const ids = Array.from({ length: 200 }, (_, index) => `building-${index}`);
    const lit = ids.filter((id) => modelWindowsLit(id, "blackout"));
    expect(lit.length).toBeGreaterThan(40);
    expect(lit.length).toBeLessThan(110);
    expect(ids.filter((id) => modelWindowsLit(id, "blackout"))).toEqual(lit);
  });
});
