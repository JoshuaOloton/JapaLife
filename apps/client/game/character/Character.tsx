"use client";

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  type Bone,
  Color,
  type Material,
  type MeshStandardMaterial,
  MeshLambertMaterial,
  NearestFilter,
  NoColorSpace,
  type Object3D,
  Skeleton,
  SkinnedMesh,
  type Texture,
  TextureLoader,
  type Vector3,
} from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CharacterMotion, ClipId } from "./animation";
import { type BodyLook, DEFAULT_HAIR_COLOUR, DEFAULT_LOOK, createBodyMaterial } from "./bodyMaterial";
import { CharacterAnimator, clipsForBody } from "./CharacterAnimator";
import { ASSET_ROOT, withDecoders } from "./loaders";

export type BodyType = "male" | "female";

const CHARACTER_ROOT = `${ASSET_ROOT}/characters`;
const ANIMATIONS_URL = `${CHARACTER_ROOT}/animations.glb`;
const DEFAULT_HAIR: Record<BodyType, string> = { male: "buzzed", female: "buzzed-female" };

/** Same cap as the player: one long frame (a phone waking up) should not jump the animation. */
const MAX_FRAME_SECONDS = 0.25;

/**
 * The free base bodies are superhero-built. Scaling a few bones at load time
 * gives everyday Lagos proportions: a slimmer chest and arms. A bone's length
 * runs along its own Y axis, so scaling X and Z makes it thinner without
 * making it shorter. Children inherit a parent's scale, so the head and hands
 * get the inverse to stay their normal size.
 */
const BODY_SHAPE: Record<string, readonly [number, number, number]> = {
  spine_03: [0.9, 1, 0.92],
  neck_01: [1 / 0.9, 1, 1 / 0.92],
  upperarm_l: [0.86, 1, 0.86],
  upperarm_r: [0.86, 1, 0.86],
  hand_l: [1 / 0.86, 1, 1 / 0.86],
  hand_r: [1 / 0.86, 1, 1 / 0.86],
  thigh_l: [0.92, 1, 0.92],
  thigh_r: [0.92, 1, 0.92],
  foot_l: [1 / 0.92, 1, 1 / 0.92],
  foot_r: [1 / 0.92, 1, 1 / 0.92],
};

/**
 * A rigged, animated person. The body, hair and clips download once and are
 * shared; each Character clones the body so many people can be on screen.
 * Suspends while downloading: wrap it in <Suspense> with a stand-in.
 *
 * A `pose` holds one looping clip (a standing NPC) instead of following the
 * motion. While `paused` is true the animation does not update at all, which
 * is how far-away NPCs cost nothing per frame.
 */
export function Character({
  body,
  motion,
  look = DEFAULT_LOOK,
  pose,
  paused,
}: {
  body: BodyType;
  motion: { current: CharacterMotion };
  look?: BodyLook;
  pose?: ClipId | undefined;
  paused?: { current: boolean } | undefined;
}) {
  const gl = useThree((three) => three.gl);
  const [bodyModel, hairModel, animations] = threeOf(
    useLoader(
      GLTFLoader,
      [`${CHARACTER_ROOT}/body-${body}.glb`, `${CHARACTER_ROOT}/hair-${DEFAULT_HAIR[body]}.glb`, ANIMATIONS_URL],
      withDecoders(gl),
    ),
  );
  const regionMask = useLoader(TextureLoader, `${CHARACTER_ROOT}/body-${body}-regions.png`);

  const person = useMemo(
    () => assemble(bodyModel, hairModel, prepareMask(regionMask), look),
    [bodyModel, hairModel, regionMask, look],
  );
  useEffect(() => () => person.dispose(), [person]);

  // Created and freed by the same effect, so React's double mount in development cannot reuse a freed mixer.
  const animator = useRef<CharacterAnimator | null>(null);
  useEffect(() => {
    const created = new CharacterAnimator(person.root, clipsForBody(animations.animations, person.pelvisRest));
    animator.current = created;
    return () => {
      created.dispose();
      animator.current = null;
    };
  }, [person, animations]);

  // A paused character still gets one update, so it freezes in its pose rather than the bind pose.
  const posed = useRef(false);
  useFrame((_, frameSeconds) => {
    if (paused?.current && posed.current) return;
    posed.current = animator.current !== null;
    animator.current?.update(Math.min(frameSeconds, MAX_FRAME_SECONDS), motion.current, performance.now(), pose);
  });

  return <primitive object={person.root} />;
}

interface Person {
  root: Object3D;
  pelvisRest: Vector3;
  dispose: () => void;
}

function assemble(bodyModel: GLTF, hairModel: GLTF, regionMask: Texture, look: BodyLook): Person {
  const root = cloneSkinned(bodyModel.scene);
  const materials: Material[] = [];
  const hairColour = new Color(DEFAULT_HAIR_COLOUR);
  let bodyMesh: SkinnedMesh | undefined;

  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    const original = object.material as MeshStandardMaterial;
    const isBody = original.name.startsWith("MI_Superhero");
    const material = isBody
      ? createBodyMaterial(original.map, regionMask, look)
      : new MeshLambertMaterial({
          map: original.map,
          // Eyebrows share the hair colour.
          color: original.name.startsWith("MI_Hair") ? hairColour : 0xffffff,
        });
    object.material = material;
    materials.push(material);
    if (isBody) bodyMesh = object;
  });
  if (!bodyMesh?.parent) throw new Error("character model has no body mesh");

  // Hair is skinned to its own copy of the same skeleton; re-attach it to this body's bones by name.
  const hairSource = hairModel.scene.getObjectByProperty("type", "SkinnedMesh");
  if (hairSource instanceof SkinnedMesh) {
    const hair = hairSource.clone();
    const bones = hairSource.skeleton.bones.map((bone) => root.getObjectByName(bone.name) as Bone);
    hair.bind(new Skeleton(bones, hairSource.skeleton.boneInverses), hairSource.bindMatrix);
    const hairMaterial = new MeshLambertMaterial({
      map: (hairSource.material as MeshStandardMaterial).map,
      color: hairColour,
    });
    hair.material = hairMaterial;
    materials.push(hairMaterial);
    bodyMesh.parent.add(hair);
  }

  for (const [boneName, [x, y, z]] of Object.entries(BODY_SHAPE)) {
    root.getObjectByName(boneName)?.scale.set(x, y, z);
  }

  const pelvis = root.getObjectByName("pelvis");
  if (!pelvis) throw new Error("character model has no pelvis bone");
  return {
    root,
    pelvisRest: pelvis.position.clone(),
    // Geometry and textures belong to the shared download; only the materials are this person's.
    dispose: () => {
      for (const material of materials) material.dispose();
    },
  };
}

/** Three URLs in, three results out, in order; the loader's type only says "an array". */
function threeOf<T>(items: readonly T[]): [T, T, T] {
  const [a, b, c] = items;
  if (a === undefined || b === undefined || c === undefined) throw new Error("expected three loaded models");
  return [a, b, c];
}

/**
 * The region mask holds ids, not colours: no colour conversion, no blending
 * between neighbouring pixels (that would invent regions), and glTF's
 * top-left texture origin.
 */
function prepareMask(texture: Texture): Texture {
  if (texture.magFilter !== NearestFilter) {
    texture.flipY = false;
    texture.colorSpace = NoColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
  }
  return texture;
}
