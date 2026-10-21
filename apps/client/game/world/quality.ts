/**
 * Adaptive quality. If the frame rate stays low, the street gets quieter:
 * half the traffic and half the people, for good. Watching costs one counter
 * per frame. One way only, so a phone that struggles never flickers between
 * busy and quiet.
 */

/** Ignore the first seconds: loading and shader compiles make them slow on every phone. */
const WARM_UP_MS = 5000;
/** Below this many frames a second counts as low. */
const LOW_FPS = 30;
/** Low for this long, without a break, and the street is halved. */
const LOW_FOR_MS = 5000;
const REDUCED_SCALE = 0.5;

export class QualityGovernor {
  /** How much of the traffic and people to show: 1, or 0.5 once the phone has struggled. */
  scale = 1;
  private startedAt: number | null = null;
  private windowStart = 0;
  private framesInWindow = 0;
  private lowSince: number | null = null;
  private restarting = false;

  /** Call once per rendered frame with `performance.now()`. */
  frame(now: number): void {
    if (this.scale < 1) return;
    if (this.startedAt === null) {
      this.startedAt = now;
      this.windowStart = now;
      return;
    }
    if (this.restarting) {
      this.restarting = false;
      this.windowStart = now;
      this.framesInWindow = 0;
      return;
    }
    if (now - this.startedAt < WARM_UP_MS) {
      this.windowStart = now;
      return;
    }
    this.framesInWindow++;
    const elapsed = now - this.windowStart;
    if (elapsed < 1000) return;

    const fps = (this.framesInWindow * 1000) / elapsed;
    this.windowStart = now;
    this.framesInWindow = 0;
    if (fps >= LOW_FPS) {
      this.lowSince = null;
      return;
    }
    this.lowSince ??= now - elapsed;
    if (now - this.lowSince >= LOW_FOR_MS) this.scale = REDUCED_SCALE;
  }

  /**
   * The page was hidden (another app, the screen off). The browser draws
   * nothing meanwhile, and that gap is not the phone struggling: without this,
   * ten seconds in another app halved the street for good. Start watching afresh.
   */
  pause(): void {
    this.restarting = true;
    this.lowSince = null;
  }
}
