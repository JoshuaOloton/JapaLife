import {
  type BuiltPropShape,
  type DistrictLayout,
  type Prop,
  type PropKind,
  type QuarterTurn,
  seededRandom,
} from "@japalife/shared";
import type { Slab } from "./Boxes";

/**
 * Street props built in code: generators, kiosks, container shops, electric
 * poles, palms, billboards, hawker tables, plastic chairs and speed bumps.
 * Each is a handful of coloured boxes at the size its kind declares, drawn by
 * the world's one instanced box mesh, so they cost no download and no extra
 * draw call. Pure functions, so the shapes are tested against their footprints.
 */

type BuiltLook = Extract<PropKind["look"], { built: BuiltPropShape }>;

/** A box in the prop's own frame (before its rotation), centred on (dx, dz). */
interface Part {
  dx: number;
  dz: number;
  halfWidth: number;
  halfDepth: number;
  height: number;
  y?: number;
  colour: string;
}

const DEFAULT_COLOURS: Record<BuiltPropShape, string> = {
  generator: "#c9a227",
  kiosk: "#2f6db5",
  container_shop: "#b5432f",
  electric_pole: "#9c9a94",
  palm: "#7a5a3a",
  billboard: "#3a3a3a",
  hawker_table: "#8a6a46",
  plastic_chair: "#f2f2ee",
  speed_bump: "#e0b42a",
  signboard: "#f4f1e8",
};

const ZINC = "#8d9196";
const DARK = "#1d1d1d";
const PALM_TRUNK_SEGMENTS = 6;
const PALM_TRUNK_SHARE = 0.85;
const PALM_LEAN_PER_SEGMENT = 0.06;
const PALM_FRONDS = 7;
/** Where wires hang from a pole: the insulators near each end of the crossarm. */
const WIRE_ATTACH_SPREAD = 0.8;
const WIRE_ATTACH_BELOW_TOP = 0.36;
/** Pieces per span, and how far a wire sags as a share of the span. */
const WIRE_PIECES = 6;
const WIRE_SAG = 0.03;

/** The built kinds' looks in a layout, by kind id. */
export function builtLook(layout: Pick<DistrictLayout, "propKinds">, prop: Prop): BuiltLook | undefined {
  const look = layout.propKinds[prop.kind]?.look;
  return look && "built" in look ? look : undefined;
}

/** Every box of every built prop in the district, for the world's single `Boxes` call. */
export function propSlabs(layout: Pick<DistrictLayout, "props" | "propKinds">): Slab[] {
  return layout.props.flatMap((prop) => {
    const look = builtLook(layout, prop);
    return look ? builtPropSlabs(prop, look) : [];
  });
}

export function builtPropSlabs(prop: Prop, look: BuiltLook): Slab[] {
  const colour = look.colour ?? DEFAULT_COLOURS[look.built];
  return SHAPES[look.built](look, colour).map((part) => placePart(part, prop));
}

/** Turns a point in a prop's own frame a quarter turn, the way three.js turns an object about y. */
export function turnPoint(dx: number, dz: number, rotation: QuarterTurn): [number, number] {
  switch (rotation) {
    case 90:
      return [dz, -dx];
    case 180:
      return [-dx, -dz];
    case 270:
      return [-dz, dx];
    default:
      return [dx, dz];
  }
}

function placePart(part: Part, prop: Prop): Slab {
  const [dx, dz] = turnPoint(part.dx, part.dz, prop.rotation);
  const turned = prop.rotation === 90 || prop.rotation === 270;
  return {
    x: prop.x + dx,
    z: prop.z + dz,
    halfWidth: turned ? part.halfDepth : part.halfWidth,
    halfDepth: turned ? part.halfWidth : part.halfDepth,
    height: part.height,
    colour: part.colour,
    ...(part.y === undefined ? {} : { y: part.y }),
  };
}

/** A darker (factor < 1) or lighter shade of a hex colour. */
export function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): string =>
    Math.min(255, Math.round(((value >> shift) & 0xff) * factor))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

