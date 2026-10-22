import { type Box, CHUNK_METRES, type Point, SpatialGrid } from "@japalife/shared";
import { useRef } from "react";

/**
 * What is drawn: only the part of the district around the player. A district
 * is bucketed into 64 m chunks once, and every few metres of walking the
 * world's instanced meshes are refilled from the chunks near the player. Each
 * kind of thing stays ONE draw call (what weak phones choke on), and things out
 * of sight cost the GPU nothing, however big the district grows.
 *
 * The camera sits south of the player looking north, and on a portrait phone
 * the top of the screen reaches almost to the horizon, so the areas reach far
 * ahead (north, -z) and only a little behind. The haze (`Lighting.tsx`) is
 * thick by the far edge, so nothing is seen popping in.
 */

/** The drawn things are refilled when the player crosses into another cell this size. */
export const AREA_CELL_METRES = 16;

/** How far an area reaches from the player, metres: ahead is north. */
export interface Reach {
  ahead: number;
  behind: number;
  side: number;
}

/** Everything drawn at all. Past this the haze has swallowed the street. */
export const DRAW_REACH: Reach = { ahead: 90, behind: 30, side: 75 };
/**
 * Buildings drawn as their full model; between this and `DRAW_REACH` they are
 * plain boxes (a level of detail, LOD: far away, in the haze, nobody can tell).
 */
export const MODEL_REACH: Reach = { ahead: 60, behind: 30, side: 50 };
/** Painted shop names and adverts: unreadable further off, and each one is a draw call. */
export const LABEL_REACH: Reach = { ahead: 40, behind: 20, side: 30 };
/**
 * Where traffic is simulated: wider than `DRAW_REACH`, so vehicles join and
 * leave at its edges where nobody can see. Past it there is no traffic at
 * all, however big the district.
 */
export const TRAFFIC_REACH: Reach = { ahead: 115, behind: 55, side: 100 };
/** Where walkers are simulated: past the 40 m they are drawn to every way, so they join and leave unseen. */
export const WALKER_REACH: Reach = { ahead: 55, behind: 50, side: 50 };

/**
 * How much of the usual traffic and people is out where `point` is: all of it
 * in a busy area (a market, a motor park), `calmShare` of it elsewhere.
 */
export function busyShare(busyAreas: readonly Box[], calmShare: number, point: Point): number {
  const busy = busyAreas.some((area) => Math.abs(point.x - area.x) <= area.halfWidth && Math.abs(point.z - area.z) <= area.halfDepth);
  return busy ? 1 : calmShare;
}

/** The centre of the area cell the player stands in; the drawn things change only when this does. */
export function areaCell(point: Point): Point {
  const centre = (value: number): number => (Math.floor(value / AREA_CELL_METRES) + 0.5) * AREA_CELL_METRES;
  return { x: centre(point.x), z: centre(point.z) };
}

/** The rectangle an area covers around `centre`. A cell's worth is added all round, since the player can be anywhere in the cell. */
export function areaBox(centre: Point, reach: Reach): Box {
  const margin = AREA_CELL_METRES / 2;
  const north = centre.z - reach.ahead - margin;
  const south = centre.z + reach.behind + margin;
  return { x: centre.x, z: (north + south) / 2, halfWidth: reach.side + margin, halfDepth: (south - north) / 2 };
}

const overlaps = (a: Box, b: Box): boolean =>
  Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth && Math.abs(a.z - b.z) < a.halfDepth + b.halfDepth;

/** Things bucketed into chunks, to pick out those in an area. Each thing is listed once, in the order given. */
export class ChunkIndex<T extends Box> {
  private readonly grid: SpatialGrid<T>;
  private readonly order: Map<T, number>;

  constructor(readonly all: readonly T[]) {
    this.grid = new SpatialGrid(all, CHUNK_METRES);
    this.order = new Map(all.map((item, index) => [item, index]));
  }

  /** The things overlapping `area`, in their original order (so a refill keeps the same look). */
  within(area: Box): T[] {
    return this.grid
      .near(area.x, area.z, area.halfWidth, area.halfDepth)
      .filter((item) => overlaps(item, area))
      .sort((a, b) => (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0));
  }
}

/** A point thing (a prop, a palm frond) as a box of no size, for the index. */
export function pointBox<T extends Point>(thing: T): T & Box {
  return { ...thing, halfWidth: 0, halfDepth: 0 };
}

/** The smallest room an instanced mesh is made with. */
const MIN_CAPACITY = 64;

/**
 * Room for `count` instances: the next power of two, but never less than
 * `current`. Chunks come and go as the player walks, so the count goes up and
 * down; growing in doubling steps and never shrinking rebuilds a mesh only a
 * handful of times a visit.
 */
export function roomFor(count: number, current = 0): number {
  if (current >= MIN_CAPACITY && count <= current) return current;
  let room = MIN_CAPACITY;
  while (room < count) room *= 2;
  return Math.max(room, current);
}

/** `roomFor` remembered across renders: an instanced mesh's capacity that only ever grows. */
export function useCapacity(count: number): number {
  const capacity = useRef(0);
  capacity.current = roomFor(count, capacity.current);
  return capacity.current;
}

/** Model buildings near enough for their model, and the ones further off that are drawn as boxes. */
export function splitByDetail<T extends Box>(buildings: ChunkIndex<T>, centre: Point): { models: T[]; boxes: T[] } {
  const models = buildings.within(areaBox(centre, MODEL_REACH));
  const near = new Set(models);
  return { models, boxes: buildings.within(areaBox(centre, DRAW_REACH)).filter((building) => !near.has(building)) };
}
