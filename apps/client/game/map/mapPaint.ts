import type { DistrictHeader, Point, Route } from "@japalife/shared";
import { PLACE_COLOURS } from "../placeColours";

/**
 * The 2D map, drawn on a canvas from the district header (which has every
 * road and building outline, however few chunks are loaded). North is up, as
 * in the street view, so the map never turns. The roads and buildings are
 * painted once into a base image; each redraw copies the visible part of it
 * and adds the route, the places, the labels and the player on top.
 */

const COLOURS = {
  ground: "#cdbf9f",
  building: "#a3957c",
  road: "#47474d",
  lane: "#76747a",
  route: "#ffc928",
  routeEdge: "#5a3d00",
  player: "#e5392f",
  text: "#1f1f22",
  halo: "rgba(255, 255, 255, 0.9)",
} as const;

/** Resolution of the base image: about 950 px a side for a 600 m district, a few MB. */
const BASE_PIXELS_PER_METRE = 1.5;
/** Ground shown round the district edge, metres. */
const MARGIN = 20;

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

export function paintMapBase(header: Pick<DistrictHeader, "halfWidth" | "halfDepth" | "roads" | "mapBuildings">): MapBase {
  const left = -header.halfWidth - MARGIN;
  const top = -header.halfDepth - MARGIN;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((header.halfWidth + MARGIN) * 2 * BASE_PIXELS_PER_METRE);
  canvas.height = Math.ceil((header.halfDepth + MARGIN) * 2 * BASE_PIXELS_PER_METRE);
  const context = canvas.getContext("2d");
  if (!context) return { canvas, left, top };
  const px = (metres: number): number => metres * BASE_PIXELS_PER_METRE;
  context.fillStyle = COLOURS.ground;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const road of header.roads) {
    context.fillStyle = road.class === "lane" ? COLOURS.lane : COLOURS.road;
    context.fillRect(px(road.x - road.halfWidth - left), px(road.z - road.halfDepth - top), px(road.halfWidth * 2), px(road.halfDepth * 2));
  }
  context.fillStyle = COLOURS.building;
  const outlines = header.mapBuildings;
  for (let index = 0; index + 3 < outlines.length; index += 4) {
    const [x, z, halfWidth, halfDepth] = outlines.slice(index, index + 4) as [number, number, number, number];
    context.fillRect(px(x - halfWidth - left), px(z - halfDepth - top), px(halfWidth * 2), px(halfDepth * 2));
  }
  return { canvas, left, top };
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

  if (overlay.labels) drawLabels(context, view, width, height, overlay.header);

  const me = at(overlay.player);
  context.beginPath();
  context.arc(me.x, me.y, overlay.labels ? 7 : 5, 0, Math.PI * 2);
  context.fillStyle = COLOURS.player;
  context.fill();
  context.lineWidth = 2.5;
  context.strokeStyle = "#ffffff";
  context.stroke();
}

function label(context: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, turned = false): void {
  context.save();
  context.translate(x, y);
  if (turned) context.rotate(-Math.PI / 2);
  context.font = `600 ${size}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 3;
  context.strokeStyle = COLOURS.halo;
  context.strokeText(text, 0, 0);
  context.fillStyle = COLOURS.text;
  context.fillText(text, 0, 0);
  context.restore();
}

/** Street names along their roads (kept on screen), then landmarks, then places. */
function drawLabels(
  context: CanvasRenderingContext2D,
  view: MapView,
  width: number,
  height: number,
  header: MapOverlay["header"],
): void {
  for (const road of header.roads) {
    if (!road.name) continue;
    const alongX = road.halfWidth >= road.halfDepth;
    // The name sits where the road crosses the middle of the screen, so it stays in view while panning.
    const along = alongX
      ? Math.min(road.x + road.halfWidth - 30, Math.max(road.x - road.halfWidth + 30, view.x))
      : Math.min(road.z + road.halfDepth - 30, Math.max(road.z - road.halfDepth + 30, view.z));
    const { x, y } = worldToScreen(view, width, height, alongX ? { x: along, z: road.z } : { x: road.x, z: along });
    label(context, road.name, x, y, 12, !alongX);
  }
  for (const landmark of header.landmarks) {
    const { x, y } = worldToScreen(view, width, height, landmark);
    label(context, landmark.name, x, y - 12, 13);
  }
  if (view.scale < 1.2) return; // place names only once zoomed in, where there is room
  for (const place of header.interactables) {
    const { x, y } = worldToScreen(view, width, height, place.position);
    label(context, place.label, x, y + 14, 11);
  }
}
