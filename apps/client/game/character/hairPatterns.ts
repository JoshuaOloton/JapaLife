import { type HairPattern, seededRandom } from "@japalife/shared";

/**
 * Close-to-the-head hairstyles, painted in code onto the scalp cap: nothing
 * downloaded, just a small texture made at load. White is hair (the material
 * tints it the chosen hair colour) and clear is bare scalp, cut with an alpha
 * test, so the skin shows between cornrows and through a fade.
 *
 * The cap's texture coordinates come from straight above the head (see
 * assets/blender/hair_cap.py): u runs ear to ear, v forehead to nape, and the
 * middle of the texture is the crown. Pure, so it is unit-tested.
 */

export const HAIR_PATTERN_SIZE = 128;

/** Cornrows: this many rows from ear to ear, each with this many plaits from forehead to nape. */
const CORNROWS = 9;
const PLAITS_PER_ROW = 22;
/** How much of each row's width the braid fills (the rest is the parting between rows). */
const BRAID_WIDTH = 0.66;

/** Fade: full hair out to this far from the crown (0 crown, 1 the cap's edge), thinning to none at the edge. */
const FADE_FULL_TO = 0.5;
const FADE_GONE_AT = 0.95;

/** RGBA pixels, row by row, for a hair pattern. Deterministic: the same pattern every time. */
export function hairPatternPixels(pattern: HairPattern, size = HAIR_PATTERN_SIZE): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const random = seededRandom(pattern === "cornrows" ? 0xc0 : 0xfade);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const u = (column + 0.5) / size;
      const v = (row + 0.5) / size;
      const [shade, hair] = pattern === "cornrows" ? cornrow(u, v) : fade(u, v, random());
      const at = (row * size + column) * 4;
      const grey = Math.round(255 * shade);
      pixels[at] = grey;
      pixels[at + 1] = grey;
      pixels[at + 2] = grey;
      pixels[at + 3] = hair ? 255 : 0;
    }
  }
  return pixels;
}

/** Braids running forehead to nape, rounded and plaited, with partings of scalp between them. */
function cornrow(u: number, v: number): [number, boolean] {
  const across = u * CORNROWS;
  const fromCentre = Math.abs((across - Math.floor(across)) - 0.5) * 2; // 0 mid-braid, 1 at the parting
  // Each plait swells and narrows along the braid, like woven hair.
  const plait = 0.5 + 0.5 * Math.cos(v * PLAITS_PER_ROW * Math.PI * 2);
  const width = BRAID_WIDTH * (0.82 + 0.18 * plait);
  if (fromCentre > width) return [0, false];
  // Rounded across the braid, darker in the grooves between plaits.
  const shade = (1 - 0.35 * (fromCentre / width) ** 2) * (0.78 + 0.22 * plait);
  return [shade, true];
}

/** Short hair, full on top and thinning out toward the edge of the cap, flecked so it reads as hair. */
function fade(u: number, v: number, speck: number): [number, boolean] {
  const fromCrown = Math.hypot(u - 0.5, v - 0.5) * 2;
  const density =
    fromCrown <= FADE_FULL_TO ? 1 : Math.max(0, 1 - (fromCrown - FADE_FULL_TO) / (FADE_GONE_AT - FADE_FULL_TO));
  return [0.72 + 0.28 * speck, speck < density];
}