const SHAPES: Record<BuiltPropShape, (look: BuiltLook, colour: string) => Part[]> = {
  generator: ({ halfWidth: w, halfDepth: d, height: h }, colour) => [
    { dx: 0, dz: 0, halfWidth: w * 0.95, halfDepth: d * 0.9, height: h * 0.78, colour },
    // Fuel tank on top, control panel on the front, exhaust pipe at the side.
    { dx: 0, dz: 0, halfWidth: w * 0.7, halfDepth: d * 0.6, height: h * 0.22, y: h * 0.78, colour: shade(colour, 0.75) },
    { dx: -w * 0.3, dz: d * 0.92, halfWidth: w * 0.3, halfDepth: d * 0.05, height: h * 0.3, y: h * 0.3, colour: "#e8e8e0" },
    { dx: w * 0.8, dz: 0, halfWidth: w * 0.15, halfDepth: d * 0.12, height: h * 0.95, colour: "#2a2a2a" },
  ],

  kiosk: ({ halfWidth: w, halfDepth: d, height: h }, colour) => [
    { dx: 0, dz: -d * 0.15, halfWidth: w, halfDepth: d * 0.85, height: h * 0.88, colour },
    // The serving hatch above a wooden counter, under a zinc roof.
    { dx: 0, dz: d * 0.68, halfWidth: w * 0.8, halfDepth: 0.03, height: h * 0.32, y: h * 0.45, colour: DARK },
    { dx: 0, dz: d * 0.85, halfWidth: w, halfDepth: d * 0.15, height: h * 0.42, colour: "#8a6a46" },
    { dx: 0, dz: 0, halfWidth: w, halfDepth: d, height: h * 0.08, y: h * 0.92, colour: ZINC },
  ],

  container_shop: ({ halfWidth: w, halfDepth: d, height: h }, colour) => {
    const doorX = -w * 0.3;
    const doorHalf = Math.min(w * 0.25, 1);
    const parts: Part[] = [
      { dx: 0, dz: 0, halfWidth: w, halfDepth: d * 0.97, height: h * 0.94, colour },
      { dx: 0, dz: 0, halfWidth: w, halfDepth: d * 0.97, height: h * 0.06, y: h * 0.94, colour: shade(colour, 0.7) },
      // The open doors, with the shop's dark inside.
      { dx: doorX, dz: d * 0.985, halfWidth: doorHalf, halfDepth: d * 0.015, height: h * 0.7, colour: DARK },
    ];
    // Corrugated ribs along the front, except across the doorway.
    for (let x = -w + 0.3; x < w - 0.1; x += 0.6) {
      if (Math.abs(x - doorX) < doorHalf + 0.05) continue;
      parts.push({ dx: x, dz: d * 0.985, halfWidth: 0.04, halfDepth: d * 0.015, height: h * 0.94, colour: shade(colour, 0.85) });
    }
    return parts;
  },

  electric_pole: ({ halfWidth: w, height: h }, colour) => [
    { dx: 0, dz: 0, halfWidth: 0.12, halfDepth: 0.12, height: h, colour },
    { dx: 0, dz: 0, halfWidth: w, halfDepth: 0.07, height: 0.12, y: h - 0.6, colour: shade(colour, 0.8) },
    ...[-1, 1].map((side) => ({
      dx: side * w * WIRE_ATTACH_SPREAD,
      dz: 0,
      halfWidth: 0.05,
      halfDepth: 0.05,
      height: 0.14,
      y: h - 0.48,
      colour: "#dcdcd4",
    })),
  ],

  palm: ({ height: h }, colour) => {
    const segment = (h * PALM_TRUNK_SHARE) / PALM_TRUNK_SEGMENTS;
    const parts: Part[] = [];
    for (let index = 0; index < PALM_TRUNK_SEGMENTS; index++) {
      const half = 0.24 - index * 0.02;
      // Alternate shades for the rings of an oil palm's trunk, leaning a little as it climbs.
      parts.push({
        dx: index * PALM_LEAN_PER_SEGMENT,
        dz: 0,
        halfWidth: half,
        halfDepth: half,
        height: segment,
        y: index * segment,
        colour: index % 2 === 0 ? colour : shade(colour, 0.85),
      });
    }
    parts.push({ ...palmCrownLocal(h), halfWidth: 0.3, halfDepth: 0.3, height: 0.4, colour: "#4f6b2a" });
    return parts;
  },

  billboard: ({ halfWidth: w, halfDepth: d, height: h }, colour) => [
    // One post (a "unipole"), the board's frame, and a narrow ledge for whoever pastes the ads.
    { dx: 0, dz: 0, halfWidth: 0.22, halfDepth: 0.22, height: h * 0.62, colour: "#5a5a5a" },
    { dx: 0, dz: 0, halfWidth: w, halfDepth: d * 0.5, height: h * 0.38, y: h * 0.62, colour },
    { dx: 0, dz: d * 0.75, halfWidth: w * 0.98, halfDepth: d * 0.25, height: 0.06, y: h * 0.6, colour: "#444444" },
  ],

  signboard: ({ halfWidth: w, halfDepth: d, height: h }, colour) => [
    // A painted board on two posts, like a church's or a buka's sign by the road.
    { dx: -(w - 0.12), dz: 0, halfWidth: 0.05, halfDepth: 0.05, height: h, colour: "#3a3a3a" },
    { dx: w - 0.12, dz: 0, halfWidth: 0.05, halfDepth: 0.05, height: h, colour: "#3a3a3a" },
    { dx: 0, dz: d * 0.3, halfWidth: w, halfDepth: d * 0.4, height: h * 0.45, y: h * 0.52, colour },
  ],

  hawker_table: ({ halfWidth: w, halfDepth: d, height: h }, colour) => [
    { dx: 0, dz: 0, halfWidth: w, halfDepth: d, height: 0.05, y: h - 0.05, colour },
    ...corners(w - 0.05, d - 0.05).map(([dx, dz]) => ({
      dx,
      dz,
      halfWidth: 0.03,
      halfDepth: 0.03,
      height: h - 0.05,
      colour: shade(colour, 0.7),
    })),
    // Goods for sale: oranges, sweets and tomatoes in neat piles.
    ...(["#e8892b", "#f2d16b", "#c0392b"] as const).map((goods, index) => ({
      dx: (index - 1) * w * 0.6,
      dz: 0,
      halfWidth: w * 0.2,
      halfDepth: d * 0.5,
      height: 0.12,
      y: h,
      colour: goods,
    })),
  ],

  plastic_chair: ({ halfWidth: w, halfDepth: d, height: h }, colour) => [
    { dx: 0, dz: 0, halfWidth: w * 0.9, halfDepth: d * 0.9, height: 0.05, y: 0.42, colour },
    { dx: 0, dz: -d * 0.85, halfWidth: w * 0.9, halfDepth: d * 0.08, height: h - 0.47, y: 0.47, colour },
    ...corners(w * 0.75, d * 0.75).map(([dx, dz]) => ({
      dx,
      dz,
      halfWidth: 0.025,
      halfDepth: 0.025,
      height: 0.42,
      colour: shade(colour, 0.9),
    })),
  ],

  // Painted yellow and black across the road (along the kind's depth).
  speed_bump: ({ halfWidth: w, halfDepth: d, height: h }, colour) => {
    const stripes = Math.max(1, Math.round((d * 2) / 0.6));
    const length = (d * 2) / stripes;
    return Array.from({ length: stripes }, (_, index) => ({
      dx: 0,
      dz: -d + length * (index + 0.5),
      halfWidth: w,
      halfDepth: length / 2,
      height: h,
      colour: index % 2 === 0 ? colour : "#222222",
    }));
  },
};

