import type { Point } from "@japalife/shared";
import { RUN_PUSH, WALK_FRACTION } from "./gait";
import type { RouteEnd, RouteFollower } from "./route";

/**
 * The direction the player is asking to move, on the ground plane. The camera
 * always looks north (toward -z), so "up" on the screen is -z. Its length is
 * the share of top speed: walking is a short direction, running a full one
 * (see gait.ts).
 *
 * Kept outside React on purpose: it changes every frame while a key or the
 * joystick is held, and a React state update per frame would re-render the tree.
 */
export class MoveInput {
  private readonly keys = new Set<string>();
  private joystick: Point = { x: 0, z: 0 };
  private autopilot: { follower: RouteFollower; onEnd: (end: RouteEnd) => void } | null = null;

  /** Walks a route by itself ("walk there") until it arrives, gets stuck, or the player takes over. */
  setAutopilot(follower: RouteFollower, onEnd: (end: RouteEnd) => void): void {
    this.autopilot = { follower, onEnd };
  }

  /** Stops walking a route, without telling anyone (the caller asked). */
  clearAutopilot(): void {
    this.autopilot = null;
  }

  get walkingRoute(): boolean {
    return this.autopilot !== null;
  }

  setJoystick(direction: Point): void {
    this.joystick = direction;
  }

  /** Releases everything, e.g. when the tab loses focus and key-up events would be missed. */
  clear(): void {
    this.keys.clear();
    this.joystick = { x: 0, z: 0 };
  }

  /**
   * Current direction, never longer than 1. The joystick wins over keys when
   * both are used, and either takes over from a route being walked. `position`
   * (where the player is) and `now` (ms) are needed only while walking a route.
   */
  direction(position?: Point, now = 0): Point {
    const manual = this.manualDirection();
    const pilot = this.autopilot;
    if (!pilot) return manual;
    if (manual.x !== 0 || manual.z !== 0) {
      this.autopilot = null;
      pilot.onEnd("cancelled");
      return manual;
    }
    if (!position) return manual;
    const steer = pilot.follower.steer(position, now);
    if (typeof steer !== "string") return steer;
    this.autopilot = null;
    pilot.onEnd(steer);
    return { x: 0, z: 0 };
  }

  private manualDirection(): Point {
    if (this.joystick.x !== 0 || this.joystick.z !== 0) return joystickGait(this.joystick);
    const has = (...codes: string[]): boolean => codes.some((code) => this.keys.has(code));
    const x = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0);
    const z = (has("KeyS", "ArrowDown") ? 1 : 0) - (has("KeyW", "ArrowUp") ? 1 : 0);
    // Normalise so moving diagonally is not ~41% faster than moving straight.
    const unit = clampLength({ x, z }, true);
    const share = has("ShiftLeft", "ShiftRight") ? 1 : WALK_FRACTION;
    return { x: unit.x * share, z: unit.z * share };
  }

  /** Starts listening to the keyboard. Returns the function that stops it. */
  attachKeyboard(target: Window): () => void {
    const onDown = (event: KeyboardEvent): void => {
      if (RUN_KEYS.has(event.code)) this.keys.add(event.code);
      if (!MOVE_KEYS.has(event.code)) return;
      event.preventDefault(); // stop arrow keys scrolling the page
      this.keys.add(event.code);
    };
    const onUp = (event: KeyboardEvent): void => {
      this.keys.delete(event.code);
    };
    const onBlur = (): void => this.clear();
    target.addEventListener("keydown", onDown);
    target.addEventListener("keyup", onUp);
    target.addEventListener("blur", onBlur);
    return () => {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    };
  }
}

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const RUN_KEYS = new Set(["ShiftLeft", "ShiftRight"]);

/**
 * A partly pushed joystick walks, faster the further it goes, up to walking
 * pace just before RUN_PUSH. At RUN_PUSH and beyond it runs at full speed.
 */
function joystickGait(joystick: Point): Point {
  const push = Math.hypot(joystick.x, joystick.z);
  if (push >= RUN_PUSH) return clampLength(joystick, true);
  const scale = WALK_FRACTION / RUN_PUSH;
  return { x: joystick.x * scale, z: joystick.z * scale };
}

function clampLength(direction: Point, normalise = false): Point {
  const length = Math.hypot(direction.x, direction.z);
  if (length === 0) return { x: 0, z: 0 };
  if (!normalise && length <= 1) return direction;
  return { x: direction.x / length, z: direction.z / length };
}

/**
 * Rounds a direction before it is sent, so joystick jitter does not produce a
 * stream of "new" directions that differ in the fifth decimal place. Rounding
 * can never make the length exceed 1 by more than the server's tolerance.
 */
export function quantiseDirection(direction: Point): Point {
  const round = (value: number): number => Math.round(value * 50) / 50 || 0;
  const rounded = { x: round(direction.x), z: round(direction.z) };
  const length = Math.hypot(rounded.x, rounded.z);
  return length > 1 ? { x: rounded.x / length, z: rounded.z / length } : rounded;
}
