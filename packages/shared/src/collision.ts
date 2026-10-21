import { PLAYER_RADIUS } from "./constants";
import { type DistrictLayout, NPC_HALF_SIZE, propBlockSize, turnHalfSize } from "./content";
import { SpatialGrid } from "./spatialGrid";

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

/**
 * The obstacles a player walks against, bucketed by position so each check
 * looks only at the boxes nearby. Every collision function takes this, never
 * a plain list, so nothing scans the whole district on every step.
 */
export type Obstacles = SpatialGrid<Box>;

/** Puts boxes (usually `districtObstacles(layout)`) into the grid the collision functions take. */
export function obstacleGrid(boxes: readonly Box[]): Obstacles {
  return new SpatialGrid(boxes);
}

/** Longest single sub-step, as a fraction of the player's radius. Small enough to stop flush against a wall. */
const STEP_FRACTION_OF_RADIUS = 0.25;

/** True if a player standing at `point` would overlap any of the obstacles. */
export function isBlocked(point: Point, obstacles: Obstacles, radius = PLAYER_RADIUS): boolean {
  return obstacles.some(
    point.x,
    point.z,
    radius,
    radius,
    (box) => Math.abs(point.x - box.x) < box.halfWidth + radius && Math.abs(point.z - box.z) < box.halfDepth + radius,
  );
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
  obstacles: Obstacles,
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
    if (!isBlocked(tryX, obstacles, radius)) current = tryX;
    const tryZ = clampToBounds({ x: current.x, z: current.z + stepZ }, bounds, radius);
    if (!isBlocked(tryZ, obstacles, radius)) current = tryZ;
  }
  return current;
}

/** Distance between two points on the ground. */
export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A flood-fill cell not visited yet. */
const UNSEEN = 0;
/** A flood-fill cell the player can stand in and walk to. */
const WALKABLE = 1;
/** A flood-fill cell the player cannot stand in, so it is never tested twice. */
const BLOCKED = 2;

/**
 * For each target, can a player walk from `start` to within `reach` of it?
 * Used when loading content, so a building can never wall off a location.
 * Flood-fills a grid of walkable cells (cells are `cellSize` apart). Runs once
 * at server start over the whole district, so it keeps to typed arrays: at
 * 600 m that is about 1.4 million cells.
 */
export function reachableTargets(
  start: Point,
  targets: readonly Point[],
  reach: number,
  obstacles: Obstacles,
  bounds: Bounds,
  radius = PLAYER_RADIUS,
  cellSize = 0.5,
): boolean[] {
  const maxX = Math.max(0, bounds.halfWidth - radius);
  const maxZ = Math.max(0, bounds.halfDepth - radius);
  const columns = Math.floor((2 * maxX) / cellSize) + 1;
  const rows = Math.floor((2 * maxZ) / cellSize) + 1;
  const toColumn = (x: number): number => Math.min(columns - 1, Math.max(0, Math.round((x + maxX) / cellSize)));
  const toRow = (z: number): number => Math.min(rows - 1, Math.max(0, Math.round((z + maxZ) / cellSize)));

  const state = new Uint8Array(columns * rows);
  const queue = new Int32Array(columns * rows);
  const first = toRow(start.z) * columns + toColumn(start.x);
  queue[0] = first;
  state[first] = WALKABLE;
  let tail = 1;
  const probe = { x: 0, z: 0 }; // reused, so a million-cell fill does not allocate a point per cell

  for (let head = 0; head < tail; head++) {
    const index = queue[head] as number;
    const column = index % columns;
    const row = (index - column) / columns;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = column + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue;
      const next = nr * columns + nc;
      if (state[next] !== UNSEEN) continue;
      probe.x = -maxX + nc * cellSize;
      probe.z = -maxZ + nr * cellSize;
      if (isBlocked(probe, obstacles, radius)) {
        state[next] = BLOCKED;
      } else {
        state[next] = WALKABLE;
        queue[tail++] = next;
      }
    }
  }

  // Look only at the cells within `reach` of each target, not every walkable cell.
  return targets.map((target) => {
    const reachCells = Math.ceil(reach / cellSize);
    const centreColumn = toColumn(target.x);
    const centreRow = toRow(target.z);
    for (let row = Math.max(0, centreRow - reachCells); row <= Math.min(rows - 1, centreRow + reachCells); row++) {
      for (
        let column = Math.max(0, centreColumn - reachCells);
        column <= Math.min(columns - 1, centreColumn + reachCells);
        column++
      ) {
        if (state[row * columns + column] !== WALKABLE) continue;
        const cell = { x: -maxX + column * cellSize, z: -maxZ + row * cellSize };
        if (distanceBetween(cell, target) <= reach) return true;
      }
    }
    return false;
  });
}
