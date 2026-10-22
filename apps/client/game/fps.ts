export interface FpsReading {
  /** Frames per second over the last window. */
  fps: number;
  /** The worst one-window fps since warm-up ended: the number to hold to 30+. */
  lowestFps: number | null;
  /** The longest single frame since warm-up, in ms. Above ~50 ms shows as a visible hitch. */
  worstFrameMs: number | null;
  /** What the GPU had to set up for that frame: new shaders compiled, new textures uploaded. */
  worstFrameWork?: GpuWork | null;
  /** When the worst frame happened, in whole seconds since the game appeared: early means loading. */
  worstFrameAtSeconds?: number | null;
  /** Frames longer than `HITCH_MS` since warm-up: one is a one-off, several means something recurring. */
  hitches?: number;
  /**
   * Shaders compiled after warm-up. Should stay 0: a compile mid-game can
   * freeze a phone for seconds (11f-4), so every shader must be ready at load.
   */
  lateShaders?: number;
  /** The most draw calls in one frame since warm-up (budget: `DRAW_CALL_BUDGET`). */
  peakCalls?: number;
}

/** Running totals of the GPU set-up work so far (three.js `renderer.info`), or the new work in one frame. */
export interface GpuWork {
  shaders: number;
  textures: number;
}

/** What the renderer reports each frame: the set-up totals and the draw calls of the frame before. */
export interface FrameStats extends GpuWork {
  calls?: number;
}

/** Most draw calls per frame a mid-range phone handles at 60 fps (Slice 11 budget). */
export const DRAW_CALL_BUDGET = 80;
/** A frame this long is a hitch anyone notices. */
export const HITCH_MS = 100;

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
  private worstFrameWork: GpuWork | null = null;
  private worstFrameAtSeconds: number | null = null;
  private hitches = 0;
  private lastWork: GpuWork | null = null;
  private shadersAtWarmUp: number | null = null;
  private lateShaders = 0;
  private peakCalls = 0;

  constructor(
    private readonly warmUpMs = 5000,
    private readonly windowMs = 1000,
  ) {}

  /**
   * Call once per rendered frame with a monotonic time in ms, and the GPU work
   * totals so far. Returns a reading once per window. A frame's time and work
   * are seen on the frame after it, so both describe the same frame.
   */
  frame(now: number, work?: FrameStats): FpsReading | null {
    this.firstFrame ??= now;
    const warmedUp = now - this.firstFrame >= this.warmUpMs;
    if (warmedUp && work) {
      this.shadersAtWarmUp ??= work.shaders;
      this.lateShaders = work.shaders - this.shadersAtWarmUp;
      this.peakCalls = Math.max(this.peakCalls, work.calls ?? 0);
    }

    if (this.lastFrame !== null && warmedUp && now - this.lastFrame > HITCH_MS) this.hitches++;
    if (this.lastFrame !== null && warmedUp && now - this.lastFrame > (this.worstFrameMs ?? 0)) {
      this.worstFrameMs = now - this.lastFrame;
      this.worstFrameAtSeconds = Math.round((now - (this.firstFrame ?? now)) / 1000);
      this.worstFrameWork =
        work && this.lastWork
          ? { shaders: work.shaders - this.lastWork.shaders, textures: work.textures - this.lastWork.textures }
          : null;
    }
    this.lastFrame = now;
    this.lastWork = work ?? null;

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
    return {
      fps,
      lowestFps: this.lowestFps,
      worstFrameMs: this.worstFrameMs,
      worstFrameWork: this.worstFrameWork,
      worstFrameAtSeconds: this.worstFrameAtSeconds,
      hitches: this.hitches,
      lateShaders: this.lateShaders,
      peakCalls: this.peakCalls,
    };
  }

  /**
   * The page was hidden (another app, the screen off): the browser stops
   * drawing, so the gap until it shows again is not a slow frame. Start counting afresh.
   */
  pause(): void {
    this.lastFrame = null;
    this.windowStart = null;
    this.frames = 0;
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
  const work = reading.worstFrameWork;
  const cause = work && (work.shaders > 0 || work.textures > 0) ? ` (+${work.shaders} shaders, +${work.textures} textures)` : "";
  const when = reading.worstFrameAtSeconds == null ? "" : ` at ${reading.worstFrameAtSeconds}s`;
  const hitches = reading.hitches ? ` · ${reading.hitches} hitch${reading.hitches === 1 ? "" : "es"}` : "";
  const frame = `${Math.round(reading.fps)} fps · low ${low} · worst ${worst} ms${when}${cause}${hitches} · dpr ${pixelRatio.toFixed(2)}`;
  const drawn = load ? `${frame} · ${load.calls} calls · ${(load.triangles / 1000).toFixed(1)}k tris` : frame;
  const street = load?.street === undefined ? drawn : `${drawn} · street ${Math.round(load.street * 100)}%`;
  // Broken performance rules, loudly, so they are noticed before a phone is.
  const warnings = [
    ...(reading.lateShaders ? [`⚠ late shaders ${reading.lateShaders}`] : []),
    ...((reading.peakCalls ?? 0) > DRAW_CALL_BUDGET ? [`⚠ ${reading.peakCalls} calls peak`] : []),
  ];
  return warnings.length > 0 ? `${street} · ${warnings.join(" · ")}` : street;
}
