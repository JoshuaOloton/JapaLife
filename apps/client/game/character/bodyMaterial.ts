import { type AnkaraPrint, BODY_REGIONS, type BodyRegion, REGION_MASK_STEP } from "@japalife/shared";
import { Color, MeshLambertMaterial, type Texture, Vector4 } from "three";

/**
 * An outfit is a colour per body region. Regions left out show skin. Phase 1
 * clothes are painted on, so they hug the body: shirts, trousers, jerseys.
 * Loose garments (dresses, agbada) need modelled pieces later.
 */
export type Outfit = Partial<Record<BodyRegion, string>>;

export interface BodyLook {
  outfit: Outfit;
  /** Multiplies the skin texture, for skin tones. White leaves it as painted. */
  skinTint: string;
  /** An Ankara print on some of the outfit's regions (the ones the player coloured), or null. */
  print: { pattern: AnkaraPrint; regions: readonly BodyRegion[] } | null;
}

/**
 * How many times the print tile repeats across the body texture. The body's
 * texture coordinates are roughly even over its skin, so this sets the size of
 * the motifs on the cloth: a few centimetres, like real wax prints. The cut
 * edges of the texture's pieces show as seams, which are lost at street distance.
 */
const PRINT_REPEAT = 6;

/**
 * The body's material: the cheap Lambert lighting model (one light
 * calculation per vertex, no specular), plus a few lines of shader code that
 * look up each pixel's body region in the region mask and paint the outfit's
 * colour there instead of skin.
 */
export function createBodyMaterial(
  skin: Texture | null,
  regionMask: Texture,
  look: BodyLook,
  /** The tiling texture of `look.print`, or null when there is none. */
  printTexture: Texture | null,
): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ map: skin });
  const regionColours = BODY_REGIONS.map((region) => {
    const hex = look.outfit[region];
    if (!hex) return new Vector4(0, 0, 0, 0);
    // Color converts the sRGB hex into the linear space the shader lights in.
    const colour = new Color(hex);
    return new Vector4(colour.r, colour.g, colour.b, 1);
  });
  const regionPrinted = BODY_REGIONS.map((region) => (printTexture && look.print?.regions.includes(region) ? 1 : 0));
  const skinTint = new Color(look.skinTint);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.regionMask = { value: regionMask };
    shader.uniforms.regionColours = { value: regionColours };
    shader.uniforms.regionPrinted = { value: regionPrinted };
    // Unprinted bodies still bind a texture (the region mask), which the shader never reads for them.
    shader.uniforms.printMap = { value: printTexture ?? regionMask };
    shader.uniforms.skinTint = { value: skinTint };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D regionMask;
        uniform vec4 regionColours[${BODY_REGIONS.length}];
        uniform float regionPrinted[${BODY_REGIONS.length}];
        uniform sampler2D printMap;
        uniform vec3 skinTint;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          int region = clamp(int(floor(texture2D(regionMask, vMapUv).r * 255.0 / ${REGION_MASK_STEP}.0 + 0.5)), 0, ${BODY_REGIONS.length - 1});
          vec4 cloth = regionColours[region];
          vec3 fabric = mix(cloth.rgb, texture2D(printMap, vMapUv * ${PRINT_REPEAT}.0).rgb, regionPrinted[region]);
          diffuseColor.rgb = mix(diffuseColor.rgb * skinTint, fabric, cloth.a);
        }`,
      );
  };
  // Every body shares one compiled shader; only the uniform values differ.
  material.customProgramCacheKey = () => "japalife-body";
  return material;
}
