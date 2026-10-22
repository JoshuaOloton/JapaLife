import type { Object3D } from "three";

const SKIPPING = Symbol("skipWhileHidden");

/**
 * Every frame three.js recomputes the world matrix of every object in the
 * scene, hidden or not, and a person is 60-odd bones. With 50 NPCs and
 * walkers mounted (most out of range and hidden), that was most of the
 * frame's matrix work. This makes a hidden object skip its whole subtree;
 * the frame it is shown again, its matrices are brought up to date first.
 * Safe to call more than once on the same object.
 */
export function skipWhileHidden(object: Object3D & { [SKIPPING]?: true }): void {
  if (object[SKIPPING]) return;
  object[SKIPPING] = true;
  const update = object.updateMatrixWorld.bind(object);
  object.updateMatrixWorld = (force?: boolean) => {
    if (object.visible) update(force);
    // Hidden: the next update after showing it again must reach every bone.
    else object.matrixWorldNeedsUpdate = true;
  };
}
