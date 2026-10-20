import type { Slab } from "./world/Boxes";

/**
 * The wardrobe screen's set: a Lagos bedroom built from coloured boxes around
 * your character, who stands at the origin facing the camera (+z). Nothing is
 * downloaded, and every box goes into one draw call. On the back wall: an open
 * wardrobe with clothes on a rail, a louvre ("naco") window with burglar bars
 * and curtains, a standing mirror. A bed along the right wall, a side table
 * with a radio and a calendar on the left, a rug underfoot and a ceiling fan
 * (its blades are `FAN_BLADES`, spun by the component). The room is closed on
 * every side, so only the room is ever in view. Pure, so it is unit-tested.
 */

export const ROOM_HALF_WIDTH = 4;
export const ROOM_HEIGHT = 3.3;
/** The back wall's inner face, behind the character. */
export const ROOM_BACK = -2.4;
const WALL = 0.1;

const WALL_PAINT = "#a9cfd8";
const TILE_GROUT = "#a8946f";
const TILE_SIZE = 0.6;
/** Raised just enough above the floor not to flicker into it at a distance. */
const GROUT_HEIGHT = 0.006;
const SKIRTING = "#7a5235";
const CEILING = "#f4efe4";
const FLOOR_TILES = "#c9b48f";
const WOOD = "#6b4226";
const WOOD_LIGHT = "#7d4e2d";
const WOOD_INSIDE = "#3b2416";
const FRAME_WHITE = "#e9e9e4";
const LOUVRE_GLASS = "#9fc3cf";
const BURGLAR_BARS = "#3a3a3a";
const CURTAIN = "#b5382c";
const MIRROR_GLASS = "#c9dde3";
const RAIL = "#c0c0c0";
const RUG = ["#8c2f39", "#d9a441", "#8c2f39"];
const CLOTHES = ["#c8553d", "#2f6db5", "#f2b134", "#2f7a55", "#ecebe6", "#6b3b8a", "#1f3a8a", "#e2541b"];

/** The fan's height and blade colour; the blades turn around the y axis through the origin. */
export const FAN_HEIGHT = 2.86;
export const FAN_BLADES: readonly Slab[] = [
  { x: 0, z: 0, halfWidth: 0.72, halfDepth: 0.07, height: 0.015, y: FAN_HEIGHT, colour: "#e8e4da" },
  { x: 0, z: 0, halfWidth: 0.07, halfDepth: 0.72, height: 0.015, y: FAN_HEIGHT, colour: "#e8e4da" },
];

/** The room's boxes, with its front wall at `frontZ` (just behind the camera). */
export function dressingRoomSlabs(frontZ: number): Slab[] {
  const depth = frontZ - ROOM_BACK;
  const middleZ = (frontZ + ROOM_BACK) / 2;
  const back = ROOM_BACK;
  const slabs: Slab[] = [
    // Shell: floor, ceiling, four walls, skirting boards.
    { x: 0, z: middleZ, halfWidth: ROOM_HALF_WIDTH, halfDepth: depth / 2, height: 0.1, y: -0.1, colour: FLOOR_TILES },
    { x: 0, z: middleZ, halfWidth: ROOM_HALF_WIDTH, halfDepth: depth / 2, height: 0.1, y: ROOM_HEIGHT, colour: CEILING },
    { x: 0, z: back - WALL / 2, halfWidth: ROOM_HALF_WIDTH + WALL, halfDepth: WALL / 2, height: ROOM_HEIGHT, colour: WALL_PAINT },
    { x: 0, z: frontZ + WALL / 2, halfWidth: ROOM_HALF_WIDTH + WALL, halfDepth: WALL / 2, height: ROOM_HEIGHT, colour: WALL_PAINT },
    { x: -ROOM_HALF_WIDTH - WALL / 2, z: middleZ, halfWidth: WALL / 2, halfDepth: depth / 2, height: ROOM_HEIGHT, colour: WALL_PAINT },
    { x: ROOM_HALF_WIDTH + WALL / 2, z: middleZ, halfWidth: WALL / 2, halfDepth: depth / 2, height: ROOM_HEIGHT, colour: WALL_PAINT },
    { x: 0, z: back + 0.02, halfWidth: ROOM_HALF_WIDTH, halfDepth: 0.02, height: 0.12, colour: SKIRTING },
    { x: -ROOM_HALF_WIDTH + 0.02, z: middleZ, halfWidth: 0.02, halfDepth: depth / 2, height: 0.12, colour: SKIRTING },
    { x: ROOM_HALF_WIDTH - 0.02, z: middleZ, halfWidth: 0.02, halfDepth: depth / 2, height: 0.12, colour: SKIRTING },

    // The fan's rod and hub (the blades turn separately).
    { x: 0, z: 0, halfWidth: 0.02, halfDepth: 0.02, height: ROOM_HEIGHT - FAN_HEIGHT, y: FAN_HEIGHT, colour: FRAME_WHITE },
    { x: 0, z: 0, halfWidth: 0.1, halfDepth: 0.1, height: 0.1, y: FAN_HEIGHT - 0.04, colour: FRAME_WHITE },

    ...tileLines(frontZ),
    ...rug(),
    ...wardrobe(-2.5, back),
    ...louvreWindow(0, back),
    ...mirror(2.5, back),
    ...bed(back),
    ...sideTable(),
  ];
  return slabs;
}