function corners(x: number, z: number): [number, number][] {
  return [
    [-x, -z],
    [x, -z],
    [-x, z],
    [x, z],
  ];
}

/** The top of a palm's trunk in its own frame, where the fronds start. */
function palmCrownLocal(height: number): { dx: number; dz: number; y: number } {
  return {
    dx: (PALM_TRUNK_SEGMENTS - 1) * PALM_LEAN_PER_SEGMENT,
    dz: 0,
    y: height * PALM_TRUNK_SHARE - 0.15,
  };
}

/** One palm frond: starts at (x, y, z), points along `yaw`, droops by `droop` radians. */
export interface Frond {
  x: number;
  y: number;
  z: number;
  yaw: number;
  droop: number;
  length: number;
}

/** The fronds of every palm, for one instanced draw call. Seeded, so every visit grows the same palms. */
export function palmFronds(layout: Pick<DistrictLayout, "props" | "propKinds">): Frond[] {
  const random = seededRandom(0xa1a);
  return layout.props.flatMap((prop) => {
    const look = builtLook(layout, prop);
    if (look?.built !== "palm") return [];
    const crown = palmCrownLocal(look.height);
    const [dx, dz] = turnPoint(crown.dx, crown.dz, prop.rotation);
    const start = random() * Math.PI * 2;
    return Array.from({ length: PALM_FRONDS }, (_, index) => ({
      x: prop.x + dx,
      y: crown.y + 0.3,
      z: prop.z + dz,
      yaw: start + (index / PALM_FRONDS) * Math.PI * 2 + (random() - 0.5) * 0.3,
      droop: 0.25 + random() * 0.35,
      length: look.halfWidth * (0.85 + random() * 0.15),
    }));
  });
}

