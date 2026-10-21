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

/** The handle a building keeps to fade itself out while it hides the player: 0 solid, 1 gone. */
export interface BuildingFade {
  value: number;
}

/**
 * Two effects in a building's shader:
 *  - its glass glows where the geometry is flagged as glass, by `glow`;
 *  - it fades out by `fade` with a dither: a fixed 4x4 pattern of screen
 *    pixels is skipped, more of them the higher `fade`. Unlike real
 *    transparency this needs no second shader and no back-to-front sorting, so
 *    fading never compiles anything mid-game (a compile can freeze a phone for
 *    a second or more).
 * Every building's material gets the same added code, so they share one
 * compiled shader.
 */
export function addBuildingEffects(material: MeshLambertMaterial): { glow: WindowGlow; fade: BuildingFade } {
  const glow: WindowGlow = { value: new Color(0, 0, 0) };
  const fade: BuildingFade = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms["windowGlow"] = glow;
    shader.uniforms["buildingFade"] = fade;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute float ${WINDOW_GLASS_ATTRIBUTE};\nvarying float vWindowGlass;`,
      )
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvWindowGlass = ${WINDOW_GLASS_ATTRIBUTE};`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 windowGlow;
        uniform float buildingFade;
        varying float vWindowGlass;
        const float DITHER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if (buildingFade > 0.0) {
          ivec2 cell = ivec2(mod(gl_FragCoord.xy, 4.0));
          if ((DITHER[cell.x + cell.y * 4] + 0.5) / 16.0 < buildingFade) discard;
        }`,
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += windowGlow * vWindowGlass;");
  };
  material.customProgramCacheKey = () => "building";
  return { glow, fade };
}
