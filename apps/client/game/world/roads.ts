import type { Road } from "@japalife/shared";

/**
 * Every road as one flat mesh, so the whole street network is one draw call
 * whatever the district's size. The painted strip (`paintRoad`) runs across
 * each road's width (u, 0 to 1) and repeats along its length (v, one repeat
 * per road width), so wide and narrow roads keep the same grain.
 */

/** Roads sit a hair above the ground so the two never flicker (z-fighting); each road a hair above the last. */
export const ROAD_HEIGHT = 0.02;
export const ROAD_STACK = 0.004;

/** How high road number `index` lies. */
export function roadHeight(index: number): number {
  return ROAD_HEIGHT + index * ROAD_STACK;
}

export interface RoadSurface {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export function roadSurface(roads: readonly Road[]): RoadSurface {
  const positions = new Float32Array(roads.length * 4 * 3);
  const uvs = new Float32Array(roads.length * 4 * 2);
  const indices = new Uint32Array(roads.length * 6);
  roads.forEach((road, index) => {
    const alongX = road.halfWidth >= road.halfDepth;
    const across = (alongX ? road.halfDepth : road.halfWidth) * 2;
    const repeats = ((alongX ? road.halfWidth : road.halfDepth) * 2) / across;
    const y = roadHeight(index);
    const west = road.x - road.halfWidth;
    const east = road.x + road.halfWidth;
    const north = road.z - road.halfDepth;
    const south = road.z + road.halfDepth;
    // Corners: north-west, north-east, south-east, south-west.
    const corners = [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
    ] as const;
    // u runs across the road, v along it.
    const cornerUvs = alongX
      ? [[0, 0], [0, repeats], [1, repeats], [1, 0]]
      : [[0, repeats], [1, repeats], [1, 0], [0, 0]];
    corners.forEach(([x, z], corner) => {
      positions.set([x, y, z], (index * 4 + corner) * 3);
      uvs.set(cornerUvs[corner] as number[], (index * 4 + corner) * 2);
    });
    const first = index * 4;
    // Counter-clockwise seen from above, so the face points up.
    indices.set([first, first + 3, first + 2, first, first + 2, first + 1], index * 6);
  });
  return { positions, uvs, indices };
}