/**
 * The electric wires: a sagging line between each pair of neighbouring poles
 * on the same `wire`, from each end of the crossarm. Returns line-segment
 * endpoints (x, y, z, x, y, z, ...) for one LineSegments draw call.
 */
export function wireSegments(layout: Pick<DistrictLayout, "props" | "propKinds">): number[] {
  const lines = new Map<string, { prop: Prop; look: BuiltLook }[]>();
  for (const prop of layout.props) {
    const look = builtLook(layout, prop);
    if (!prop.wire || look?.built !== "electric_pole") continue;
    lines.set(prop.wire, [...(lines.get(prop.wire) ?? []), { prop, look }]);
  }

  const points: number[] = [];
  const attach = ({ prop, look }: { prop: Prop; look: BuiltLook }, side: number): [number, number, number] => {
    const [dx, dz] = turnPoint(side * look.halfWidth * WIRE_ATTACH_SPREAD, 0, prop.rotation);
    return [prop.x + dx, look.height - WIRE_ATTACH_BELOW_TOP, prop.z + dz];
  };
  for (const poles of lines.values()) {
    for (let index = 1; index < poles.length; index++) {
      const from = poles[index - 1];
      const to = poles[index];
      if (!from || !to) continue;
      for (const side of [-1, 1]) {
        const [ax, ay, az] = attach(from, side);
        const [bx, by, bz] = attach(to, side);
        const sag = Math.hypot(bx - ax, bz - az) * WIRE_SAG;
        const at = (t: number): [number, number, number] => [
          ax + (bx - ax) * t,
          ay + (by - ay) * t - sag * 4 * t * (1 - t),
          az + (bz - az) * t,
        ];
        for (let piece = 0; piece < WIRE_PIECES; piece++) {
          points.push(...at(piece / WIRE_PIECES), ...at((piece + 1) / WIRE_PIECES));
        }
      }
    }
  }
  return points;
}

/** A painted face on a prop: a billboard's advert or a shop's name. */
export interface PropLabel {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  width: number;
  height: number;
  text: string;
  background: string;
  ink: string;
  lines: number;
}

const ADVERT_COLOURS = ["#c0392b", "#1f6fb2", "#2f7a55", "#d9822b"] as const;

/** Where each labelled prop's painted face goes: on its front (+z before rotation). */
export function propLabels(layout: Pick<DistrictLayout, "props" | "propKinds">): PropLabel[] {
  return layout.props.flatMap((prop, index) => {
    const look = builtLook(layout, prop);
    if (!look || !prop.label) return [];
    const { halfWidth: w, halfDepth: d, height: h } = look;
    const face = (front: number, y: number, width: number, height: number, style: Pick<PropLabel, "background" | "ink" | "lines">): PropLabel[] => {
      const [dx, dz] = turnPoint(0, front, prop.rotation);
      return [{ x: prop.x + dx, y, z: prop.z + dz, rotationY: (prop.rotation * Math.PI) / 180, width, height, text: prop.label ?? "", ...style }];
    };
    switch (look.built) {
      case "billboard":
        return face(d * 0.5 + 0.01, h * 0.81, w * 2 - 0.3, h * 0.38 - 0.3, {
          background: ADVERT_COLOURS[index % ADVERT_COLOURS.length] ?? ADVERT_COLOURS[0],
          ink: "#ffffff",
          lines: 2,
        });
      case "kiosk":
        return face(d * 0.7 + 0.01, h * 0.86, w * 1.8, h * 0.1, { background: "#f2d16b", ink: DARK, lines: 1 });
      case "container_shop":
        return face(d + 0.01, h * 0.8, w * 1.4, h * 0.18, { background: "#f4f1e8", ink: "#b5432f", lines: 1 });
      case "signboard":
        return face(d * 0.7 + 0.01, h * 0.745, w * 2 - 0.2, h * 0.45 - 0.12, {
          background: look.colour ?? DEFAULT_COLOURS.signboard,
          ink: "#1f3a8a",
          lines: 2,
        });
      default:
        return [];
    }
  });
}
