import {
  type Box,
  type DistrictHeader,
  type LandmarkIcon,
  MAP_BUILDING_STRIDE,
  type Point,
  type Route,
  ZINC_TONE_COUNT,
  bridges,
  hash01,
  seededRandom,
  waterPieces,
} from "@japalife/shared";
import { PLACE_COLOURS } from "../placeColours";
import { ROOF_COLOURS } from "../world/roofColours";

/**
 * The 2D map, painted like an aerial photo of the district from the header
 * (which has every road, building, tree and body of water, however few chunks
 * are loaded). North is up, as in the street view, so the map never turns.
 * The ground, water, roads, buildings and trees are painted once into a base
 * image; each redraw copies the visible part of it and adds the route, the
 * places, the landmark badges, the labels and the player on top.
 */

const COLOURS = {
  ground: "#b8aa8a",
  groundPatches: ["rgba(122, 140, 76, 0.32)", "rgba(96, 118, 58, 0.28)", "rgba(150, 132, 102, 0.3)", "rgba(196, 184, 156, 0.28)"],
  asphalt: "#46464c",
  lane: "#7a776f",
  kerb: "#9a958b",
  centreLine: "rgba(240, 236, 220, 0.85)",
  water: "#3f93cc",
  waterLight: "rgba(220, 242, 255, 0.55)",
  bank: "#c9c2b2",
  parapet: "#e1dbcd",
  shadow: "rgba(40, 32, 22, 0.32)",
  roofEdge: "rgba(30, 25, 20, 0.35)",
  ridge: "rgba(255, 255, 255, 0.28)",
  canopy: ["#4f6f2c", "#5c7d33", "#466528", "#6a8a3a"],
  canopyLight: "rgba(190, 220, 130, 0.45)",
  route: "#ffc928",
  routeEdge: "#5a3d00",
  player: "#e5392f",
  text: "#1f1f22",
  halo: "rgba(255, 255, 255, 0.9)",
} as const;

/** Resolution of the base image: about 1,280 px a side for a 600 m district, crisp when zoomed in. */
const BASE_PIXELS_PER_METRE = 2;
/** Ground shown round the district edge, metres. */
const MARGIN = 20;
/** Sunlight from the north-west: each metre of height casts this much shadow east and south. */
const SHADOW_PER_METRE = 0.32;
/** Tree canopies and their shadows, metres. */
const CANOPY_RADIUS = 2.6;
const TREE_HEIGHT = 6;
/** Main roads' centre line: dashes and gaps, metres. */
const DASH = { length: 3, gap: 3, width: 0.25 } as const;

export interface MapBase {
  canvas: HTMLCanvasElement;
  /** World x and z at the base image's top-left corner. */
  left: number;
  top: number;
}

/** Where the map is looking: the world point at its centre, and screen pixels per metre. */
export interface MapView {
  x: number;
  z: number;
  scale: number;
}

type MapHeader = Pick<DistrictHeader, "halfWidth" | "halfDepth" | "roads" | "mapBuildings" | "mapTrees" | "water">;

export function paintMapBase(header: MapHeader): MapBase {
  const left = -header.halfWidth - MARGIN;
  const top = -header.halfDepth - MARGIN;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((header.halfWidth + MARGIN) * 2 * BASE_PIXELS_PER_METRE);
  canvas.height = Math.ceil((header.halfDepth + MARGIN) * 2 * BASE_PIXELS_PER_METRE);
  const context = canvas.getContext("2d");
  if (!context) return { canvas, left, top };
  // Draw in world metres from here on.
  context.scale(BASE_PIXELS_PER_METRE, BASE_PIXELS_PER_METRE);
  context.translate(-left, -top);

  paintGround(context, header, left, top);
  paintWater(context, header);
  paintRoads(context, header);
  paintBridges(context, header);
  const buildings = buildingsOf(header.mapBuildings);
  const trees = pairsOf(header.mapTrees);
  // Every shadow before any roof or canopy, so a tall block's shadow falls across the low roofs beside it.
  paintShadows(context, buildings, trees);
  paintRoofs(context, buildings);
  paintTrees(context, trees);
  return { canvas, left, top };
}

interface MapBuilding extends Box {
  height: number;
  tone: number;
}

