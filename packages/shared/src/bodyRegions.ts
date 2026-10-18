/**
 * The parts of a character's body that clothing can cover. Outfits are painted
 * onto the body in the shader rather than modelled: the asset pipeline bakes a
 * "region mask" image that says, for every pixel of the body texture, which of
 * these regions it belongs to, and an outfit is a colour per region.
 *
 * The region of a pixel comes from the bone that moves that part of the mesh
 * most (its strongest skin weight), so the mask follows the skeleton and works
 * for any body built on the same rig.
 *
 * This file has no imports so the asset pipeline (plain Node) can load it.
 */
export const BODY_REGIONS = ["skin", "torso", "upperArm", "forearm", "hips", "thigh", "calf", "foot"] as const;

export type BodyRegion = (typeof BODY_REGIONS)[number];

/**
 * How a region index is stored in the mask's red channel: index * step. The gap
 * between values keeps neighbouring regions apart after 8-bit rounding.
 */
export const REGION_MASK_STEP = 16;

/** Bones by name prefix, first match wins. Anything unlisted (head, neck, hands, fingers) stays skin. */
const BONE_REGIONS: readonly (readonly [prefix: string, region: BodyRegion])[] = [
  ["spine_", "torso"],
  ["clavicle_", "torso"],
  ["upperarm_", "upperArm"],
  ["lowerarm_", "forearm"],
  ["pelvis", "hips"],
  ["thigh_", "thigh"],
  ["calf_", "calf"],
  ["foot_", "foot"],
  ["ball_", "foot"],
];

export function regionForBone(boneName: string): BodyRegion {
  for (const [prefix, region] of BONE_REGIONS) {
    if (boneName.startsWith(prefix)) return region;
  }
  return "skin";
}

export function regionIndex(region: BodyRegion): number {
  return BODY_REGIONS.indexOf(region);
}
