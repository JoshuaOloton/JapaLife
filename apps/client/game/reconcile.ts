import { type Bounds, type Box, type Point, distanceBetween, moveWithCollisions } from "@japalife/shared";

/**
 * Reconciliation: the client predicts its own walking (so a key press moves the
 * player instantly), but the server's position is the truth. Each frame the
 * predicted position is nudged toward the server's.
 *
 * While walking, the prediction is legitimately AHEAD of the server by the
 * network delay, so it is only corrected once it runs further ahead than
 * `MOVING_TOLERANCE` (a leash). When standing still both should agree, so the
 * player glides onto the server's spot. A big disagreement (a teleport, a long
 * stall) snaps straight there.
 */

/** About 0.6 s of walking: covers a slow mobile connection without pulling back. */
export const MOVING_TOLERANCE = 2.5;
/** Further apart than this and blending would look like sliding, so jump. */
export const SNAP_DISTANCE = 6;
/** How quickly the remaining error is closed, per second (exponential smoothing). */
const CORRECTION_RATE = 6;

export interface ReconcileInput {
  predicted: Point;
  server: Point;
  moving: boolean;
  deltaSeconds: number;
  boxes: readonly Box[];
  bounds: Bounds;
}

export function reconcile({ predicted, server, moving, deltaSeconds, boxes, bounds }: ReconcileInput): Point {
  const error = distanceBetween(predicted, server);
  if (error === 0) return predicted;
  if (error > SNAP_DISTANCE) return { x: server.x, z: server.z };

  // While walking, aim for the edge of the leash rather than the server itself.
  const allowed = moving ? MOVING_TOLERANCE : 0;
  if (error <= allowed) return predicted;
  const excess = (error - allowed) / error;
  const fraction = 1 - Math.exp(-CORRECTION_RATE * deltaSeconds);
  const delta = {
    x: (server.x - predicted.x) * excess * fraction,
    z: (server.z - predicted.z) * excess * fraction,
  };
  // The correction also respects walls, so it can never pull the player into a building corner.
  return moveWithCollisions(predicted, delta, boxes, bounds);
}
