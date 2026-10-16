import type { Point } from "@japalife/shared";

/**
 * The direction the player is asking to walk, on the ground plane. The camera
 * always looks north (toward -z), so "up" on the screen is -z.
 *
 * Kept outside React on purpose: it changes every frame while a key or the
 * joystick is held, and a React state update per frame would re-render the tree.
 */
export class MoveInput {
  private readonly keys = new Set<string>();
  private joystick: Point = { x: 0, z: 0 };

  setJoystick(direction: Point): void {
    this.joystick = direction;
  }

  /** Releases everything, e.g. when the tab loses focus and key-up events would be missed. */
  clear(): void {
    this.keys.clear();
    this.joystick = { x: 0, z: 0 };
  }

  /** Current direction, never longer than 1. The joystick wins over keys when both are used. */
  direction(): Point {
    if (this.joystick.x !== 0 || this.joystick.z !== 0) return clampLength(this.joystick);
    const has = (...codes: string[]): boolean => codes.some((code) => this.keys.has(code));
    const x = (has("KeyD", "ArrowRight") ? 1 : 0) - (has("KeyA", "ArrowLeft") ? 1 : 0);
    const z = (has("KeyS", "ArrowDown") ? 1 : 0) - (has("KeyW", "ArrowUp") ? 1 : 0);
    // Normalise so walking diagonally is not ~41% faster than walking straight.
    return clampLength({ x, z }, true);
  }

  /** Starts listening to the keyboard. Returns the function that stops it. */
  attachKeyboard(target: Window): () => void {
    const onDown = (event: KeyboardEvent): void => {
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
