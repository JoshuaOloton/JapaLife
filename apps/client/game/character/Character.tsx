"use client";

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { HairPattern } from "@japalife/shared";
import {
  type Bone,
  Color,
  DataTexture,
  type Material,
  Mesh,
  type MeshStandardMaterial,
  MeshLambertMaterial,
  NearestFilter,
  NoColorSpace,
  type Object3D,
  SRGBColorSpace,
  Skeleton,
  SkinnedMesh,
  type Texture,
  TextureLoader,
  type Vector3,
} from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { CharacterMotion, ClipId } from "./animation";
import type { CharacterLook } from "./appearance";
import { type BodyLook, createBodyMaterial } from "./bodyMaterial";
import { CharacterAnimator, clipsForBody } from "./CharacterAnimator";
import { HAIR_PATTERN_SIZE, hairPatternPixels } from "./hairPatterns";
import { ASSET_ROOT, withDecoders } from "./loaders";

const CHARACTER_ROOT = `${ASSET_ROOT}/characters`;
const ANIMATIONS_URL = `${CHARACTER_ROOT}/animations.glb`;

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
  look,
  motion,
  pose,
  paused,
}: {
  /** From `resolveLook`. Keep the object stable (memoise it): a new one rebuilds the character. */
  look: CharacterLook;
  motion: { current: CharacterMotion };
  pose?: ClipId | undefined;
  paused?: { current: boolean } | undefined;
}) {
  const gl = useThree((three) => three.gl);
  const { body, hairFile, hairColour, hairPattern, bodyLook } = look;
  // Bald loads no hair file at all.
  const urls = [`${CHARACTER_ROOT}/body-${body}.glb`, ANIMATIONS_URL, ...(hairFile ? [`${ASSET_ROOT}/${hairFile}`] : [])];
  const [bodyModel, animations, hairModel] = useLoader(GLTFLoader, urls, withDecoders(gl));
  if (!bodyModel || !animations) throw new Error("expected the body and animations to load");
  const regionMask = useLoader(TextureLoader, `${CHARACTER_ROOT}/body-${body}-regions.png`);

  const person = useMemo(
    () => assemble(bodyModel, hairModel, prepareMask(regionMask), bodyLook, hairColour, hairPattern),
    [bodyModel, hairModel, regionMask, bodyLook, hairColour, hairPattern],
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

function assemble(
  bodyModel: GLTF,
  hairModel: GLTF | undefined,
  regionMask: Texture,
  look: BodyLook,
  hairHex: string,
  hairPattern: HairPattern | null,
): Person {
  const root = cloneSkinned(bodyModel.scene);
  const materials: Material[] = [];
  const hairColour = new Color(hairHex);
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
  const hairSource = hairModel?.scene.getObjectByProperty("type", "SkinnedMesh");
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
  } else if (hairPattern && hairModel) {
    attachHairCap(hairModel, bodyMesh, hairPattern, hairColour, materials);
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

/** The bone the scalp cap rides on. */
const HEAD_BONE = "Head";

/**
 * Puts the scalp cap on, painted with its pattern (cornrows, fade). The cap is a
 * plain mesh in the body's bind-pose space; parenting it to the Head bone with
 * the bone's inverse bind matrix moves it exactly as the body's own head
 * vertices are skinned, so it never slides off when the head turns.
 */
function attachHairCap(
  hairModel: GLTF,
  bodyMesh: SkinnedMesh,
  pattern: HairPattern,
  colour: Color,
  materials: Material[],
): void {
  const source = hairModel.scene.getObjectByProperty("type", "Mesh");
  const headIndex = bodyMesh.skeleton.bones.findIndex((bone) => bone.name === HEAD_BONE);
  const head = bodyMesh.skeleton.bones[headIndex];
  const headInverse = bodyMesh.skeleton.boneInverses[headIndex];
  if (!(source instanceof Mesh) || !head || !headInverse) return;

  hairModel.scene.updateMatrixWorld(true);
  const material = new MeshLambertMaterial({ map: patternTexture(pattern), color: colour, alphaTest: 0.5 });
  materials.push(material);
  const cap = new Mesh(source.geometry, material);
  cap.matrixAutoUpdate = false;
  cap.matrix.copy(headInverse).multiply(bodyMesh.bindMatrix).multiply(source.matrixWorld);
  head.add(cap);
}

/** One texture per pattern, made once and shared by everyone wearing it. */
const patternTextures = new Map<HairPattern, DataTexture>();

function patternTexture(pattern: HairPattern): DataTexture {
  let texture = patternTextures.get(pattern);
  if (!texture) {
    texture = new DataTexture(hairPatternPixels(pattern), HAIR_PATTERN_SIZE, HAIR_PATTERN_SIZE);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    patternTextures.set(pattern, texture);
  }
  return texture;
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
