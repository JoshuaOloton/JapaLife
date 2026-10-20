/**
 * Skinning for a skirt: how much each of its vertices follows the hips and
 * each thigh. "Skinning" is how a model bends with its skeleton: every vertex
 * moves with a weighted mix of a few bones. A skirt is worked out in code
 * rather than in Blender, so it binds straight to the body's own skeleton.
 *
 * The waistband moves with the hips only. Lower down the skirt follows the legs
 * more and more, up to `LEG_FOLLOW` at the knee, so the hem swings with a step
 * but never as far as the leg (it is cloth, not trousers). Across the skirt, a
 * vertex follows the thigh it is nearer, and the front and back middle follow
 * both equally, so the cloth between the legs stretches rather than tears.
 * Pure, so it is unit-tested.
 */

export interface Point {
  x: number;
  y: number;
  z: number;
}

/** Where the joints are, in the same space as the skirt's vertices (the body's bind pose, +y up). */
export interface SkirtJoints {
  pelvis: Point;
  thighLeft: Point;
  thighRight: Point;
  /** Height of the knees. */
  knee: number;
}

/** Index of each bone in the body's skeleton. */
export interface SkirtBones {
  pelvis: number;
  thighLeft: number;
  thighRight: number;
}

/** How much of the leg's swing the hem follows at the knee and below. */
const LEG_FOLLOW = 0.8;

/** Four bone indices and four weights per vertex, as three.js's skinIndex and skinWeight attributes hold them. */
export function skirtWeights(
  positions: ArrayLike<number>,
  joints: SkirtJoints,
  bones: SkirtBones,
): { indices: Uint16Array; weights: Float32Array } {
  const count = positions.length / 3;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  const drop = joints.pelvis.y - joints.knee;
  const spread = joints.thighLeft.x - joints.thighRight.x;
  for (let vertex = 0; vertex < count; vertex++) {
    const x = positions[vertex * 3] ?? 0;
    const y = positions[vertex * 3 + 1] ?? 0;
    const down = clamp01((joints.pelvis.y - y) / drop);
    const towardLeft = clamp01((x - joints.thighRight.x) / spread);
    const legs = LEG_FOLLOW * down;
    const at = vertex * 4;
    indices[at] = bones.pelvis;
    indices[at + 1] = bones.thighLeft;
    indices[at + 2] = bones.thighRight;
    weights[at] = 1 - legs;
    weights[at + 1] = legs * towardLeft;
    weights[at + 2] = legs * (1 - towardLeft);
  }
  return { indices, weights };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
