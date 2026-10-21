"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { type Material, Mesh, type Object3D, Texture } from "three";

/**
 * When to compile, in ms after the game appears. Models stream in over the
 * first seconds, so one pass would miss the late ones; each pass compiles only
 * what is new. The last falls inside the fps meter's 5 s warm-up.
 */
const PASSES_MS = [500, 1500, 3000, 4500] as const;

/** `userData` flag for a group that may be hidden at load (the street behind the creator) but must be warmed up. */
export const WARM_UP_WHILE_HIDDEN = "warmUpWhileHidden";

/**
 * Compiles every material in the scene, including buildings far out of view,
 * and uploads their textures, during the first seconds of play. Otherwise a shader compiles the first time
 * its object comes into view, and on a phone that freezes the game (11f-4: a
 * 2.8 s stall). `compileAsync` lets the browser compile in parallel where it
 * can (KHR_parallel_shader_compile) instead of blocking a frame.
 */
export function ShaderWarmUp() {
  const gl = useThree((three) => three.gl);
  const scene = useThree((three) => three.scene);
  const camera = useThree((three) => three.camera);

  useEffect(() => {
    const timers = PASSES_MS.map((delay) =>
      window.setTimeout(() => {
        // three.js compiles only visible objects, but the street is hidden while a new player is in
        // the creator. Show what is marked for it during the (synchronous) walk of the scene, then hide it again.
        const hidden: Object3D[] = [];
        scene.traverse((object) => {
          if (object.userData[WARM_UP_WHILE_HIDDEN] && !object.visible) hidden.push(object);
        });
        for (const object of hidden) object.visible = true;
        // A failed warm-up only means the shader compiles later, as before.
        gl.compileAsync(scene, camera).catch(() => undefined);
        for (const object of hidden) object.visible = false;
        // Textures upload the first time they are drawn too; the street's ~50 (signs, ground, models)
        // all at once when a new player leaves the creator. Upload them now (already uploaded ones are skipped).
        scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            // Any slot: map, alpha map, and the like.
            for (const value of Object.values(material as Material)) {
              if (value instanceof Texture) gl.initTexture(value);
            }
          }
        });
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [gl, scene, camera]);

  return null;
}
