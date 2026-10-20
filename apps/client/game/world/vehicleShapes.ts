import type { BuiltVehicle, VehicleKind } from "@japalife/shared";

/**
 * Keke and okada, built from coloured boxes at the size their kind declares,
 * facing +z. All of them are drawn by one moving instanced box mesh, so every
 * keke and okada on the street together costs a single draw call. Our own
 * Blender models replace them in 11f.
 */

export type BuiltVehicleLook = Extract<VehicleKind["look"], { built: BuiltVehicle }>;

/** A box in the vehicle's own frame (facing +z), centred on (dx, dz), standing at height `y`. */
export interface VehiclePart {
  dx: number;
  dz: number;
  halfWidth: number;
  halfDepth: number;
  height: number;
  y: number;
  colour: string;
}

const DARK = "#1d1d1d";
const TYRE = "#222222";
const GLASS = "#2a3440";
const SKIN = "#6b4a36";
const SHIRT = "#2f6db5";
const TROUSERS = "#2b2f36";
const REFLECTIVE_VEST = "#d8e33a";
const KEKE_STRIPE = "#2e7d4f";

/** The boxes of one built vehicle, scaled to its kind's declared size. */
export function builtVehicleParts(look: BuiltVehicleLook): VehiclePart[] {
  const colour = look.colour ?? (look.built === "keke" ? "#f2c200" : "#8a1f1f");
  const parts = look.built === "keke" ? kekeParts(colour) : okadaParts(colour);
  // The parts are laid out at a reference size; stretch them to the kind's size.
  const reference = REFERENCE[look.built];
  const sx = look.halfWidth / reference.halfWidth;
  const sz = look.halfLength / reference.halfLength;
  const sy = look.height / reference.height;
  return parts.map((part) => ({
    dx: part.dx * sx,
    dz: part.dz * sz,
    halfWidth: part.halfWidth * sx,
    halfDepth: part.halfDepth * sz,
    height: part.height * sy,
    y: part.y * sy,
    colour: part.colour,
  }));
}

const REFERENCE: Record<BuiltVehicle, { halfLength: number; halfWidth: number; height: number }> = {
  keke: { halfLength: 1.35, halfWidth: 0.65, height: 1.75 },
  okada: { halfLength: 0.95, halfWidth: 0.35, height: 1.6 },
};

/** A keke napep: yellow body with a green stripe, black canopy on four posts, one front wheel, two at the back, a driver. */
function kekeParts(body: string): VehiclePart[] {
  const post = (dx: number, dz: number): VehiclePart => ({ dx, dz, halfWidth: 0.03, halfDepth: 0.03, height: 1.0, y: 0.67, colour: DARK });
  return [
    { dx: 0, dz: 0, halfWidth: 0.6, halfDepth: 1.25, height: 0.18, y: 0.25, colour: body },
    { dx: 0, dz: -0.35, halfWidth: 0.62, halfDepth: 0.75, height: 0.7, y: 0.43, colour: body },
    { dx: 0, dz: -0.35, halfWidth: 0.625, halfDepth: 0.76, height: 0.08, y: 0.8, colour: KEKE_STRIPE },
    { dx: 0, dz: 0.95, halfWidth: 0.35, halfDepth: 0.3, height: 0.6, y: 0.35, colour: body },
    { dx: 0, dz: 0.75, halfWidth: 0.5, halfDepth: 0.03, height: 0.55, y: 1.0, colour: GLASS },
    { dx: 0, dz: -0.1, halfWidth: 0.65, halfDepth: 1.15, height: 0.08, y: 1.67, colour: DARK },
    post(0.58, 0.7),
    post(-0.58, 0.7),
    post(0.58, -1.0),
    post(-0.58, -1.0),
    { dx: 0, dz: 1.1, halfWidth: 0.08, halfDepth: 0.22, height: 0.44, y: 0, colour: TYRE },
    { dx: 0.5, dz: -0.75, halfWidth: 0.08, halfDepth: 0.22, height: 0.44, y: 0, colour: TYRE },
    { dx: -0.5, dz: -0.75, halfWidth: 0.08, halfDepth: 0.22, height: 0.44, y: 0, colour: TYRE },
    // The driver, sitting up front.
    { dx: 0, dz: 0.45, halfWidth: 0.2, halfDepth: 0.15, height: 0.5, y: 0.75, colour: SHIRT },
    { dx: 0, dz: 0.45, halfWidth: 0.11, halfDepth: 0.11, height: 0.22, y: 1.27, colour: SKIN },
  ];
}

/** An okada: a small motorbike and its rider in a reflective vest, as boxes. */
function okadaParts(frame: string): VehiclePart[] {
  const pair = (dx: number, part: Omit<VehiclePart, "dx">): VehiclePart[] => [
    { ...part, dx },
    { ...part, dx: -dx },
  ];
  return [
    { dx: 0, dz: 0.68, halfWidth: 0.06, halfDepth: 0.27, height: 0.54, y: 0, colour: TYRE },
    { dx: 0, dz: -0.68, halfWidth: 0.06, halfDepth: 0.27, height: 0.54, y: 0, colour: TYRE },
    { dx: 0, dz: 0, halfWidth: 0.1, halfDepth: 0.5, height: 0.22, y: 0.42, colour: frame },
    { dx: 0, dz: 0.2, halfWidth: 0.14, halfDepth: 0.2, height: 0.15, y: 0.6, colour: frame },
    { dx: 0, dz: -0.25, halfWidth: 0.14, halfDepth: 0.35, height: 0.1, y: 0.62, colour: DARK },
    { dx: 0, dz: 0.62, halfWidth: 0.04, halfDepth: 0.04, height: 0.5, y: 0.45, colour: DARK },
    { dx: 0, dz: 0.55, halfWidth: 0.32, halfDepth: 0.04, height: 0.05, y: 0.95, colour: DARK },
    // The rider: legs astride, vest, head and helmet.
    { dx: 0, dz: -0.2, halfWidth: 0.17, halfDepth: 0.15, height: 0.2, y: 0.7, colour: TROUSERS },
    ...pair(0.12, { dz: 0.05, halfWidth: 0.06, halfDepth: 0.2, height: 0.08, y: 0.72, colour: TROUSERS }),
    ...pair(0.14, { dz: 0.25, halfWidth: 0.05, halfDepth: 0.05, height: 0.4, y: 0.32, colour: TROUSERS }),
    { dx: 0, dz: -0.12, halfWidth: 0.19, halfDepth: 0.13, height: 0.5, y: 0.9, colour: REFLECTIVE_VEST },
    ...pair(0.2, { dz: 0.2, halfWidth: 0.05, halfDepth: 0.2, height: 0.07, y: 1.1, colour: SHIRT }),
    { dx: 0, dz: -0.08, halfWidth: 0.11, halfDepth: 0.11, height: 0.22, y: 1.36, colour: SKIN },
    { dx: 0, dz: -0.08, halfWidth: 0.12, halfDepth: 0.12, height: 0.08, y: 1.52, colour: DARK },
  ];
}
