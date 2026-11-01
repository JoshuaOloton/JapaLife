import { Euler, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { straighten } from "./CharacterAnimator";

/** The bone's rotation in the root's space. */
function inRoot(bone: Object3D, root: Object3D): Quaternion {
  const rotation = new Quaternion();
  for (let node: Object3D | null = bone; node && node !== root; node = node.parent) rotation.premultiply(node.quaternion);
  return rotation;
}

describe("straighten", () => {
  it("tips the bone back about the body's sideways axis, however the bones above it are turned", () => {
    // A root, an armature turned the way glTF exports turn them, a pelvis mid-stride, then the spine.
    const root = new Object3D();
    const armature = new Object3D();
    armature.quaternion.setFromEuler(new Euler(-Math.PI / 2, 0, 0));
    const pelvis = new Object3D();
    pelvis.quaternion.setFromEuler(new Euler(0.3, 1.1, -0.4));
    const spine = new Object3D();
    spine.quaternion.setFromEuler(new Euler(0.2, -0.1, 0.5));
    root.add(armature);
    armature.add(pelvis);
    pelvis.add(spine);

    const before = inRoot(spine, root);
    straighten(spine, root, 8);
    const after = inRoot(spine, root);

    const expected = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (-8 * Math.PI) / 180).multiply(before);
    expect(after.angleTo(expected)).toBeLessThan(1e-6);
  });

  it("moves something above the bone backwards (toward -z), the body facing +z", () => {
    const root = new Object3D();
    const spine = new Object3D();
    const head = new Object3D();
    head.position.set(0, 1, 0);
    root.add(spine);
    spine.add(head);
    straighten(spine, root, 8);
    root.updateMatrixWorld(true);
    const at = new Vector3().setFromMatrixPosition(head.matrixWorld);
    expect(at.z).toBeLessThan(0);
    expect(at.y).toBeCloseTo(Math.cos((8 * Math.PI) / 180), 9);
  });
});
