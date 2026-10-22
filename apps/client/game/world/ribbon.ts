import type { Point } from "@japalife/shared";

/** Just above the roads and their potholes, so it never flickers into them. */
const HEIGHT = 0.13;
const HALF_WIDTH = 0.3;

/** A flat strip along a route, one quad per leg, facing up: one draw call. */
export function ribbonGeometry(points: readonly Point[]): { positions: Float32Array; indices: Uint32Array } {
  const legs = Math.max(0, points.length - 1);
  const positions = new Float32Array(legs * 4 * 3);
  const indices = new Uint32Array(legs * 6);
  for (let leg = 0; leg < legs; leg++) {
    const a = points[leg] as Point;
    const b = points[leg + 1] as Point;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    // Sideways, a half width to each side of the leg.
    const sx = (-(b.z - a.z) / length) * HALF_WIDTH;
    const sz = ((b.x - a.x) / length) * HALF_WIDTH;
    positions.set([a.x - sx, HEIGHT, a.z - sz, a.x + sx, HEIGHT, a.z + sz, b.x + sx, HEIGHT, b.z + sz, b.x - sx, HEIGHT, b.z - sz], leg * 12);
    const first = leg * 4;
    // The side always turns the same way from the leg, so this winding faces up whichever way it runs.
    indices.set([first, first + 1, first + 2, first, first + 2, first + 3], leg * 6);
  }
  return { positions, indices };
}