/** Grout lines between the floor tiles, so the floor reads as tiled. */
function tileLines(frontZ: number): Slab[] {
  const depth = frontZ - ROOM_BACK;
  const lines: Slab[] = [];
  for (let x = -ROOM_HALF_WIDTH + TILE_SIZE; x < ROOM_HALF_WIDTH; x += TILE_SIZE) {
    lines.push({ x, z: (frontZ + ROOM_BACK) / 2, halfWidth: 0.008, halfDepth: depth / 2, height: GROUT_HEIGHT, colour: TILE_GROUT });
  }
  for (let z = ROOM_BACK + TILE_SIZE; z < frontZ; z += TILE_SIZE) {
    lines.push({ x: 0, z, halfWidth: ROOM_HALF_WIDTH, halfDepth: 0.008, height: GROUT_HEIGHT, colour: TILE_GROUT });
  }
  return lines;
}

function rug(): Slab[] {
  return RUG.map((colour, ring) => ({
    x: 0,
    z: 0.2,
    halfWidth: 1.3 - ring * 0.2,
    halfDepth: 0.95 - ring * 0.2,
    height: 0.012 + ring * 0.004,
    colour,
  }));
}

/** An open wardrobe: a cabinet with its doors swung out, shirts on a rail and folded clothes on a shelf. */
function wardrobe(x: number, back: number): Slab[] {
  const halfWidth = 0.75;
  const halfDepth = 0.3;
  const z = back + halfDepth;
  const front = back + halfDepth * 2;
  const slabs: Slab[] = [
    { x, z: back + 0.02, halfWidth, halfDepth: 0.02, height: 2.2, colour: WOOD_INSIDE },
    { x: x - halfWidth + 0.025, z, halfWidth: 0.025, halfDepth, height: 2.2, colour: WOOD },
    { x: x + halfWidth - 0.025, z, halfWidth: 0.025, halfDepth, height: 2.2, colour: WOOD },
    { x, z, halfWidth, halfDepth, height: 0.08, y: 2.14, colour: WOOD },
    { x, z, halfWidth, halfDepth, height: 0.12, colour: WOOD },
    { x, z, halfWidth: halfWidth - 0.05, halfDepth, height: 0.03, y: 0.5, colour: WOOD },
    // Doors swung open, square to the wall.
    { x: x - halfWidth - 0.02, z: front + 0.36, halfWidth: 0.02, halfDepth: 0.36, height: 2.05, y: 0.08, colour: WOOD_LIGHT },
    { x: x + halfWidth + 0.02, z: front + 0.36, halfWidth: 0.02, halfDepth: 0.36, height: 2.05, y: 0.08, colour: WOOD_LIGHT },
    { x, z, halfWidth: halfWidth - 0.05, halfDepth: 0.012, height: 0.025, y: 1.92, colour: RAIL },
  ];
  CLOTHES.forEach((colour, index) => {
    slabs.push({ x: x - 0.6 + index * 0.17, z, halfWidth: 0.065, halfDepth: 0.2, height: 0.85, y: 1.05, colour });
  });
  // Folded clothes in piles on the shelf.
  for (let pile = 0; pile < 3; pile++) {
    for (let layer = 0; layer < 3; layer++) {
      const colour = CLOTHES[(pile * 3 + layer + 2) % CLOTHES.length] ?? WOOD;
      slabs.push({ x: x - 0.42 + pile * 0.42, z, halfWidth: 0.17, halfDepth: 0.18, height: 0.07, y: 0.53 + layer * 0.07, colour });
    }
  }
  return slabs;
}

