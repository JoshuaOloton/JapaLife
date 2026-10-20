import { BufferAttribute, type BufferGeometry, Color, type MeshLambertMaterial } from "three";

/**
 * Lit windows on the imported building models. The pack models paint their
 * glass from one or two cells of a shared colour sheet, and the asset pipeline
 * records where (`windows` in the model catalog). Here every triangle painted
 * from glass is flagged, and a few lines added to the building's own Lambert
 * shader make flagged surfaces glow at night. No extra draw call, no download.
 */

/** A rectangle on a colour sheet, in texture coordinates: [u0, v0, u1, v1]. */
export type UvRect = readonly [number, number, number, number];

export const WINDOW_GLASS_ATTRIBUTE = "windowGlass";
/** The warm glow of a lit room seen from the street. */
export const WINDOW_GLOW_COLOUR = "#ffc66b";

/**
 * 1 for each vertex of a triangle painted from the given colour-sheet cells
 * (window glass, a van's body paint), else 0. Decided per triangle, from its
 * centre: compression rounds texture coordinates slightly, so a corner sitting
 * exactly on a cell's edge could land on either side.
 */
export function uvCellFlags(uvs: ArrayLike<number>, index: ArrayLike<number> | null, rects: readonly UvRect[]): Float32Array {
  const vertexCount = uvs.length / 2;
  const flags = new Float32Array(vertexCount);
  const triangleCount = (index ? index.length : vertexCount) / 3;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const corners = [0, 1, 2].map((corner) => (index ? (index[triangle * 3 + corner] ?? 0) : triangle * 3 + corner));
    let u = 0;
    let v = 0;
    for (const vertex of corners) {
      u += (uvs[vertex * 2] ?? 0) / 3;
      v += (uvs[vertex * 2 + 1] ?? 0) / 3;
    }
    if (!rects.some(([u0, v0, u1, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1)) continue;
    for (const vertex of corners) flags[vertex] = 1;
  }
  return flags;
}

/** Adds the flags for some colour-sheet cells to a model's geometry, once (the geometry is shared by every copy). */
export function flagUvCells(geometry: BufferGeometry, rects: readonly UvRect[], attribute: string): void {
  if (geometry.getAttribute(attribute)) return;
  const uv = geometry.getAttribute("uv");
  if (!uv) return;
  const flags = uvCellFlags(uv.array, geometry.getIndex()?.array ?? null, rects);
  geometry.setAttribute(attribute, new BufferAttribute(flags, 1));
}

/** Adds the glass flags to a building model's geometry. */
export function flagWindowGlass(geometry: BufferGeometry, rects: readonly UvRect[]): void {
  flagUvCells(geometry, rects, WINDOW_GLASS_ATTRIBUTE);
}

/** The handle a building keeps to turn its windows' glow up or down. */
export interface WindowGlow {
  /** Glow colour times strength; black is off. */
  readonly value: Color;
}

/**
 * Makes `material` glow where the geometry is flagged as glass, by `glow`.
 * Every building's material gets the same added code, so they share one
 * compiled shader.
 */
export function addWindowGlow(material: MeshLambertMaterial): WindowGlow {
  const glow: WindowGlow = { value: new Color(0, 0, 0) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms["windowGlow"] = glow;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute float ${WINDOW_GLASS_ATTRIBUTE};\nvarying float vWindowGlass;`,
      )
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvWindowGlass = ${WINDOW_GLASS_ATTRIBUTE};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 windowGlow;\nvarying float vWindowGlass;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += windowGlow * vWindowGlass;");
  };
  material.customProgramCacheKey = () => "window-glow";
  return glow;
}
