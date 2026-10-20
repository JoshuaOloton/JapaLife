import type { AnkaraMotif, AnkaraPrint } from "@japalife/shared";

/**
 * Ankara (wax-print) fabric, painted in code: nothing downloaded, just a small
 * tiling texture made the first time someone wears the print. Each motif is a
 * function from a point on the tile to one of the print's colours, built from
 * a whole number of cells so the tile repeats without a seam. The designs are
 * our own, in the spirit of wax prints: bold shapes, three or four colours.
 * Pure, so it is unit-tested.
 */

export const ANKARA_SIZE = 128;

/** Colour layers of a print, in the order the catalog lists its colours. */
const GROUND = 0;
const MAIN = 1;
const ACCENT = 2;
const DETAIL = 3;

/** Samples per pixel along each side, averaged, so the shapes' edges are soft rather than stepped. */
const SUBSAMPLES = 2;

/** RGBA pixels, row by row, for a print. The same print paints the same pixels every time. */
export function ankaraPixels(print: AnkaraPrint, size = ANKARA_SIZE): Uint8Array {
  const colours = print.colours.map(rgb);
  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          const layer = ankaraLayer(
            print.motif,
            (column + (sx + 0.5) / SUBSAMPLES) / size,
            (row + (sy + 0.5) / SUBSAMPLES) / size,
          );
          // A three-colour print draws its detail in the main colour.
          const colour = colours[layer] ?? colours[MAIN] ?? [0, 0, 0];
          for (let channel = 0; channel < 3; channel++) sum[channel]! += colour[channel]!;
        }
      }
      const at = (row * size + column) * 4;
      for (let channel = 0; channel < 3; channel++) pixels[at + channel] = Math.round(sum[channel]! / SUBSAMPLES ** 2);
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

/** Which of the print's colours goes at (u, v) on the tile. Repeats every 1 in u and in v. */
export function ankaraLayer(motif: AnkaraMotif, u: number, v: number): number {
  return MOTIFS[motif](u, v);
}

const MOTIFS: Record<AnkaraMotif, (u: number, v: number) => number> = {
  /** Concentric rings, with dots where four cells meet. */
  rings(u, v) {
    const [x, y] = inCell(u, v, 3, 3);
    const d = Math.hypot(x, y);
    if (d < 0.07) return DETAIL;
    if (d < 0.14) return MAIN;
    if (d < 0.2) return ACCENT;
    if (d < 0.27) return MAIN;
    if (d < 0.31) return DETAIL;
    if (d < 0.36) return MAIN;
    return Math.hypot(0.5 - Math.abs(x), 0.5 - Math.abs(y)) < 0.09 ? ACCENT : GROUND;
  },

  /** Nested diamonds, with small ones between them. */
  diamonds(u, v) {
    const [x, y] = inCell(u, v, 4, 4);
    const m = Math.abs(x) + Math.abs(y);
    if (m < 0.08) return DETAIL;
    if (m < 0.18) return ACCENT;
    if (m < 0.24) return GROUND;
    if (m < 0.36) return MAIN;
    if (m < 0.4) return DETAIL;
    return Math.abs(0.5 - Math.abs(x)) + Math.abs(0.5 - Math.abs(y)) < 0.1 ? ACCENT : GROUND;
  },

  /** Leaves on the diagonal, alternating direction cell to cell, each with a midrib. */
  leaves(u, v) {
    // An even number of cells, or the alternation would not line up across the tile's edge.
    const [x, y] = inCell(u, v, 4, 4);
    const direction = mod(Math.floor(u * 4) + Math.floor(v * 4), 2) === 0 ? 1 : -1;
    const along = (x + direction * y) / Math.SQRT2;
    const across = (y - direction * x) / Math.SQRT2;
    const shape = (along / 0.42) ** 2 + (across / 0.17) ** 2;
    if (shape < 1) {
      if (Math.abs(across) < 0.014 && Math.abs(along) < 0.36) return DETAIL;
      return shape > 0.72 ? ACCENT : MAIN;
    }
    return Math.hypot(0.5 - Math.abs(x), 0.5 - Math.abs(y)) < 0.07 ? ACCENT : GROUND;
  },

  /** Wavy bands of three colours, edged with a dark line, with dots along the ground band. */
  waves(u, v) {
    const y = v * 6 + 0.18 * Math.sin(Math.PI * 2 * u * 2);
    const band = mod(Math.floor(y), 3);
    const f = y - Math.floor(y);
    if (f < 0.08) return DETAIL;
    if (band === 0) return Math.hypot(frac(u * 8) - 0.5, f - 0.54) < 0.18 ? MAIN : GROUND;
    return band === 1 ? MAIN : ACCENT;
  },

  /** Chevrons: zigzag bands of three colours, edged with a dark line. */
  zigzag(u, v) {
    const y = v * 6 + Math.abs(frac(u * 4) - 0.5) * 1.2;
    const band = mod(Math.floor(y), 3);
    if (y - Math.floor(y) < 0.1) return DETAIL;
    return band === 0 ? GROUND : band === 1 ? MAIN : ACCENT;
  },

  /** Big ringed dots on a half-drop grid, with small dots between. */
  dots(u, v) {
    const row = Math.floor(v * 4);
    const x = frac(u * 4 + (mod(row, 2) === 1 ? 0.5 : 0)) - 0.5;
    const y = frac(v * 4) - 0.5;
    const d = Math.hypot(x, y);
    if (d < 0.12) return MAIN;
    if (d < 0.17) return GROUND;
    if (d < 0.22) return ACCENT;
    return Math.hypot(Math.abs(x) - 0.5, y) < 0.07 ? DETAIL : GROUND;
  },

  /** Suns: a disc with rays and a ring around it, small diamonds in the corners. */
  suns(u, v) {
    const [x, y] = inCell(u, v, 3, 3);
    const d = Math.hypot(x, y);
    if (d < 0.1) return ACCENT;
    if (d < 0.13) return DETAIL;
    if (d < 0.3 && Math.cos(Math.atan2(y, x) * 12) > 0.2) return MAIN;
    if (d > 0.32 && d < 0.36) return ACCENT;
    return Math.abs(0.5 - Math.abs(x)) + Math.abs(0.5 - Math.abs(y)) < 0.12 ? DETAIL : GROUND;
  },

  /**
   * Fish scales: rows of round scales, each row shifted half a scale and lying
   * over the row above, each scale outlined and ringed.
   */
  scales(u, v) {
    const row = Math.floor(v * 4);
    const x = frac(u * 4 + (mod(row, 2) === 1 ? 0.5 : 0)) - 0.5;
    const y = frac(v * 4);
    const radius = 0.62;
    // The next row's scales (centred on this cell's bottom corners) lie on top.
    const below = Math.hypot(Math.abs(x) - 0.5, y - 1);
    const d = below < radius ? below : Math.hypot(x, y);
    // A bold edge and a fine inner line draw each scale's outline; a small dot sits at its root.
    if (d > radius - 0.1) return GROUND;
    if (d > radius - 0.15) return DETAIL;
    if (d < 0.12) return ACCENT;
    return MAIN;
  },
};

/** The point's position in its cell of an across x down grid, from -0.5 to 0.5 each way. */
function inCell(u: number, v: number, across: number, down: number): [number, number] {
  return [frac(u * across) - 0.5, frac(v * down) - 0.5];
}

function frac(value: number): number {
  return value - Math.floor(value);
}

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number];
}
