import {
  type Box,
  type DistrictHeader,
  MAP_BUILDING_STRIDE,
  type Point,
  type Route,
  routeBetween,
  waterPieces,
} from "@japalife/shared";

/** A waypoint counts as reached this close, metres; the last one ends the walk. */
const WAYPOINT_REACH = 1.2;
const ARRIVE_REACH = 1;
/**
 * Getting less than this much closer to the next waypoint over `STUCK_SECONDS`
 * means something is in the way (pushing into a wall slides you along it, so
 * "not moving" would miss it).
 */
const STUCK_METRES = 0.4;
const STUCK_SECONDS = 1.5;

/**
 * A route from where the player stands to a spot they picked on the map. The
 * last leg (from the road to the spot) is kept only if no building stands in
 * its way; otherwise the route ends at the roadside, since nobody can walk
 * through a wall. The outlines come from the district header, so far-off
 * buildings count too.
 */
export function planRoute(
  header: Pick<DistrictHeader, "roads" | "mapBuildings" | "water">,
  from: Point,
  to: Point,
): Route | undefined {
  const route = routeBetween(header.roads, from, to);
  if (!route || route.points.length < 2) return route;
  const roadside = route.points.at(-2) as Point;
  const water = waterPieces(header.water, header.roads);
  if (!crossesBuilding(header.mapBuildings, roadside, to) && !water.some((piece) => crosses(piece, roadside, to))) return route;
  return { points: route.points.slice(0, -1), length: route.length - Math.hypot(to.x - roadside.x, to.z - roadside.z) };
}

/** Each building outline in the header's flat list (`MAP_BUILDING_STRIDE` numbers each, starting x, z, halfWidth, halfDepth). */
function* outlinesOf(outlines: readonly number[]): Generator<Box> {
  for (let index = 0; index + MAP_BUILDING_STRIDE - 1 < outlines.length; index += MAP_BUILDING_STRIDE) {
    const [x, z, halfWidth, halfDepth] = outlines.slice(index, index + 4) as [number, number, number, number];
    yield { x, z, halfWidth, halfDepth };
  }
}

/** Whether a point falls inside any building outline. */
export function insideBuilding(outlines: readonly number[], point: Point): boolean {
  for (const { x, z, halfWidth, halfDepth } of outlinesOf(outlines)) {
    if (Math.abs(point.x - x) <= halfWidth && Math.abs(point.z - z) <= halfDepth) return true;
  }
  return false;
}

/** Whether the straight line from `a` to `b` passes through any building outline. */
export function crossesBuilding(outlines: readonly number[], a: Point, b: Point): boolean {
  for (const outline of outlinesOf(outlines)) if (crosses(outline, a, b)) return true;
  return false;
}

/** Whether the straight line from `a` to `b` passes through the box (the slab method). */
function crosses({ x, z, halfWidth, halfDepth }: Box, a: Point, b: Point): boolean {
  let enter = 0;
  let leave = 1;
  for (const [start, step, low, high] of [
    [a.x, b.x - a.x, x - halfWidth, x + halfWidth],
    [a.z, b.z - a.z, z - halfDepth, z + halfDepth],
  ] as const) {
    if (Math.abs(step) < 1e-9) {
      if (start < low || start > high) return false;
      continue;
    }
    const t1 = (low - start) / step;
    const t2 = (high - start) / step;
    enter = Math.max(enter, Math.min(t1, t2));
    leave = Math.min(leave, Math.max(t1, t2));
  }
  return enter <= leave;
}

export type RouteEnd = "arrived" | "stuck" | "cancelled";

/**
 * Steers the player along a route ("walk there"): each frame, the direction
 * to the next waypoint, as if the joystick were pushed that way. The server
 * still moves the player and stops them at walls, as for any walking.
 */
export class RouteFollower {
  private next = 1;
  /** At the last progress check: which waypoint, and how far from it. */
  private check: { waypoint: number; distance: number; at: number } | null = null;

  constructor(readonly points: readonly Point[]) {}

  /** A full-speed direction, or how the walk ended. `now` in ms. */
  steer(position: Point, now: number): Point | RouteEnd {
    let target = this.points[this.next];
    while (target && this.next < this.points.length - 1 && Math.hypot(target.x - position.x, target.z - position.z) < WAYPOINT_REACH) {
      this.next++;
      target = this.points[this.next];
    }
    if (!target) return "arrived";
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (this.next === this.points.length - 1 && distance < ARRIVE_REACH) return "arrived";

    // Stuck behind something: hand the walk back to the player.
    if (!this.check || this.check.waypoint !== this.next || now - this.check.at >= STUCK_SECONDS * 1000) {
      if (this.check && this.check.waypoint === this.next && this.check.distance - distance < STUCK_METRES) return "stuck";
      this.check = { waypoint: this.next, distance, at: now };
    }
    return { x: dx / distance, z: dz / distance };
  }
}
