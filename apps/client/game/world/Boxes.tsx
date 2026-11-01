"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from "three";
import { WARM_UP_WHILE_HIDDEN } from "../ShaderWarmUp";
import { INSTANCE_FADE_ATTRIBUTE, addDitherFade } from "./windowGlass";

/** A coloured box standing on the ground (or at `y`), centred on (x, z). */
export interface Slab {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  height: number;
  colour: string;
  /** Height of the box's bottom. Defaults to the ground. */
  y?: number;
}

/**
 * How far each of some buildings is faded out while it hides the player
 * (occlusion fading), kept up to date every frame by `useOcclusionFade`.
 * `version` goes up whenever any amount changes, so each mesh that shows
 * them copies only then.
 */
export interface FadeSet {
  amounts: Float32Array;
  version: number;
}

/** Which slabs belong to a fading building: `owners[slab]` is its index in `set`, or -1. */
export interface SlabFades {
  set: FadeSet;
  owners: Int32Array;
}

/**
 * Any number of coloured boxes in a single draw call. Every box is the same
 * unit cube, stretched and coloured per copy with one InstancedMesh: the GPU
 * gets ONE draw call for all of them instead of one per box, which is what
 * keeps weak phone GPUs at a steady frame rate.
 *
 * `capacity` is the most boxes it will ever be given: as the player walks, the
 * world refills it with the boxes nearby, and a fixed capacity means that only
 * rewrites numbers, never rebuilds the mesh.
 *
 * Each copy can fade out with a dither (`fades`: a plain building's walls and
 * roof while it hides the player). The dither is in the shader from the
 * start, so a fade only changes numbers, never compiles anything.
 */
export function Boxes({
  slabs,
  capacity = slabs.length,
  fades,
}: {
  slabs: readonly Slab[];
  capacity?: number;
  fades?: SlabFades | undefined;
}) {
  const mesh = useMemo(() => {
    const geometry = new BoxGeometry();
    const fade = new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity)), 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute(INSTANCE_FADE_ATTRIBUTE, fade);
    const material = new MeshLambertMaterial();
    addDitherFade(material, "boxes-dither");
    const instanced = new InstancedMesh(geometry, material, Math.max(1, capacity));
    instanced.count = 0;
    instanced.visible = false;
    // Warmed up even while empty, so the first boxes to arrive never compile a shader mid-game.
    instanced.userData[WARM_UP_WHILE_HIDDEN] = true;
    return instanced;
  }, [capacity]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
    },
    [mesh],
  );

  // The fade version last copied onto the slabs.
  const seen = useRef(-1);
  useLayoutEffect(() => {
    const placer = new Object3D();
    const colour = new Color();
    const shown = Math.min(slabs.length, capacity);
    for (let index = 0; index < shown; index++) {
      const slab = slabs[index] as Slab;
      placer.position.set(slab.x, (slab.y ?? 0) + slab.height / 2, slab.z);
      placer.scale.set(slab.halfWidth * 2, slab.height, slab.halfDepth * 2);
      placer.updateMatrix();
      mesh.setMatrixAt(index, placer.matrix);
      mesh.setColorAt(index, colour.set(slab.colour));
    }
    mesh.count = shown;
    mesh.visible = shown > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Bounds are computed from the instances, so the whole group is not culled by mistake.
    mesh.computeBoundingSphere();
    seen.current = -1; // the slabs moved: copy the fades again
  }, [mesh, slabs, capacity]);

  // Copy the buildings' fades onto their slabs, only when they changed.
  useFrame(() => {
    if (!fades || fades.set.version === seen.current) return;
    seen.current = fades.set.version;
    const attribute = mesh.geometry.getAttribute(INSTANCE_FADE_ATTRIBUTE) as InstancedBufferAttribute;
    const values = attribute.array as Float32Array;
    const count = Math.min(fades.owners.length, values.length);
    for (let index = 0; index < count; index++) {
      const owner = fades.owners[index] as number;
      values[index] = owner < 0 ? 0 : (fades.set.amounts[owner] ?? 0);
    }
    attribute.needsUpdate = true;
  });

  if (capacity === 0) return null;
  return <primitive object={mesh} />;
}
