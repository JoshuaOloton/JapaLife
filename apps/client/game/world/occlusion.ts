/**
 * Occlusion fading: the street camera sits high and to the south of the
 * player, so a tall building just south of them stands between the camera and
 * the player and hides them. A building whose box crosses the line from the
 * camera to the player is drawn see-through until it no longer does, the usual
 * fix in top-down games. Pure, so it is unit-tested.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** A building's box: its footprint, from the ground up to its height. */
export interface BuildingBox {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  height: number;
}

/** How a hiding building fades: how far (0-1, the share of pixels dropped), how fast, and how near it must be. */
export interface FadeRule {
  faded: number;
  perSecond: number;
  /** Only buildings this close to the player (on each axis) are tested. */
  range: number;
}

/**
 * Moves each building's fade one frame toward faded (while it hides the
 * player from the camera) or solid. `amounts[i]` belongs to `buildings[i]`.
 * Returns whether any changed. Allocates nothing: it runs every frame.
 */
export function stepFades(
  buildings: readonly BuildingBox[],
  amounts: Float32Array,
  camera: Point3,
  player: Point3,
  seconds: number,
  rule: FadeRule,
): boolean {
  const step = seconds * rule.perSecond;
  let changed = false;
  const count = Math.min(buildings.length, amounts.length);
  for (let index = 0; index < count; index++) {
    const building = buildings[index] as BuildingBox;
    const close = Math.abs(building.x - player.x) < rule.range && Math.abs(building.z - player.z) < rule.range;
    const want = close && blocksView(building, camera, player) ? rule.faded : 0;
    const now = amounts[index] as number;
    if (now === want) continue;
    amounts[index] = want > now ? Math.min(want, now + step) : Math.max(want, now - step);
    changed = true;
  }
  return changed;
}

/** Whether the straight line from `from` to `to` passes through the box (the slab method). */
export function blocksView(box: BuildingBox, from: Point3, to: Point3): boolean {
  let enter = 0;
  let leave = 1;
  const axes: [number, number, number, number][] = [
    [from.x, to.x - from.x, box.x - box.halfWidth, box.x + box.halfWidth],
    [from.y, to.y - from.y, 0, box.height],
    [from.z, to.z - from.z, box.z - box.halfDepth, box.z + box.halfDepth],
  ];
  for (const [start, step, low, high] of axes) {
    if (Math.abs(step) < 1e-9) {
      if (start < low || start > high) return false;
      continue;
    }
    const a = (low - start) / step;
    const b = (high - start) / step;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }
  return true;
}
