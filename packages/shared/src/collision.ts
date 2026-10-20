import { PLAYER_RADIUS } from "./constants";
import { type DistrictLayout, NPC_HALF_SIZE, propBlockSize, turnHalfSize } from "./content";

/**
 * Walking and collision, written once and run by BOTH the server (the authority)
 * and the client (to predict its own movement, so walking feels instant). Because
 * it is the same code with the same buildings, the two agree and the player is
 * not snapped back by the server.
 *
 * The player is treated as a point and every building is grown by the player's
 * radius ("Minkowski sum"), which gives exact, cheap circle-versus-box collision
 * with no corner special cases. Movement is done in tiny sub-steps, one axis at
 * a time, so a fast player cannot jump through a thin wall and walking into a
 * wall slides along it instead of sticking.
 */

export interface Point {
  x: number;
  z: number;
}

/** An axis-aligned rectangle on the ground, centred on (x, z). Buildings are Boxes. */
export interface Box {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
}

/** The walkable area: a rectangle centred on the origin. */
export interface Bounds {
  halfWidth: number;
  halfDepth: number;
}

/**
 * Everything in a district that stops the player: buildings, the blocking part
 * of each prop (turned with it), and each standing NPC. The server, the
 * client's prediction and the content check all call this, never
 * `district.buildings` on its own, so all three agree on every wall.
 */
export function districtObstacles(
  layout: Pick<DistrictLayout, "buildings" | "props" | "npcs" | "propKinds" | "models">,
): Box[] {
  const boxes: Box[] = layout.buildings.map(({ x, z, halfWidth, halfDepth }) => ({ x, z, halfWidth, halfDepth }));
  for (const prop of layout.props) {
    const kind = layout.propKinds[prop.kind];
    const size = kind ? propBlockSize(kind, layout.models) : undefined;
    if (size) boxes.push({ x: prop.x, z: prop.z, ...turnHalfSize(size, prop.rotation) });
  }
  for (const npc of layout.npcs) {
    boxes.push({ x: npc.x, z: npc.z, halfWidth: NPC_HALF_SIZE, halfDepth: NPC_HALF_SIZE });
  }
  return boxes;
}

/** Longest single sub-step, as a fraction of the player's radius. Small enough to stop flush against a wall. */
const STEP_FRACTION_OF_RADIUS = 0.25;

/** True if a player standing at `point` would overlap any of the boxes. */
export function isBlocked(point: Point, boxes: readonly Box[], radius = PLAYER_RADIUS): boolean {
  for (const box of boxes) {
    if (
      Math.abs(point.x - box.x) < box.halfWidth + radius &&
      Math.abs(point.z - box.z) < box.halfDepth + radius
    ) {
      return true;
    }
  }
  return false;
}

/** Keeps the player's centre far enough inside the walkable area that their body stays inside. */
function clampToBounds(point: Point, bounds: Bounds, radius: number): Point {
  const maxX = Math.max(0, bounds.halfWidth - radius);
  const maxZ = Math.max(0, bounds.halfDepth - radius);
  return {
    x: Math.min(maxX, Math.max(-maxX, point.x)),
    z: Math.min(maxZ, Math.max(-maxZ, point.z)),
  };
}

/** Moves from `from` by `delta`, stopping at buildings and the district edge. */
export function moveWithCollisions(
  from: Point,
  delta: Point,
  boxes: readonly Box[],
  bounds: Bounds,
  radius = PLAYER_RADIUS,
): Point {
  const distance = Math.hypot(delta.x, delta.z);
  if (distance === 0) return from;

  const steps = Math.ceil(distance / (radius * STEP_FRACTION_OF_RADIUS));
  const stepX = delta.x / steps;
  const stepZ = delta.z / steps;

  let current = from;
  for (let i = 0; i < steps; i++) {
    // One axis at a time: if x is blocked we can still slide along z, and the reverse.
    const tryX = clampToBounds({ x: current.x + stepX, z: current.z }, bounds, radius);
    if (!isBlocked(tryX, boxes, radius)) current = tryX;
    const tryZ = clampToBounds({ x: current.x, z: current.z + stepZ }, bounds, radius);
    if (!isBlocked(tryZ, boxes, radius)) current = tryZ;
  }
  return current;
}

/** Distance between two points on the ground. */
export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * For each target, can a player walk from `start` to within `reach` of it?
 * Used when loading content, so a building can never wall off a location.
 * Flood-fills a grid of walkable cells (cells are `cellSize` apart).
 */
export function reachableTargets(
  start: Point,
  targets: readonly Point[],
  reach: number,
  boxes: readonly Box[],
  bounds: Bounds,
  radius = PLAYER_RADIUS,
  cellSize = 0.5,
): boolean[] {
  const maxX = Math.max(0, bounds.halfWidth - radius);
  const maxZ = Math.max(0, bounds.halfDepth - radius);
  const columns = Math.floor((2 * maxX) / cellSize) + 1;
  const rows = Math.floor((2 * maxZ) / cellSize) + 1;
  const centre = (column: number, row: number): Point => ({
    x: -maxX + column * cellSize,
    z: -maxZ + row * cellSize,
  });

  const toCell = (point: Point): [number, number] => [
    Math.min(columns - 1, Math.max(0, Math.round((point.x + maxX) / cellSize))),
    Math.min(rows - 1, Math.max(0, Math.round((point.z + maxZ) / cellSize))),
  ];

  const seen = new Uint8Array(columns * rows);
  const [startColumn, startRow] = toCell(start);
  const queue: number[] = [startRow * columns + startColumn];
  seen[queue[0] as number] = 1;
  const walkable: Point[] = [];

  for (let head = 0; head < queue.length; head++) {
    const index = queue[head] as number;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const here = centre(column, row);
    walkable.push(here);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = column + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
      const next = nr * columns + nc;
      if (seen[next] || isBlocked(centre(nc, nr), boxes, radius)) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }

  return targets.map((target) => walkable.some((cell) => distanceBetween(cell, target) <= reach));
}
