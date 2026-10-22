import { type DistrictHeader, type Point, type Route, routeBetween } from "@japalife/shared";

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
export function planRoute(header: Pick<DistrictHeader, "roads" | "mapBuildings">, from: Point, to: Point): Route | undefined {
  const route = routeBetween(header.roads, from, to);
  if (!route || route.points.length < 2) return route;
  const roadside = route.points.at(-2) as Point;
  if (!crossesBuilding(header.mapBuildings, roadside, to)) return route;
  return { points: route.points.slice(0, -1), length: route.length - Math.hypot(to.x - roadside.x, to.z - roadside.z) };
}

/** Each building outline in the header's flat list (x, z, halfWidth, halfDepth, one after another). */
function* outlinesOf(outlines: readonly number[]): Generator<[number, number, number, number]> {
  for (let index = 0; index + 3 < outlines.length; index += 4) {
    yield outlines.slice(index, index + 4) as [number, number, number, number];
  }
}

/** Whether a point falls inside any building outline. */
export function insideBuilding(outlines: readonly number[], point: Point): boolean {
  for (const [x, z, halfWidth, halfDepth] of outlinesOf(outlines)) {
    if (Math.abs(point.x - x) <= halfWidth && Math.abs(point.z - z) <= halfDepth) return true;
  }
  return false;
}

/** Whether the straight line from `a` to `b` passes through any building outline (the slab method). */
export function crossesBuilding(outlines: readonly number[], a: Point, b: Point): boolean {
  for (const [x, z, halfWidth, halfDepth] of outlinesOf(outlines)) {
    let enter = 0;
    let leave = 1;
    let misses = false;
    for (const [start, step, low, high] of [
      [a.x, b.x - a.x, x - halfWidth, x + halfWidth],
      [a.z, b.z - a.z, z - halfDepth, z + halfDepth],
    ] as const) {
      if (Math.abs(step) < 1e-9) {
        if (start < low || start > high) misses = true;
        continue;
      }
      const t1 = (low - start) / step;
      const t2 = (high - start) / step;
      enter = Math.max(enter, Math.min(t1, t2));
      leave = Math.min(leave, Math.max(t1, t2));
    }
    if (!misses && enter <= leave) return true;
  }
  return false;
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
