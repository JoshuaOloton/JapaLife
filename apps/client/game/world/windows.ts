import type { Building } from "@japalife/shared";

/**
 * Windows on the plain buildings, and which of them are lit. At night most
 * windows glow. When NEPA takes light, the street goes dark except for the few
 * buildings running a generator, which is the most Lagos thing on screen.
 *
 * Which windows and buildings are lit is a fixed hash of their ids, so the same
 * windows stay lit from frame to frame and from visit to visit.
 */

export const WINDOW_WIDTH = 1;
export const WINDOW_HEIGHT = 1.2;
const FLOOR_HEIGHT = 3;
const FIRST_SILL = 1.1;
const COLUMN_SPACING = 2.6;
/** Plain wall left at each corner. */
const CORNER_MARGIN = 1;
/** Windows sit just off the wall so they never flicker into it. */
const WALL_GAP = 0.03;

/** Share of windows lit on an ordinary night. */
const NIGHT_LIT_SHARE = 0.65;
/** Share of buildings with a generator running during a power cut, and how many of their windows it lights. */
const GENERATOR_SHARE = 0.35;
const GENERATOR_LIT_SHARE = 0.5;

export interface WindowSpot {
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical axis, so the window faces out of its wall. */
  rotationY: number;
  /** Stable 0-1 number for this window, for deciding whether it is lit. */
  hash: number;
  /** Stable 0-1 number for its building (a generator or not). */
  buildingHash: number;
}

export type StreetPower = "day" | "night" | "blackout";

/**
 * Windows on the walls the camera can see. The camera always looks north, so
 * north-facing walls are never on screen and get none.
 */
export function windowsOf(building: Building): WindowSpot[] {
  const spots: WindowSpot[] = [];
  const floors = Math.max(1, Math.floor((building.height - FIRST_SILL) / FLOOR_HEIGHT));
  const buildingHash = hash01(building.id);
  const walls = [
    // South wall (faces the camera), east wall, west wall.
    { length: building.halfWidth * 2, place: (u: number) => ({ x: building.x + u, z: building.z + building.halfDepth + WALL_GAP }), rotationY: 0 },
    { length: building.halfDepth * 2, place: (u: number) => ({ x: building.x + building.halfWidth + WALL_GAP, z: building.z - u }), rotationY: Math.PI / 2 },
    { length: building.halfDepth * 2, place: (u: number) => ({ x: building.x - building.halfWidth - WALL_GAP, z: building.z + u }), rotationY: -Math.PI / 2 },
  ];

  walls.forEach((wall, wallIndex) => {
    const usable = wall.length - CORNER_MARGIN * 2;
    if (usable < WINDOW_WIDTH) return;
    const columns = Math.max(1, Math.floor(usable / COLUMN_SPACING));
    const spacing = usable / columns;
    for (let floor = 0; floor < floors; floor++) {
      const y = FIRST_SILL + floor * FLOOR_HEIGHT + WINDOW_HEIGHT / 2;
      if (y + WINDOW_HEIGHT / 2 > building.height - 0.3) break;
      for (let column = 0; column < columns; column++) {
        const u = -usable / 2 + spacing * (column + 0.5);
        const { x, z } = wall.place(u);
        spots.push({ x, y, z, rotationY: wall.rotationY, hash: hash01(`${building.id}:${wallIndex}:${floor}:${column}`), buildingHash });
      }
    }
  });
  return spots;
}

export function isWindowLit(spot: Pick<WindowSpot, "hash" | "buildingHash">, power: StreetPower): boolean {
  if (power === "day") return false;
  if (power === "night") return spot.hash < NIGHT_LIT_SHARE;
  return spot.buildingHash < GENERATOR_SHARE && spot.hash < GENERATOR_LIT_SHARE;
}

/** What the street's lights are doing now. A power cut only shows at night (by day nobody needs a light). */
export function streetPower(isNight: boolean, blackoutEndsAt: string | null, now: number): StreetPower {
  if (!isNight) return "day";
  return blackoutEndsAt !== null && Date.parse(blackoutEndsAt) > now ? "blackout" : "night";
}

/**
 * Whether a model building's windows glow. A model's glass glows as a whole,
 * so it follows the building-level rule: every building on an ordinary night,
 * only the ones "on generator" in a power cut (the same buildings that would
 * be if they were plain boxes).
 */
export function modelWindowsLit(buildingId: string, power: StreetPower): boolean {
  if (power === "day") return false;
  if (power === "night") return true;
  return hash01(buildingId) < GENERATOR_SHARE;
}

/** FNV-1a, folded to [0, 1). Plenty for picking which windows glow. */
function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x1_0000_0000;
}
