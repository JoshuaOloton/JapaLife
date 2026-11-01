import { type Box, bridges, waterPieces } from "@japalife/shared";
import type { Slab } from "./Boxes";

/**
 * Canals and ponds, as the street draws them: the water pieces left between
 * bridges (the same pieces the player is stopped at), a concrete lip round
 * each piece, and a parapet along each side of every bridge. The lips and
 * parapets join the world's single `Boxes` call; the water is one mesh
 * (`Water.tsx`).
 */

/** The water's surface, above the ground and below every road. */
export const WATER_Y = 0.015;
const LIP = { thickness: 0.4, height: 0.35, colour: "#bdb6a8" } as const;
const PARAPET = { thickness: 0.3, height: 0.8, colour: "#cbc4b6", overhang: 0.6 } as const;

/** The lips and parapets for every body of water. */
export function waterSlabs(water: readonly Box[], roads: readonly Box[]): Slab[] {
  const decks = bridges(water, roads);
  const touchesBridge = (x: number, z: number): boolean =>
    decks.some((deck) => Math.abs(x - deck.x) <= deck.halfWidth + 0.01 && Math.abs(z - deck.z) <= deck.halfDepth + 0.01);
  const t = LIP.thickness / 2;
  const lip = (x: number, z: number, halfWidth: number, halfDepth: number): Slab => ({
    x, z, halfWidth, halfDepth, height: LIP.height, colour: LIP.colour,
  });

  const slabs: Slab[] = [];
  for (const piece of waterPieces(water, roads)) {
    const { x, z, halfWidth: w, halfDepth: d } = piece;
    // North and south edges, then west and east; an edge that runs into a bridge has the road there, not a lip.
    if (!touchesBridge(x, z - d)) slabs.push(lip(x, z - d - t, w + 2 * t, t));
    if (!touchesBridge(x, z + d)) slabs.push(lip(x, z + d + t, w + 2 * t, t));
    if (!touchesBridge(x - w, z)) slabs.push(lip(x - w - t, z, t, d));
    if (!touchesBridge(x + w, z)) slabs.push(lip(x + w + t, z, t, d));
  }
  for (const deck of decks) {
    // The bridge runs the way its road does: along x if the deck is as wide as the water, so the parapets line its north and south.
    const alongX = water.some((body) => Math.abs(body.x - deck.x) < 0.01 && Math.abs(body.halfWidth - deck.halfWidth) < 0.01);
    const p = PARAPET.thickness / 2;
    for (const side of [-1, 1]) {
      slabs.push(
        alongX
          ? { x: deck.x, z: deck.z + side * (deck.halfDepth + p), halfWidth: deck.halfWidth + PARAPET.overhang, halfDepth: p, height: PARAPET.height, colour: PARAPET.colour }
          : { x: deck.x + side * (deck.halfWidth + p), z: deck.z, halfWidth: p, halfDepth: deck.halfDepth + PARAPET.overhang, height: PARAPET.height, colour: PARAPET.colour },
      );
    }
  }
  return slabs;
}

/** Slabs with the parts over water cut away (gutters stop at a canal; the parapet takes over). */
export function withoutWater(slabs: readonly Slab[], water: readonly Box[], roads: readonly Box[]): Slab[] {
  const pieces = waterPieces(water, roads);
  if (pieces.length === 0) return [...slabs];
  return slabs.flatMap((slab) =>
    // Each water piece crossing the slab cuts it, exactly as a road cuts a canal.
    waterPieces([slab], pieces).map((part) => ({ ...slab, ...part })),
  );
}
