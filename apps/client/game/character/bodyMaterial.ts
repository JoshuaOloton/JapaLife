import { BODY_REGIONS, type BodyRegion, REGION_MASK_STEP } from "@japalife/shared";
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
}

/**
 * The body's material: the cheap Lambert lighting model (one light
 * calculation per vertex, no specular), plus a few lines of shader code that
 * look up each pixel's body region in the region mask and paint the outfit's
 * colour there instead of skin.
 */
export function createBodyMaterial(skin: Texture | null, regionMask: Texture, look: BodyLook): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ map: skin });
  const regionColours = BODY_REGIONS.map((region) => {
    const hex = look.outfit[region];
    if (!hex) return new Vector4(0, 0, 0, 0);
    // Color converts the sRGB hex into the linear space the shader lights in.
    const colour = new Color(hex);
    return new Vector4(colour.r, colour.g, colour.b, 1);
  });
  const skinTint = new Color(look.skinTint);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.regionMask = { value: regionMask };
    shader.uniforms.regionColours = { value: regionColours };
    shader.uniforms.skinTint = { value: skinTint };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D regionMask;
        uniform vec4 regionColours[${BODY_REGIONS.length}];
        uniform vec3 skinTint;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          int region = int(floor(texture2D(regionMask, vMapUv).r * 255.0 / ${REGION_MASK_STEP}.0 + 0.5));
          vec4 cloth = regionColours[clamp(region, 0, ${BODY_REGIONS.length - 1})];
          diffuseColor.rgb = mix(diffuseColor.rgb * skinTint, cloth.rgb, cloth.a);
        }`,
      );
  };
  // Every body shares one compiled shader; only the uniform values differ.
  material.customProgramCacheKey = () => "japalife-body";
  return material;
}

/** The look everyone has until the character creator exists (Slice 11d). */
export const DEFAULT_LOOK: BodyLook = {
  outfit: {
    torso: "#c8553d",
    upperArm: "#c8553d",
    hips: "#2f4a6d",
    thigh: "#2f4a6d",
    calf: "#2f4a6d",
    foot: "#262626",
  },
  skinTint: "#ffffff",
};

export const DEFAULT_HAIR_COLOUR = "#2a1f1a";
