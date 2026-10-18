import { RUN_LOOK_FROM_SPEED } from "../gait";
import clipInfo from "./clipInfo.generated.json";

/**
 * Which animation a character plays, decided from what it is doing. Pure, so
 * it is unit-tested; `CharacterAnimator` turns the choice into crossfades.
 * Animation is presentation only: position and shifts are the server's.
 */
export const CLIP_IDS = ["idle", "walk", "run", "interact", "work_phone"] as const;
export type ClipId = (typeof CLIP_IDS)[number];

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
 * How much faster than an exact ground match each gait plays. An exact match
 * means the feet never slide, but it is not always what looks natural:
 *
 * - run: matched exactly, the clip is slowed to 0.75x and spends too long with
 *   both feet in the air, so it looks like hopping (play-tested 2026-10-18).
 *   Quicker steps read as a normal run.
 * - walk: the clip was recorded as a slow stroll (about 1 m/s); matching our
 *   brisker pace exactly makes the steps hurried, so it takes longer strides
 *   instead.
 *
 * The small foot slide either way is invisible from the game camera.
 */
export const CADENCE = { walk: 0.8, run: 1.3 } as const;

/**
 * Playback rate for a movement clip at the character's speed. Each clip's
 * natural speed is measured by the asset pipeline, so the rate follows how fast
 * the character really moves (slower along a wall, for example).
 */
export function moveTimeScale(gait: "walk" | "run", speed: number): number {
  return (speed / clipInfo[gait].metresPerSecond) * CADENCE[gait];
}
