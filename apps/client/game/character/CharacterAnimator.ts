import { type AnimationAction, type AnimationClip, AnimationMixer, LoopOnce, type Object3D, Quaternion, Vector3 } from "three";
import {
  type CharacterMotion,
  type ClipId,
  RUN_BOUNCE,
  calmBounce,
  chooseClip,
  moveTimeScale,
  runStanceWeight,
} from "./animation";

/** How long one clip blends into the next. Short enough to feel responsive, long enough not to pop. */
const CROSSFADE_SECONDS = 0.2;

/**
 * The pack's clips stand with a hunch: the head leans 9° forward of the hips
 * when idle and 26° in the jog (the rest pose is 5°), which read as stooped
 * from the street camera (play-tested 2026-11-01). After each pose the middle
 * of the spine is tipped back this much, which brings standing to about 4°,
 * walking to 8° and the jog to 21° (measured on the pack's skeleton).
 * Seated poses are left alone: the okada riders sit right as they are.
 */
export const POSTURE_DEGREES = 8;
const POSTURE_BONE = "spine_02";
const SEATED: readonly ClipId[] = ["sit", "sit_talk"];

/** Reused every frame, so straightening allocates nothing. */
const ABOVE = new Quaternion();
const TURN = new Quaternion();
const CORRECTION = new Quaternion();
const SIDEWAYS = new Vector3(1, 0, 0);

/**
 * Tips `bone` back by `degrees` about the body's sideways axis (x in the
 * character's own space, which faces +z), whatever its parents' pose: the
 * turn is carried into the bone's own frame through the rotations above it.
 */
export function straighten(bone: Object3D, root: Object3D, degrees: number): void {
  ABOVE.identity();
  for (let parent = bone.parent; parent && parent !== root; parent = parent.parent) ABOVE.premultiply(parent.quaternion);
  TURN.setFromAxisAngle(SIDEWAYS, (-degrees * Math.PI) / 180);
  CORRECTION.copy(ABOVE).invert().multiply(TURN).multiply(ABOVE);
  bone.quaternion.premultiply(CORRECTION);
}

/**
 * Plays a character's animations. An AnimationMixer drives the skeleton from
 * clips; each frame this picks the clip for what the character is doing and
 * crossfades to it when that changes.
 */
export class CharacterAnimator {
  private readonly mixer: AnimationMixer;
  private readonly actions: Map<ClipId, AnimationAction>;
  private readonly gestureSeconds: number;
  /** A second copy of the idle clip, mixed in under the run to shorten its strides (`runStanceWeight`). */
  private readonly stance: AnimationAction | undefined;
  private current: ClipId | undefined;
  /** The spine bone straightened after each pose (`POSTURE_DEGREES`), if the skeleton has one. */
  private readonly spine: Object3D | undefined;

  constructor(
    private readonly root: Object3D,
    clips: readonly AnimationClip[],
  ) {
    this.spine = root.getObjectByName(POSTURE_BONE);
    this.mixer = new AnimationMixer(root);
    this.actions = new Map();
    for (const clip of clips) this.actions.set(clip.name as ClipId, this.mixer.clipAction(clip));
    // Its own copy, so it never fights the idle action's own crossfades.
    const idle = clips.find((clip) => clip.name === "idle");
    if (idle) {
      const copy = idle.clone();
      copy.name = "idle_under_run";
      this.stance = this.mixer.clipAction(copy);
      this.stance.setEffectiveWeight(0).play();
    }
    const gesture = this.actions.get("interact");
    if (gesture) {
      gesture.setLoop(LoopOnce, 1);
      gesture.clampWhenFinished = true;
    }
    this.gestureSeconds = gesture?.getClip().duration ?? 0;
  }

  /** `pose` holds one looping clip (a standing NPC) instead of choosing from the motion. */
  update(deltaSeconds: number, motion: CharacterMotion, now: number, pose?: ClipId): void {
    const next = pose ?? chooseClip(motion, now, this.gestureSeconds);
    const action = this.actions.get(next);
    if (next !== this.current && action) {
      const previous = this.current ? this.actions.get(this.current) : undefined;
      action.reset().play();
      if (previous) previous.crossFadeTo(action, CROSSFADE_SECONDS, false);
      this.current = next;
    }
    if ((next === "walk" || next === "run") && action) action.timeScale = moveTimeScale(next, motion.speed);
    // Follows the run's own fade in and out (a weight of 0 costs nothing: the mixer skips it).
    const run = this.actions.get("run");
    if (this.stance && run) this.stance.setEffectiveWeight(runStanceWeight(run.isRunning() ? run.getEffectiveWeight() : 0));
    this.mixer.update(deltaSeconds);
    // The mixer has just set the spine from the clip, so this never builds up over frames.
    if (this.spine && !SEATED.includes(next)) straighten(this.spine, this.root, POSTURE_DEGREES);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}

/**
 * The shared clips store the pelvis's movement as an offset from rest (see the
 * asset pipeline), because each body's hips sit at a different height. This
 * makes a copy of the clips with this body's own rest position added back, and
 * the run's hip bounce calmed (`RUN_BOUNCE`).
 */
export function clipsForBody(clips: readonly AnimationClip[], pelvisRest: Vector3): AnimationClip[] {
  return clips.map((clip) => {
    const copy = clip.clone();
    for (const track of copy.tracks) {
      if (track.name !== "pelvis.position") continue;
      const values = track.values;
      if (clip.name === "run") calmBounce(values, RUN_BOUNCE);
      for (let i = 0; i < values.length; i += 3) {
        values[i] = (values[i] ?? 0) + pelvisRest.x;
        values[i + 1] = (values[i + 1] ?? 0) + pelvisRest.y;
        values[i + 2] = (values[i + 2] ?? 0) + pelvisRest.z;
      }
    }
    return copy;
  });
}
