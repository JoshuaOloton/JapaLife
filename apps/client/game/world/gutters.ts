import type { Bounds, Box, Road } from "@japalife/shared";

/**
 * Open concrete gutters along both sides of every road, the way Lagos streets
 * drain. Visual only: they never block the player, so the server knows nothing
 * of them. Each one stops where it meets another road, with a concrete slab
 * over its end at the junction.
 */

/** Earth between the road edge and the gutter. */
export const GUTTER_VERGE = 0.25;
/** Outside width of a gutter, lip to lip. */
export const GUTTER_WIDTH = 0.9;
/** How far past a gutter's end the crossing slab reaches. */
const SLAB_LENGTH = 1.4;

export interface GutterPiece extends Box {
  /** Which way the gutter runs: along x or along z. */
  along: "x" | "z";
}

export interface GutterLayout {
  gutters: GutterPiece[];
  /** Concrete slabs covering gutter ends at junctions. */
  slabs: Box[];
}

/** A road's long axis, its centre line position, and its extent along and across. */
function axisOf(road: Road) {
  const along: "x" | "z" = road.halfWidth >= road.halfDepth ? "x" : "z";
  return along === "x"
    ? { along, centre: road.x, line: road.z, halfLength: road.halfWidth, halfAcross: road.halfDepth }
    : { along, centre: road.z, line: road.x, halfLength: road.halfDepth, halfAcross: road.halfWidth };
}

export function layOutGutters(roads: readonly Road[], bounds: Bounds): GutterLayout {
  const gutters: GutterPiece[] = [];
  const slabs: Box[] = [];

  for (const road of roads) {
    const { along, centre, line, halfLength, halfAcross } = axisOf(road);
    const limit = along === "x" ? bounds.halfWidth : bounds.halfDepth;
    const start = Math.max(centre - halfLength, -limit);
    const end = Math.min(centre + halfLength, limit);
    const offset = halfAcross + GUTTER_VERGE + GUTTER_WIDTH / 2;

    for (const side of [-1, 1]) {
      const across = line + side * offset;
      // Where other roads cross this gutter's line, it stops at their gutters.
      const gaps = roads
        .filter((other) => other !== road && axisOf(other).along !== along)
        .map((other) => {
          const crossing = axisOf(other);
          const reach = crossing.halfAcross + GUTTER_VERGE + GUTTER_WIDTH;
          const coversLine = Math.abs(across - crossing.centre) <= crossing.halfLength;
          return coversLine ? [crossing.line - reach, crossing.line + reach] as const : undefined;
        })
        .filter((gap) => gap !== undefined)
        .sort((a, b) => a[0] - b[0]);

      let from = start;
      for (const [gapStart, gapEnd] of [...gaps, [end, end] as const]) {
        const to = Math.min(gapStart, end);
        if (to - from > SLAB_LENGTH) gutters.push(piece(along, (from + to) / 2, across, (to - from) / 2));
        if (gapStart < end) {
          // Slabs bridge the gutter on both sides of the junction.
          if (to > from) slabs.push(piece(along, to - SLAB_LENGTH / 2, across, SLAB_LENGTH / 2));
          if (gapEnd < end) slabs.push(piece(along, gapEnd + SLAB_LENGTH / 2, across, SLAB_LENGTH / 2));
        }
        from = Math.max(from, gapEnd);
      }
    }
  }
  return { gutters, slabs };
}

function piece(along: "x" | "z", position: number, across: number, halfLength: number): GutterPiece {
  const halfWidth = GUTTER_WIDTH / 2;
  return along === "x"
    ? { along, x: position, z: across, halfWidth: halfLength, halfDepth: halfWidth }
    : { along, x: across, z: position, halfWidth, halfDepth: halfLength };
}
