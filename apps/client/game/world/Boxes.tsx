"use client";

import { useLayoutEffect, useRef } from "react";
import { Color, type InstancedMesh, Object3D } from "three";

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
 */
export function Boxes({ slabs }: { slabs: readonly Slab[] }) {
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const placer = new Object3D();
    const colour = new Color();
    slabs.forEach((slab, index) => {
      placer.position.set(slab.x, (slab.y ?? 0) + slab.height / 2, slab.z);
      placer.scale.set(slab.halfWidth * 2, slab.height, slab.halfDepth * 2);
      placer.updateMatrix();
      instanced.setMatrixAt(index, placer.matrix);
      instanced.setColorAt(index, colour.set(slab.colour));
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    // Bounds are computed from the instances, so the whole group is not culled by mistake.
    instanced.computeBoundingSphere();
  }, [slabs]);

  if (slabs.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, slabs.length]} key={slabs.length}>
      <boxGeometry />
      <meshLambertMaterial />
    </instancedMesh>
  );
}
