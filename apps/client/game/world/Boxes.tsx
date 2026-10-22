"use client";

import { useLayoutEffect, useRef } from "react";
import { Color, type InstancedMesh, Object3D } from "three";
import { WARM_UP_WHILE_HIDDEN } from "../ShaderWarmUp";

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
 * Any number of coloured boxes in a single draw call. Every box is the same
 * unit cube, stretched and coloured per copy with one InstancedMesh: the GPU
 * gets ONE draw call for all of them instead of one per box, which is what
 * keeps weak phone GPUs at a steady frame rate.
 *
 * `capacity` is the most boxes it will ever be given: as the player walks, the
 * world refills it with the boxes nearby, and a fixed capacity means that only
 * rewrites numbers, never rebuilds the mesh.
 */
export function Boxes({ slabs, capacity = slabs.length }: { slabs: readonly Slab[]; capacity?: number }) {
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const placer = new Object3D();
    const colour = new Color();
    const shown = Math.min(slabs.length, capacity);
    for (let index = 0; index < shown; index++) {
      const slab = slabs[index] as Slab;
      placer.position.set(slab.x, (slab.y ?? 0) + slab.height / 2, slab.z);
      placer.scale.set(slab.halfWidth * 2, slab.height, slab.halfDepth * 2);
      placer.updateMatrix();
      instanced.setMatrixAt(index, placer.matrix);
      instanced.setColorAt(index, colour.set(slab.colour));
    }
    instanced.count = shown;
    instanced.visible = shown > 0;
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    // Bounds are computed from the instances, so the whole group is not culled by mistake.
    instanced.computeBoundingSphere();
  }, [slabs, capacity]);

  if (capacity === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, capacity]}
      key={capacity}
      // Warmed up even while empty, so the first boxes to arrive never compile a shader mid-game.
      userData={{ [WARM_UP_WHILE_HIDDEN]: true }}
    >
      <boxGeometry />
      <meshLambertMaterial />
    </instancedMesh>
  );
}