function buildingsOf(numbers: readonly number[]): MapBuilding[] {
  const buildings: MapBuilding[] = [];
  for (let index = 0; index + MAP_BUILDING_STRIDE - 1 < numbers.length; index += MAP_BUILDING_STRIDE) {
    const [x, z, halfWidth, halfDepth, height, tone] = numbers.slice(index, index + MAP_BUILDING_STRIDE) as [number, number, number, number, number, number];
    buildings.push({ x, z, halfWidth, halfDepth, height, tone });
  }
  return buildings;
}

function pairsOf(numbers: readonly number[]): Point[] {
  const points: Point[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index] as number, z: numbers[index + 1] as number });
  return points;
}

/** Sandy ground with soft patches of grass and bare earth, the same every time (seeded). */
function paintGround(context: CanvasRenderingContext2D, header: MapHeader, left: number, top: number): void {
  const width = (header.halfWidth + MARGIN) * 2;
  const depth = (header.halfDepth + MARGIN) * 2;
  context.fillStyle = COLOURS.ground;
  context.fillRect(left, top, width, depth);
  const random = seededRandom(0x6a9e1);
  const patches = Math.round((width * depth) / 900);
  for (let index = 0; index < patches; index++) {
    context.fillStyle = COLOURS.groundPatches[Math.floor(random() * COLOURS.groundPatches.length)] ?? COLOURS.ground;
    context.beginPath();
    const radius = 4 + random() * 18;
    context.ellipse(left + random() * width, top + random() * depth, radius * (1 + random()), radius, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
}

/** Blue water inside a concrete bank, with light ripples. */
function paintWater(context: CanvasRenderingContext2D, header: MapHeader): void {
  const pieces = waterPieces(header.water, header.roads);
  context.fillStyle = COLOURS.bank;
  for (const piece of pieces) fillBox(context, piece, 0.5);
  context.fillStyle = COLOURS.water;
  for (const piece of pieces) fillBox(context, piece);
  const random = seededRandom(0x3a7e5);
  context.strokeStyle = COLOURS.waterLight;
  context.lineWidth = 0.25;
  context.lineCap = "round";
  for (const piece of pieces) {
    const ripples = Math.round((piece.halfWidth * piece.halfDepth) / 6);
    for (let index = 0; index < ripples; index++) {
      const x = piece.x + (random() * 2 - 1) * (piece.halfWidth - 1);
      const z = piece.z + (random() * 2 - 1) * (piece.halfDepth - 1);
      context.beginPath();
      context.moveTo(x - 0.8, z);
      context.quadraticCurveTo(x, z - 0.35, x + 0.8, z);
      context.stroke();
    }
  }
}

/** Lanes first, then the bigger roads over them; a kerb line along each edge and dashes down the main roads. */
function paintRoads(context: CanvasRenderingContext2D, header: MapHeader): void {
  const { roads } = header;
  const order = [...roads].sort((a, b) => rank(a.class) - rank(b.class));
  for (const road of order) {
    context.fillStyle = COLOURS.kerb;
    fillBox(context, road, 0.3);
  }
  for (const road of order) {
    context.fillStyle = road.class === "lane" ? COLOURS.lane : COLOURS.asphalt;
    fillBox(context, road);
  }
  context.fillStyle = COLOURS.centreLine;
  for (const road of roads) {
    if (road.class !== "main") continue;
    const alongX = road.halfWidth >= road.halfDepth;
    const start = alongX ? road.x - road.halfWidth : road.z - road.halfDepth;
    const end = alongX ? road.x + road.halfWidth : road.z + road.halfDepth;
    for (let at = start + DASH.gap; at + DASH.length < end; at += DASH.length + DASH.gap) {
      const middle = at + DASH.length / 2;
      const spot = alongX ? { x: middle, z: road.z } : { x: road.x, z: middle };
      // No dashes across a junction.
      if (roads.some((other) => other !== road && Math.abs(spot.x - other.x) < other.halfWidth && Math.abs(spot.z - other.z) < other.halfDepth)) continue;
      if (alongX) context.fillRect(at, road.z - DASH.width / 2, DASH.length, DASH.width);
      else context.fillRect(road.x - DASH.width / 2, at, DASH.width, DASH.length);
    }
  }
}

function rank(roadClass: string | undefined): number {
  return roadClass === "lane" ? 0 : roadClass === "inner" ? 1 : 2;
}

/** A pale parapet line along each side of every bridge. */
function paintBridges(context: CanvasRenderingContext2D, header: MapHeader): void {
  context.fillStyle = COLOURS.parapet;
  for (const deck of bridges(header.water, header.roads)) {
    const alongX = header.water.some((body) => Math.abs(body.halfWidth - deck.halfWidth) < 0.01 && Math.abs(body.x - deck.x) < 0.01);
    if (alongX) {
      context.fillRect(deck.x - deck.halfWidth - 0.6, deck.z - deck.halfDepth - 0.3, deck.halfWidth * 2 + 1.2, 0.3);
      context.fillRect(deck.x - deck.halfWidth - 0.6, deck.z + deck.halfDepth, deck.halfWidth * 2 + 1.2, 0.3);
    } else {
      context.fillRect(deck.x - deck.halfWidth - 0.3, deck.z - deck.halfDepth - 0.6, 0.3, deck.halfDepth * 2 + 1.2);
      context.fillRect(deck.x + deck.halfWidth, deck.z - deck.halfDepth - 0.6, 0.3, deck.halfDepth * 2 + 1.2);
    }
  }
}

/**
 * Each building's shadow is its footprint swept toward the south-east, as far
 * as its height casts; every shadow is one path, so where two overlap the
 * ground is not darkened twice.
 */
function paintShadows(context: CanvasRenderingContext2D, buildings: readonly MapBuilding[], trees: readonly Point[]): void {
  context.beginPath();
  for (const building of buildings) {
    const reach = building.height * SHADOW_PER_METRE;
    const west = building.x - building.halfWidth;
    const east = building.x + building.halfWidth;
    const north = building.z - building.halfDepth;
    const south = building.z + building.halfDepth;
    context.moveTo(west, north);
    context.lineTo(east, north);
    context.lineTo(east + reach, north + reach);
    context.lineTo(east + reach, south + reach);
    context.lineTo(west + reach, south + reach);
    context.lineTo(west, south);
    context.closePath();
  }
  const treeReach = TREE_HEIGHT * SHADOW_PER_METRE * 0.6;
  for (const tree of trees) {
    context.moveTo(tree.x + treeReach + CANOPY_RADIUS, tree.z + treeReach);
    context.arc(tree.x + treeReach, tree.z + treeReach, CANOPY_RADIUS * 0.9, 0, Math.PI * 2);
  }
  context.fillStyle = COLOURS.shadow;
  context.fill("nonzero");
}

/** Each roof in its colour, with a darker edge, and a light ridge down the long side of a zinc roof. */
function paintRoofs(context: CanvasRenderingContext2D, buildings: readonly MapBuilding[]): void {
  for (const building of buildings) {
    context.fillStyle = ROOF_COLOURS[building.tone] ?? ROOF_COLOURS[0] ?? COLOURS.asphalt;
    fillBox(context, building);
  }
  context.strokeStyle = COLOURS.roofEdge;
  context.lineWidth = 0.3;
  for (const building of buildings) {
    context.strokeRect(building.x - building.halfWidth, building.z - building.halfDepth, building.halfWidth * 2, building.halfDepth * 2);
  }
  context.strokeStyle = COLOURS.ridge;
  context.lineWidth = 0.35;
  for (const building of buildings) {
    if (building.tone >= ZINC_TONE_COUNT) continue; // concrete roofs are flat: no ridge
    context.beginPath();
    if (building.halfWidth >= building.halfDepth) {
      context.moveTo(building.x - building.halfWidth + 0.4, building.z);
      context.lineTo(building.x + building.halfWidth - 0.4, building.z);
    } else {
      context.moveTo(building.x, building.z - building.halfDepth + 0.4);
      context.lineTo(building.x, building.z + building.halfDepth - 0.4);
    }
    context.stroke();
  }
}

/** Round green canopies, each a slightly different green, lit from the north-west. */
function paintTrees(context: CanvasRenderingContext2D, trees: readonly Point[]): void {
  for (const tree of trees) {
    const shade = hash01(`${tree.x},${tree.z}`);
    context.fillStyle = COLOURS.canopy[Math.floor(shade * COLOURS.canopy.length)] ?? COLOURS.canopy[0];
    context.beginPath();
    context.arc(tree.x, tree.z, CANOPY_RADIUS * (0.8 + shade * 0.4), 0, Math.PI * 2);
    context.fill();
    context.fillStyle = COLOURS.canopyLight;
    context.beginPath();
    context.arc(tree.x - 0.7, tree.z - 0.7, CANOPY_RADIUS * 0.45, 0, Math.PI * 2);
    context.fill();
  }
}

/** Fills a box, grown by `grow` metres on every side. */
function fillBox(context: CanvasRenderingContext2D, box: Box, grow = 0): void {
  context.fillRect(box.x - box.halfWidth - grow, box.z - box.halfDepth - grow, (box.halfWidth + grow) * 2, (box.halfDepth + grow) * 2);
}

/** Ground shown beyond the district's edge, metres, when zoomed right out or dragged to an edge. */
const VIEW_MARGIN = 15;

type Bounds = Pick<DistrictHeader, "halfWidth" | "halfDepth">;

/** Zoomed right out: the district (and a little ground round it) just fills the screen's width or height, whichever is tighter. */
export function fitScale(district: Bounds, width: number, height: number): number {
  return Math.min(width / ((district.halfWidth + VIEW_MARGIN) * 2), height / ((district.halfDepth + VIEW_MARGIN) * 2));
}

/**
 * Keeps the map from being dragged off the district: along each axis the
 * screen shows at most `VIEW_MARGIN` past the district's edge, or the
 * district centred when it is narrower than the screen.
 */
export function keepInside(view: MapView, district: Bounds, width: number, height: number): void {
  const clamp = (centre: number, half: number, screenHalf: number): number => {
    const room = half + VIEW_MARGIN - screenHalf;
    return room <= 0 ? 0 : Math.min(room, Math.max(-room, centre));
  };
  view.x = clamp(view.x, district.halfWidth, width / 2 / view.scale);
  view.z = clamp(view.z, district.halfDepth, height / 2 / view.scale);
}

export function worldToScreen(view: MapView, width: number, height: number, point: Point): { x: number; y: number } {
  return { x: (point.x - view.x) * view.scale + width / 2, y: (point.z - view.z) * view.scale + height / 2 };
}

export function screenToWorld(view: MapView, width: number, height: number, x: number, y: number): Point {
  return { x: (x - width / 2) / view.scale + view.x, z: (y - height / 2) / view.scale + view.z };
}

export interface MapOverlay {
  header: Pick<DistrictHeader, "roads" | "landmarks" | "interactables">;
  player: Point;
  route: Route | null;
  /** Street, landmark and place names: on the full map, not the minimap. */
  labels: boolean;
}

/** Draws the map into a context sized `width` x `height` (CSS pixels; scale the context for the screen's pixel ratio first). */
export function drawMap(context: CanvasRenderingContext2D, base: MapBase, view: MapView, width: number, height: number, overlay: MapOverlay): void {
  context.fillStyle = COLOURS.ground;
  context.fillRect(0, 0, width, height);
  // The visible part of the base image, scaled to the screen.
  const worldLeft = view.x - width / 2 / view.scale;
  const worldTop = view.z - height / 2 / view.scale;
  context.imageSmoothingEnabled = true;
  context.drawImage(
    base.canvas,
    (worldLeft - base.left) * BASE_PIXELS_PER_METRE,
    (worldTop - base.top) * BASE_PIXELS_PER_METRE,
    (width / view.scale) * BASE_PIXELS_PER_METRE,
    (height / view.scale) * BASE_PIXELS_PER_METRE,
    0,
    0,
    width,
    height,
  );
  const at = (point: Point): { x: number; y: number } => worldToScreen(view, width, height, point);

  if (overlay.route && overlay.route.points.length > 1) {
    for (const [colour, lineWidth] of [[COLOURS.routeEdge, 6], [COLOURS.route, 3.5]] as const) {
      context.beginPath();
      overlay.route.points.forEach((point, index) => {
        const { x, y } = at(point);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = colour;
      context.lineWidth = lineWidth;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke();
    }
  }

  for (const place of overlay.header.interactables) {
    const { x, y } = at(place.position);
    context.beginPath();
    context.arc(x, y, overlay.labels ? 5 : 3, 0, Math.PI * 2);
    context.fillStyle = PLACE_COLOURS[place.kind];
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = "#ffffff";
    context.stroke();
  }

  // Labels never cover a badge or each other: whatever would overlap something already placed is left out.
  const taken = new LabelSpace();
  for (const landmark of overlay.header.landmarks) {
    if (!landmark.icon) continue;
    const { x, y } = at(landmark);
    if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
    const radius = overlay.labels ? BADGE_RADIUS : MINIMAP_BADGE_RADIUS;
    drawBadge(context, landmark.icon, x, y, radius);
    taken.claim({ left: x - radius, top: y - radius, right: x + radius, bottom: y + radius });
  }

  if (overlay.labels) drawLabels(context, view, width, height, overlay.header, taken);

  const me = at(overlay.player);
  context.beginPath();
  context.arc(me.x, me.y, overlay.labels ? 7 : 5, 0, Math.PI * 2);
  context.fillStyle = COLOURS.player;
  context.fill();
  context.lineWidth = 2.5;
  context.strokeStyle = "#ffffff";
  context.stroke();
}

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The parts of the screen already used by badges and labels. A few dozen on screen at most, so a list is enough. */
export class LabelSpace {
  private readonly rects: ScreenRect[] = [];

  /** Takes the rectangle unless it overlaps one already taken; says whether it did. */
  claim(rect: ScreenRect): boolean {
    if (this.rects.some((other) => rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top)) {
      return false;
    }
    this.rects.push(rect);
    return true;
  }
}

/** Landmark badges' radius on the full map and on the minimap, pixels. */
const BADGE_RADIUS = 11;
const MINIMAP_BADGE_RADIUS = 7;

/** A gap kept round each label, pixels, so neighbours do not touch. */
const LABEL_GAP = 3;

/** Draws a label centred on (x, y) if it has room, rotated a quarter turn for a north-south street. */
function label(
  context: CanvasRenderingContext2D,
  taken: LabelSpace,
  text: string,
  x: number,
  y: number,
  size: number,
  turned = false,
): void {
  context.font = `600 ${size}px system-ui, sans-serif`;
  const halfLength = context.measureText(text).width / 2 + LABEL_GAP;
  const halfThickness = size / 2 + LABEL_GAP;
  const [halfX, halfY] = turned ? [halfThickness, halfLength] : [halfLength, halfThickness];
  if (!taken.claim({ left: x - halfX, top: y - halfY, right: x + halfX, bottom: y + halfY })) return;
  context.save();
  context.translate(x, y);
  if (turned) context.rotate(-Math.PI / 2);
  context.font = `600 ${size}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 3;
  // Round joins: sharp ones spike out of letters like M and W.
  context.lineJoin = "round";
  context.strokeStyle = COLOURS.halo;
  context.strokeText(text, 0, 0);
  context.fillStyle = COLOURS.text;
  context.fillText(text, 0, 0);
  context.restore();
}

/**
 * Landmark names under their badges first (what people look for), then street
 * names along their roads (kept on screen), then places once zoomed in. Each
 * is left out where it would overlap something already drawn.
 */
function drawLabels(
  context: CanvasRenderingContext2D,
  view: MapView,
  width: number,
  height: number,
  header: MapOverlay["header"],
  taken: LabelSpace,
): void {
  for (const landmark of header.landmarks) {
    const { x, y } = worldToScreen(view, width, height, landmark);
    // Under its badge if it has one (clear of the badge, or the badge's own space would turn it away), else where it stands.
    label(context, taken, landmark.name, x, landmark.icon ? y + BADGE_RADIUS + 13 : y - 12, 13);
  }
  for (const road of header.roads) {
    if (!road.name) continue;
    const alongX = road.halfWidth >= road.halfDepth;
    // The name sits where the road crosses the middle of the screen, so it stays in view while panning.
    const along = alongX
      ? Math.min(road.x + road.halfWidth - 30, Math.max(road.x - road.halfWidth + 30, view.x))
      : Math.min(road.z + road.halfDepth - 30, Math.max(road.z - road.halfDepth + 30, view.z));
    const { x, y } = worldToScreen(view, width, height, alongX ? { x: along, z: road.z } : { x: road.x, z: along });
    label(context, taken, road.name, x, y, 12, !alongX);
  }
  if (view.scale < 1.2) return; // place names only once zoomed in, where there is room
  for (const place of header.interactables) {
    const { x, y } = worldToScreen(view, width, height, place.position);
    label(context, taken, place.label, x, y + 14, 11);
  }
}

/** Each landmark badge's ring colour. */
const BADGE_COLOURS: Record<LandmarkIcon, string> = {
  market: "#c4661a",
  church: "#5b4a9e",
  mosque: "#1f7a5a",
  school: "#2f5d8a",
  bus: "#d1a20e",
  okada: "#c46a12",
  office: "#4a6278",
  plaza: "#b23a6a",
  tools: "#5f6a72",
};

/** A round white badge with a coloured ring and a little picture, `radius` pixels across the screen. */
export function drawBadge(context: CanvasRenderingContext2D, icon: LandmarkIcon, x: number, y: number, radius: number): void {
  const colour = BADGE_COLOURS[icon];
  context.save();
  context.translate(x, y);
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.lineWidth = Math.max(1.5, radius / 5);
  context.strokeStyle = colour;
  context.stroke();
  // The pictures are drawn in a 20-unit box round the centre.
  const unit = (radius * 0.62) / 10;
  context.scale(unit, unit);
  context.fillStyle = colour;
  context.strokeStyle = colour;
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  ICONS[icon](context);
  context.restore();
}

/** One small picture per landmark kind, drawn in code (no image download). */
const ICONS: Record<LandmarkIcon, (context: CanvasRenderingContext2D) => void> = {
  market: (c) => {
    // A basket with a handle.
    c.beginPath();
    c.moveTo(-9, -1);
    c.lineTo(9, -1);
    c.lineTo(6, 8);
    c.lineTo(-6, 8);
    c.closePath();
    c.fill();
    c.beginPath();
    c.arc(0, -1, 6, Math.PI, 0);
    c.stroke();
  },
  church: (c) => {
    // A cross.
    c.fillRect(-1.6, -9, 3.2, 18);
    c.fillRect(-6.5, -4.5, 13, 3.2);
  },
  mosque: (c) => {
    // A crescent: a circle with a smaller one cut away.
    c.beginPath();
    c.arc(-1, 0, 8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.arc(2.5, -1.5, 6.5, 0, Math.PI * 2);
    c.fill();
  },
  school: (c) => {
    // A mortarboard.
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(10, -2);
    c.lineTo(0, 3);
    c.lineTo(-10, -2);
    c.closePath();
    c.fill();
    c.fillRect(-5, 1, 10, 5);
    c.beginPath();
    c.moveTo(8, -1);
    c.lineTo(8, 6);
    c.stroke();
  },
  bus: (c) => {
    // A danfo from the side: body, windows, wheels.
    c.fillRect(-9, -6, 18, 11);
    c.fillStyle = "#ffffff";
    for (const x of [-7, -2.5, 2]) c.fillRect(x, -4, 3.5, 3.5);
    c.fillStyle = "#1f1f22";
    for (const x of [-5, 5]) {
      c.beginPath();
      c.arc(x, 6, 2.6, 0, Math.PI * 2);
      c.fill();
    }
  },
  okada: (c) => {
    // A motorbike: two wheels and a frame.
    c.beginPath();
    c.arc(-6, 4, 3.5, 0, Math.PI * 2);
    c.moveTo(9.5, 4);
    c.arc(6, 4, 3.5, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(-6, 4);
    c.lineTo(-1, -2);
    c.lineTo(4, -2);
    c.lineTo(6, 4);
    c.moveTo(4, -2);
    c.lineTo(3, -6);
    c.lineTo(6, -6);
    c.stroke();
  },
  office: (c) => {
    // A tall block with windows.
    c.fillRect(-6, -9, 12, 18);
    c.fillStyle = "#ffffff";
    for (const y of [-6, -1.5, 3]) for (const x of [-3.5, 1]) c.fillRect(x, y, 2.5, 2.5);
  },
  plaza: (c) => {
    // A shopping bag.
    c.fillRect(-7, -3, 14, 12);
    c.beginPath();
    c.arc(0, -3, 4, Math.PI, 0);
    c.stroke();
  },
  tools: (c) => {
    // A spanner.
    c.lineWidth = 3.5;
    c.beginPath();
    c.moveTo(-6, 6);
    c.lineTo(3, -3);
    c.stroke();
    c.beginPath();
    c.arc(5, -5, 4, 0, Math.PI * 2);
    c.fill();
    // The spanner's open jaw.
    c.fillStyle = "#ffffff";
    c.fillRect(5, -9.5, 3, 5);
  },
};
