import type { Box } from "./collision";

/**
 * Canals and ponds meet roads at bridges: a road that crosses water fully
 * (one side of the water to the other) is its bridge deck. The water is cut
 * into the pieces between the roads, and those pieces are what is drawn and
 * what blocks walking, so a bridge is walked like any road.
 */

/** Pieces thinner than this are dropped (a road edge landing exactly on the water's edge). */
const SLIVER = 0.05;

/** Whether a road crosses the water from one side to the other: along x (`"x"`), along z (`"z"`), or not. */
export function crossing(water: Box, road: Box): "x" | "z" | null {
  const overlapX = Math.abs(water.x - road.x) < water.halfWidth + road.halfWidth;
  const overlapZ = Math.abs(water.z - road.z) < water.halfDepth + road.halfDepth;
  if (!overlapX || !overlapZ) return null;
  const coversX = road.x - road.halfWidth <= water.x - water.halfWidth && road.x + road.halfWidth >= water.x + water.halfWidth;
  const coversZ = road.z - road.halfDepth <= water.z - water.halfDepth && road.z + road.halfDepth >= water.z + water.halfDepth;
  // A road covering the water's whole width runs across it along x (an east-west road over a north-south canal).
  if (coversX && !coversZ) return "x";
  if (coversZ && !coversX) return "z";
  return null;
}

/** Whether a road overlaps the water without crossing it from side to side (the content check refuses this). */
export function partlyOver(water: Box, road: Box): boolean {
  const overlapX = Math.abs(water.x - road.x) < water.halfWidth + road.halfWidth;
  const overlapZ = Math.abs(water.z - road.z) < water.halfDepth + road.halfDepth;
  return overlapX && overlapZ && crossing(water, road) === null;
}

/** The water left once every road crossing it is cut out: what is drawn, and what blocks walking. */
export function waterPieces(water: readonly Box[], roads: readonly Box[]): Box[] {
  const pieces: Box[] = [];
  for (const body of water) {
    let parts: Box[] = [{ x: body.x, z: body.z, halfWidth: body.halfWidth, halfDepth: body.halfDepth }];
    for (const road of roads) {
      const across = crossing(body, road);
      if (!across) continue;
      parts = parts.flatMap((part) => cut(part, road, across));
    }
    pieces.push(...parts);
  }
  return pieces;
}

/** Where the roads run over the water: each bridge deck's box (road and water overlapping). */
export function bridges(water: readonly Box[], roads: readonly Box[]): Box[] {
  const decks: Box[] = [];
  for (const body of water) {
    for (const road of roads) {
      if (!crossing(body, road)) continue;
      const left = Math.max(body.x - body.halfWidth, road.x - road.halfWidth);
      const right = Math.min(body.x + body.halfWidth, road.x + road.halfWidth);
      const top = Math.max(body.z - body.halfDepth, road.z - road.halfDepth);
      const bottom = Math.min(body.z + body.halfDepth, road.z + road.halfDepth);
      decks.push({ x: (left + right) / 2, z: (top + bottom) / 2, halfWidth: (right - left) / 2, halfDepth: (bottom - top) / 2 });
    }
  }
  return decks;
}

/** The part of `part` outside the road, split along the axis the road does not cover. */
function cut(part: Box, road: Box, across: "x" | "z"): Box[] {
  // A road running along x cuts the water's z extent, and the other way round.
  const alongZ = across === "x";
  const centre = alongZ ? part.z : part.x;
  const half = alongZ ? part.halfDepth : part.halfWidth;
  const roadCentre = alongZ ? road.z : road.x;
  const roadHalf = alongZ ? road.halfDepth : road.halfWidth;
  return outside(centre - half, centre + half, roadCentre - roadHalf, roadCentre + roadHalf).map(([from, to]) =>
    alongZ
      ? { x: part.x, halfWidth: part.halfWidth, z: (from + to) / 2, halfDepth: (to - from) / 2 }
      : { z: part.z, halfDepth: part.halfDepth, x: (from + to) / 2, halfWidth: (to - from) / 2 },
  );
}

/** The parts of [low, high] outside [gapLow, gapHigh], dropping slivers. */
function outside(low: number, high: number, gapLow: number, gapHigh: number): [number, number][] {
  if (gapHigh <= low || gapLow >= high) return [[low, high]];
  const runs: [number, number][] = [
    [low, Math.min(high, gapLow)],
    [Math.max(low, gapHigh), high],
  ];
  return runs.filter(([from, to]) => to - from > SLIVER);
}
