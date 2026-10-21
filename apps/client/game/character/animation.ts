import { NPC_POSES } from "@japalife/shared";
import { RUN_LOOK_FROM_SPEED } from "../gait";
import clipInfo from "./clipInfo.generated.json";

/**
 * Which animation a character plays, decided from what it is doing. Pure, so
 * it is unit-tested; `CharacterAnimator` turns the choice into crossfades.
 * Animation is presentation only: position and shifts are the server's.
 */
export const CLIP_IDS = [
  "idle",
  "walk",
  "run",
  "interact",
  "work_phone",
  // Poses held by people who stay in one spot (`NPC_POSES` in packages/shared).
  "talk",
  "sit",
  "sit_talk",
  "fold_arms",
  "call",
] as const;
export type ClipId = (typeof CLIP_IDS)[number];

/** Every NPC pose must be a clip the asset pipeline builds; this fails typecheck if one is missing. */
const POSES_ARE_CLIPS: readonly ClipId[] = NPC_POSES;
void POSES_ARE_CLIPS;

export interface CharacterMotion {
  /** Ground speed this frame in metres (world units) per second. */
  speed: number;
  /** On a shift and standing at that job's site. */
  working: boolean;
  /** `performance.now()` when the player last used a place, for a short gesture. */
  gestureAt: number;
}

/** Below this the character is standing: sliding along a wall at a crawl should not look like walking. */
export const MOVING_SPEED = 0.3;

export function chooseClip(motion: CharacterMotion, now: number, gestureSeconds: number): ClipId {
  if (motion.speed > MOVING_SPEED) return motion.speed >= RUN_LOOK_FROM_SPEED ? "run" : "walk";
  if ((now - motion.gestureAt) / 1000 < gestureSeconds) return "interact";
  if (motion.working) return "work_phone";
  return "idle";
}

/**
 * How much of the standing (idle) pose is mixed into the run. The pack's jog
 * is recorded at 5.4 m/s, faster than our 4 m/s, so its strides are long and
 * its arms swing wide: matched to our speed it looked like hopping
 * (play-tested 2026-10-18), and sped up it still looked like the legs went too
 * far apart (2026-10-21). Mixing in the idle pose pulls every joint part of
 * the way back toward standing: shorter strides, smaller arm swing, at the
 * clip's own tempo. This is ordinary animation blending (two clips at once,
 * weighted), done by `CharacterAnimator`.
 */
export const RUN_STANCE_MIX = 0.25;

/** How long a step is compared with the clip as recorded. */
const STRIDE = { walk: 1, run: 1 - RUN_STANCE_MIX } as const;

/**
 * How much faster than an exact ground match each gait plays. An exact match
 * means the feet never slide, but it is not always what looks natural:
 *
 * - run: quicker than an exact match. With the shortened stride an exact match
 *   is the clip's own tempo, which still looked like a little hop on the phone
 *   (2026-10-21): the feet hang in the air too long. Quicker, lighter steps read
 *   as a swift run; the slight foot slide is invisible from the game camera.
 * - walk: the clip was recorded as a slow stroll (about 1 m/s); matching our
 *   brisker pace exactly makes the steps hurried, so it takes longer strides
 *   instead. The small foot slide is invisible from the game camera.
 */
export const CADENCE = { walk: 0.8, run: 1.25 } as const;

/**
 * How much of the run clip's up-and-down hip bounce is kept, around its average
 * height. The recorded jog bounces a lot each step, which reads as hopping.
 */
export const RUN_BOUNCE = 0.5;

/**
 * Scales the up-and-down part of a position track (x, y, z per key) around its
 * average height, leaving the average posture and the sideways sway alone. Edits `values`.
 */
export function calmBounce(values: Float32Array | number[], keep: number): void {
  let sum = 0;
  const keys = values.length / 3;
  for (let key = 0; key < keys; key++) sum += values[key * 3 + 1] ?? 0;
  const average = sum / keys;
  for (let key = 0; key < keys; key++) {
    const at = key * 3 + 1;
    values[at] = average + ((values[at] ?? average) - average) * keep;
  }
}

/**
 * Playback rate for a movement clip at the character's speed. Each clip's
 * natural speed is measured by the asset pipeline, so the rate follows how fast
 * the character really moves (slower along a wall, for example).
 */
export function moveTimeScale(gait: "walk" | "run", speed: number): number {
  return (speed / (clipInfo[gait].metresPerSecond * STRIDE[gait])) * CADENCE[gait];
}

/**
 * The idle pose's weight under the run, for a run at `runWeight` (which
 * crossfades from 0 to 1). three.js averages the weights of clips playing
 * together, so idle at a third of the run's weight is a quarter of the pose.
 * It must be the idle clip, not a lower run weight: a total under 1 is filled
 * from the skeleton's rest pose, a T-pose with the arms out.
 */
export function runStanceWeight(runWeight: number): number {
  return (runWeight * RUN_STANCE_MIX) / (1 - RUN_STANCE_MIX);
}
