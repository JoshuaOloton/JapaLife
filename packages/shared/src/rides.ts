import type { Point } from "./collision";
import type { RideKind, TransportConfig } from "./content";

/**
 * Paid rides (danfo, okada): what one costs and where the rider is at any
 * moment. The server moves the rider by this, from its own clock; the client
 * runs the same code to draw the ride smoothly, so the two agree.
 */

/** What a ride costs: a flat danfo fare, or an okada fare by the band of its length. Whole kobo. */
export function rideFare(kind: RideKind, transport: TransportConfig, metres: number): bigint {
  if (kind === "danfo") return BigInt(transport.danfoFareKobo);
  const band = transport.okadaFares.find((candidate) => metres <= candidate.upToMetres) ?? transport.okadaFares.at(-1);
  return BigInt(band?.fareKobo ?? 0);
}

export function pathLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1] as Point;
    const b = points[index] as Point;
    length += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return length;
}

/** A place on a path and the way it runs there (a turn about y, like the player's: 0 faces +z). */
export interface PathPoint {
  x: number;
  z: number;
  heading: number;
}

/** The point `distance` metres along a path (clamped to its ends). Pass `out` to reuse an object every frame. */
export function pointAlongPath(points: readonly Point[], distance: number, out: PathPoint = { x: 0, z: 0, heading: 0 }): PathPoint {
  let left = Math.max(0, distance);
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1] as Point;
    const b = points[index] as Point;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length === 0) continue;
    if (left <= length || index === points.length - 1) {
      const t = Math.min(1, left / length);
      out.x = a.x + (b.x - a.x) * t;
      out.z = a.z + (b.z - a.z) * t;
      out.heading = Math.atan2(b.x - a.x, b.z - a.z);
      return out;
    }
    left -= length;
  }
  const only = points[0] ?? { x: 0, z: 0 };
  out.x = only.x;
  out.z = only.z;
  out.heading = 0;
  return out;
}

/** How a ride moves: the same numbers on the server (stored) and the client (in the `ride` message). */
export interface RideTiming {
  path: readonly Point[];
  /** Milliseconds since the epoch, on the server's clock. */
  startedAt: number;
  /** A danfo waits at the stop this long before it sets off. */
  boardingSeconds: number;
  /** Metres per second. */
  speed: number;
  /** Where along the path the ride ends: its whole length, or where the task force stopped it. */
  stopsAtMetres: number;
}

/** When a ride with this timing ends, in ms since the epoch. */
export function rideEndsAt(ride: Omit<RideTiming, "path">): number {
  return ride.startedAt + (ride.boardingSeconds + ride.stopsAtMetres / ride.speed) * 1000;
}

/** Where the rider is at `now` (ms since the epoch): waiting at the stop, on the way, or at the end. */
export function ridePose(ride: RideTiming, now: number, out?: PathPoint): PathPoint {
  const travelling = (now - ride.startedAt) / 1000 - ride.boardingSeconds;
  return pointAlongPath(ride.path, Math.min(ride.stopsAtMetres, Math.max(0, travelling * ride.speed)), out);
}
