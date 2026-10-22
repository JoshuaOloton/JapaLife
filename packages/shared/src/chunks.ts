import type { Box, Point } from "./collision";
import type { Building, DistrictHeader, DistrictLayout, Prop } from "./content";

/**
 * Chunk streaming (area of interest): a district is cut into square chunks,
 * and a player is sent only the chunks around them, more as they walk. The
 * join message stays small however big the district grows, and a phone keeps
 * only the nearby part of the city in memory.
 *
 * A building or prop belongs to the chunk its centre stands in. Nothing may
 * reach further than a chunk from its centre (the content check refuses it),
 * so anything that reaches the player's position belongs to a chunk next to
 * theirs, which is always loaded: the client's collision is never missing a
 * wall it could touch. NPCs travel in the header instead (see
 * `districtHeaderSchema`).
 */

/** Side of a chunk, metres. */
export const CHUNK_METRES = 64;
/**
 * Chunks sent around the player's: 2 means a 5 x 5 square, at least 128 m
 * every way, enough for the 90 m the client draws ahead plus a building's width.
 */
export const CHUNK_SEND_RING = 2;
/** Chunks kept around the latest centre (by client and server alike); further ones are dropped. */
export const CHUNK_KEEP_RING = 3;
/** Other players this close are synced to a client (their area of interest). */
export const PLAYER_VIEW_METRES = 80;

export interface ChunkCoord {
  cx: number;
  cz: number;
}

/** What one chunk holds. */
export interface ChunkContent extends ChunkCoord {
  buildings: Building[];
  props: Prop[];
}

export function chunkOf(point: Point): ChunkCoord {
  return { cx: Math.floor(point.x / CHUNK_METRES), cz: Math.floor(point.z / CHUNK_METRES) };
}

export function chunkKey({ cx, cz }: ChunkCoord): string {
  return `${cx},${cz}`;
}

/** Whether `chunk` is within `ring` chunks of `centre` (a square, like the rings sent). */
export function withinRing(chunk: ChunkCoord, centre: ChunkCoord, ring: number): boolean {
  return Math.abs(chunk.cx - centre.cx) <= ring && Math.abs(chunk.cz - centre.cz) <= ring;
}

/** Every chunk within `ring` of `centre`, nearest first, so the player's own chunk arrives first. */
export function chunksAround(centre: ChunkCoord, ring: number): ChunkCoord[] {
  const around: ChunkCoord[] = [];
  for (let dz = -ring; dz <= ring; dz++) {
    for (let dx = -ring; dx <= ring; dx++) around.push({ cx: centre.cx + dx, cz: centre.cz + dz });
  }
  return around.sort(
    (a, b) =>
      Math.max(Math.abs(a.cx - centre.cx), Math.abs(a.cz - centre.cz)) -
      Math.max(Math.abs(b.cx - centre.cx), Math.abs(b.cz - centre.cz)),
  );
}

/** A thing's chunk, from its centre. */
function chunkKeyOf(thing: Point): string {
  return chunkKey(chunkOf(thing));
}

/**
 * Whether a prop lies on a road (only things you walk over may: speed bumps).
 * Road furniture travels with the roads in the district header, since the
 * traffic needs every bump from the start.
 */
export function isRoadProp(prop: Point, roads: readonly Box[]): boolean {
  return roads.some((road) => Math.abs(prop.x - road.x) <= road.halfWidth && Math.abs(prop.z - road.z) <= road.halfDepth);
}

const tenth = (value: number): number => Math.round(value * 10) / 10;

/** The join message for a district: its layout less what travels in chunks (see `districtHeaderSchema`). */
export function districtHeader(layout: DistrictLayout): DistrictHeader {
  const { buildings, props } = layout;
  const rest: Partial<DistrictLayout> = { ...layout };
  // These travel in chunks.
  delete rest.buildings;
  delete rest.props;
  const buildingModels: Record<string, number> = {};
  for (const building of buildings) {
    if (building.model && layout.models[building.model]) {
      buildingModels[building.model] = (buildingModels[building.model] ?? 0) + 1;
    }
  }
  return {
    ...(rest as Omit<DistrictLayout, "buildings" | "props">),
    roadProps: props.filter((prop) => isRoadProp(prop, layout.roads)),
    buildingModels,
    mapBuildings: buildings.flatMap((b) => [tenth(b.x), tenth(b.z), tenth(b.halfWidth), tenth(b.halfDepth)]),
  };
}

/** The district's buildings and props (but road furniture), sorted into chunks. Only chunks with something in them are listed. */
export function splitIntoChunks(layout: Pick<DistrictLayout, "buildings" | "props" | "roads">): Map<string, ChunkContent> {
  const chunks = new Map<string, ChunkContent>();
  const chunkFor = (thing: Point): ChunkContent => {
    const key = chunkKeyOf(thing);
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { ...chunkOf(thing), buildings: [], props: [] };
      chunks.set(key, chunk);
    }
    return chunk;
  };
  for (const building of layout.buildings) chunkFor(building).buildings.push(building);
  for (const prop of layout.props) if (!isRoadProp(prop, layout.roads)) chunkFor(prop).props.push(prop);
  return chunks;
}
