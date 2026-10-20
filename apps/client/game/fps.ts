export interface FpsReading {
  /** Frames per second over the last window. */
  fps: number;
  /** The worst one-window fps since warm-up ended: the number to hold to 30+. */
  lowestFps: number | null;
  /** The longest single frame since warm-up, in ms. Above ~50 ms shows as a visible hitch. */
  worstFrameMs: number | null;
}

/**
 * Counts frames for the fps meter. The first seconds (loading, shader
 * compiling) are excluded from the lows, which would otherwise always look
 * terrible and hide the steady-state number we care about.
 */
export class FpsCounter {
  private windowStart: number | null = null;
  private lastFrame: number | null = null;
  private frames = 0;
  private firstFrame: number | null = null;
  private lowestFps: number | null = null;
  private worstFrameMs: number | null = null;

  constructor(
    private readonly warmUpMs = 5000,
    private readonly windowMs = 1000,
  ) {}

  /** Call once per rendered frame with a monotonic time in ms. Returns a reading once per window. */
  frame(now: number): FpsReading | null {
    this.firstFrame ??= now;
    const warmedUp = now - this.firstFrame >= this.warmUpMs;

    if (this.lastFrame !== null && warmedUp) {
      this.worstFrameMs = Math.max(this.worstFrameMs ?? 0, now - this.lastFrame);
    }
    this.lastFrame = now;

    if (this.windowStart === null) {
      this.windowStart = now;
      return null;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < this.windowMs) return null;

    const fps = (this.frames * 1000) / elapsed;
    if (warmedUp) this.lowestFps = Math.min(this.lowestFps ?? fps, fps);
    this.windowStart = now;
    this.frames = 0;
    return { fps, lowestFps: this.lowestFps, worstFrameMs: this.worstFrameMs };
  }
}

/** What the GPU was asked to draw in one frame (three.js `renderer.info.render`). */
export interface DrawLoad {
  calls: number;
  triangles: number;
  /** How much of the traffic and people adaptive quality allows (1, or 0.5 on a struggling phone). */
  street?: number;
}

export function formatFpsReading(reading: FpsReading, pixelRatio: number, load?: DrawLoad): string {
  const low = reading.lowestFps === null ? "-" : Math.round(reading.lowestFps);
  const worst = reading.worstFrameMs === null ? "-" : Math.round(reading.worstFrameMs);
  const frame = `${Math.round(reading.fps)} fps · low ${low} · worst ${worst} ms · dpr ${pixelRatio.toFixed(2)}`;
  if (!load) return frame;
  const drawn = `${frame} · ${load.calls} calls · ${(load.triangles / 1000).toFixed(1)}k tris`;
  return load.street === undefined ? drawn : `${drawn} · street ${Math.round(load.street * 100)}%`;
}