/** A louvre window high on the wall, with burglar bars and curtains drawn back. */
function louvreWindow(x: number, back: number): Slab[] {
  const bottom = 1.95;
  const height = 0.95;
  const halfWidth = 0.6;
  const slabs: Slab[] = [{ x, z: back + 0.02, halfWidth: halfWidth + 0.06, halfDepth: 0.02, height: height + 0.12, y: bottom - 0.06, colour: FRAME_WHITE }];
  for (let blade = 0; blade < 6; blade++) {
    slabs.push({ x, z: back + 0.05, halfWidth, halfDepth: 0.012, height: 0.12, y: bottom + 0.04 + blade * 0.15, colour: LOUVRE_GLASS });
  }
  for (let bar = 0; bar < 5; bar++) {
    slabs.push({ x: x - halfWidth + 0.1 + bar * 0.25, z: back + 0.08, halfWidth: 0.012, halfDepth: 0.012, height, y: bottom, colour: BURGLAR_BARS });
  }
  for (const side of [-1, 1]) {
    slabs.push({ x: x + side * (halfWidth + 0.2), z: back + 0.1, halfWidth: 0.18, halfDepth: 0.04, height: 1.3, y: bottom - 0.3, colour: CURTAIN });
  }
  slabs.push({ x, z: back + 0.1, halfWidth: halfWidth + 0.45, halfDepth: 0.015, height: 0.03, y: bottom + height + 0.08, colour: BURGLAR_BARS });
  return slabs;
}

/** A standing mirror on two feet. */
function mirror(x: number, back: number): Slab[] {
  const z = back + 0.3;
  return [
    { x, z, halfWidth: 0.4, halfDepth: 0.04, height: 1.75, y: 0.15, colour: WOOD },
    { x, z: z + 0.045, halfWidth: 0.33, halfDepth: 0.01, height: 1.55, y: 0.25, colour: MIRROR_GLASS },
    { x: x - 0.3, z, halfWidth: 0.04, halfDepth: 0.22, height: 0.15, colour: WOOD },
    { x: x + 0.3, z, halfWidth: 0.04, halfDepth: 0.22, height: 0.15, colour: WOOD },
  ];
}

/** A bed with its head against the right wall: frame, mattress, a bright bedspread and a pillow. */
function bed(back: number): Slab[] {
  const x = ROOM_HALF_WIDTH - 1.05;
  const z = back + 3.4;
  return [
    { x, z, halfWidth: 1.05, halfDepth: 0.72, height: 0.32, colour: WOOD },
    { x: ROOM_HALF_WIDTH - 0.04, z, halfWidth: 0.04, halfDepth: 0.72, height: 1.0, colour: WOOD },
    { x: x - 0.02, z, halfWidth: 1.0, halfDepth: 0.68, height: 0.2, y: 0.32, colour: "#efe6d6" },
    { x: x - 0.25, z, halfWidth: 0.8, halfDepth: 0.7, height: 0.05, y: 0.5, colour: "#1f3a8a" },
    { x: x - 0.25, z, halfWidth: 0.8, halfDepth: 0.4, height: 0.052, y: 0.5, colour: "#f2a516" },
    { x: ROOM_HALF_WIDTH - 0.3, z, halfWidth: 0.18, halfDepth: 0.5, height: 0.12, y: 0.52, colour: "#f7f1e3" },
  ];
}

/** A side table on the left with a radio, and a calendar on the wall above. */
function sideTable(): Slab[] {
  const x = -ROOM_HALF_WIDTH + 0.4;
  const z = 1.2;
  return [
    { x, z, halfWidth: 0.35, halfDepth: 0.3, height: 0.05, y: 0.7, colour: WOOD_LIGHT },
    { x, z, halfWidth: 0.3, halfDepth: 0.25, height: 0.7, colour: WOOD },
    { x, z, halfWidth: 0.16, halfDepth: 0.07, height: 0.14, y: 0.75, colour: "#2b2b2b" },
    { x: -ROOM_HALF_WIDTH + 0.01, z, halfWidth: 0.01, halfDepth: 0.24, height: 0.42, y: 1.3, colour: "#f7f5ef" },
    { x: -ROOM_HALF_WIDTH + 0.015, z, halfWidth: 0.01, halfDepth: 0.24, height: 0.1, y: 1.62, colour: "#b5382c" },
  ];
}
