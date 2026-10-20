import { ANKARA_MOTIFS } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { ANKARA_SIZE, ankaraLayer, ankaraPixels } from "./ankara";

/** Points spread over the tile, away from the cell edges where rounding could flip a sample. */
const SAMPLES = Array.from({ length: 23 }, (_, index) => (index + 0.37) / 23);

describe("ankara prints", () => {
  it.each(ANKARA_MOTIFS)("%s tiles without a seam", (motif) => {
    for (const u of SAMPLES) {
      for (const v of SAMPLES) {
        const here = ankaraLayer(motif, u, v);
        expect(ankaraLayer(motif, u + 1, v)).toBe(here);
        expect(ankaraLayer(motif, u, v + 1)).toBe(here);
      }
    }
  });

  it.each(ANKARA_MOTIFS)("%s is bold: it uses at least three of its colours", (motif) => {
    const used = new Set<number>();
    for (const u of SAMPLES) for (const v of SAMPLES) used.add(ankaraLayer(motif, u, v));
    expect(used.size).toBeGreaterThanOrEqual(3);
  });

  it("paints the same pixels every time, all opaque", () => {
    const print = { motif: "suns", colours: ["#f2b134", "#8c2f39", "#1d4e89"] } as const;
    const pixels = ankaraPixels({ ...print, colours: [...print.colours] });
    expect(pixels).toEqual(ankaraPixels({ ...print, colours: [...print.colours] }));
    expect(pixels.length).toBe(ANKARA_SIZE * ANKARA_SIZE * 4);
    for (let at = 3; at < pixels.length; at += 4) expect(pixels[at]).toBe(255);
  });

  it("paints only the print's own colours, away from shape edges", () => {
    const pixels = ankaraPixels({ motif: "zigzag", colours: ["#ff0000", "#00ff00", "#0000ff", "#000000"] }, 64);
    const allowed = new Set(["255,0,0", "0,255,0", "0,0,255", "0,0,0"]);
    let pure = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      if (allowed.has(`${pixels[at]},${pixels[at + 1]},${pixels[at + 2]}`)) pure++;
    }
    // Edges blend two colours; most of the cloth is one colour or another.
    expect(pure / (pixels.length / 4)).toBeGreaterThan(0.6);
  });
});
