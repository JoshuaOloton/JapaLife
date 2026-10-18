import { type AnimationAction, type AnimationClip, AnimationMixer, LoopOnce, type Object3D, type Vector3 } from "three";
import { type CharacterMotion, type ClipId, chooseClip, moveTimeScale } from "./animation";

/** How long one clip blends into the next. Short enough to feel responsive, long enough not to pop. */
const CROSSFADE_SECONDS = 0.2;

/**
 * Plays a character's animations. An AnimationMixer drives the skeleton from
 * clips; each frame this picks the clip for what the character is doing and
 * crossfades to it when that changes.
 */
export class CharacterAnimator {
  private readonly mixer: AnimationMixer;
  private readonly actions: Map<ClipId, AnimationAction>;
  private readonly gestureSeconds: number;
  private current: ClipId | undefined;

  constructor(
    private readonly root: Object3D,
    clips: readonly AnimationClip[],
  ) {
    this.mixer = new AnimationMixer(root);
    this.actions = new Map();
    for (const clip of clips) this.actions.set(clip.name as ClipId, this.mixer.clipAction(clip));
    const gesture = this.actions.get("interact");
    if (gesture) {
      gesture.setLoop(LoopOnce, 1);
      gesture.clampWhenFinished = true;
    }
    this.gestureSeconds = gesture?.getClip().duration ?? 0;
  }

  update(deltaSeconds: number, motion: CharacterMotion, now: number): void {
    const next = chooseClip(motion, now, this.gestureSeconds);
    const action = this.actions.get(next);
    if (next !== this.current && action) {
      const previous = this.current ? this.actions.get(this.current) : undefined;
      action.reset().play();
      if (previous) previous.crossFadeTo(action, CROSSFADE_SECONDS, false);
      this.current = next;
    }
    if ((next === "walk" || next === "run") && action) action.timeScale = moveTimeScale(next, motion.speed);
    this.mixer.update(deltaSeconds);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}

/**
 * The shared clips store the pelvis's movement as an offset from rest (see the
 * asset pipeline), because each body's hips sit at a different height. This
 * makes a copy of the clips with this body's own rest position added back.
 */
export function clipsForBody(clips: readonly AnimationClip[], pelvisRest: Vector3): AnimationClip[] {
  return clips.map((clip) => {
    const copy = clip.clone();
    for (const track of copy.tracks) {
      if (track.name !== "pelvis.position") continue;
      const values = track.values;
      for (let i = 0; i < values.length; i += 3) {
        values[i] = (values[i] ?? 0) + pelvisRest.x;
        values[i + 1] = (values[i + 1] ?? 0) + pelvisRest.y;
        values[i + 2] = (values[i + 2] ?? 0) + pelvisRest.z;
      }
    }
    return copy;
  });
}
