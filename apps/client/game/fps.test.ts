import { describe, expect, it } from "vitest";
import { FpsCounter, formatFpsReading } from "./fps";

/** Feeds frames at a steady interval and returns every reading. */
function run(counter: FpsCounter, from: number, to: number, frameMs: number) {
  const readings = [];
  for (let t = from; t <= to; t += frameMs) {
    const reading = counter.frame(t);
    if (reading) readings.push(reading);
  }
  return readings;
}

describe("FpsCounter", () => {
  it("reports frames per second once per window", () => {
    const readings = run(new FpsCounter(0), 0, 3000, 1000 / 30);
    expect(readings.length).toBeGreaterThanOrEqual(2);
    expect(readings[0]?.fps).toBeCloseTo(30, 0);
  });

  it("leaves warm-up out of the lows and the worst frame", () => {
    const counter = new FpsCounter(2000);
    run(counter, 0, 1000, 200); // loading: 5 fps
    const readings = run(counter, 1016, 4000, 16);
    expect(readings.at(-1)?.lowestFps).toBeGreaterThan(55);
    expect(readings.at(-1)?.worstFrameMs).toBe(16);
  });

  it("remembers the worst window and the longest frame after warm-up", () => {
    const counter = new FpsCounter(0);
    run(counter, 0, 1000, 20); // 50 fps
    counter.frame(1150); // a 150 ms hitch
    const readings = run(counter, 1170, 3000, 20);
    expect(readings.at(-1)?.worstFrameMs).toBe(150);
    expect(readings.at(-1)?.lowestFps).toBeLessThan(50);
    // When it happened, and how many hitches there were: one here.
    expect(readings.at(-1)?.worstFrameAtSeconds).toBe(1);
    expect(readings.at(-1)?.hitches).toBe(1);
    expect(formatFpsReading(readings.at(-1)!, 1.5)).toMatch(/worst 150 ms at 1s · 1 hitch · dpr/);
  });

  it("counts shaders compiled after warm-up, and the busiest frame's draw calls", () => {
    const counter = new FpsCounter(1000);
    for (let t = 0; t < 1000; t += 20) counter.frame(t, { shaders: 3, textures: 1, calls: 120 }); // loading: not counted
    let last = null;
    for (let t = 1000; t <= 2000; t += 20) last = counter.frame(t, { shaders: 9, textures: 4, calls: 40 }) ?? last;
    expect(last?.lateShaders).toBe(0);
    for (let t = 2020; t <= 3100; t += 20) last = counter.frame(t, { shaders: t > 2500 ? 10 : 9, textures: 4, calls: t === 2600 ? 85 : 40 }) ?? last;
    expect(last?.lateShaders).toBe(1);
    expect(last?.peakCalls).toBe(85);
  });

  it("does not count the time the page was hidden as a frame", () => {
    const counter = new FpsCounter(0);
    run(counter, 0, 1000, 20);
    counter.pause(); // another app for 30 s
    const readings = run(counter, 31_000, 33_000, 20);
    expect(readings.at(-1)?.worstFrameMs).toBe(20);
    expect(readings.at(-1)?.lowestFps).toBeGreaterThan(45);
  });

  it("says what the GPU had to set up during the worst frame", () => {
    const counter = new FpsCounter(0);
    for (let t = 0; t <= 1000; t += 20) counter.frame(t, { shaders: 10, textures: 5 });
    // Frame drawn at 1000 compiled two shaders and took 400 ms; seen at 1400.
    counter.frame(1400, { shaders: 12, textures: 5 });
    let last = null;
    for (let t = 1420; t <= 3000; t += 20) last = counter.frame(t, { shaders: 12, textures: 5 }) ?? last;
    expect(last?.worstFrameMs).toBe(400);
    expect(last?.worstFrameWork).toEqual({ shaders: 2, textures: 0 });
  });
});

describe("formatFpsReading", () => {
  it("shows dashes until the lows are known", () => {
    expect(formatFpsReading({ fps: 59.6, lowestFps: null, worstFrameMs: null }, 1.5)).toBe(
      "60 fps · low - · worst - ms · dpr 1.50",
    );
  });

  it("adds draw calls and triangles when given, for the < 80 draw-call budget", () => {
    expect(
      formatFpsReading({ fps: 60, lowestFps: 58, worstFrameMs: 25 }, 1.5, { calls: 47, triangles: 61_234 }),
    ).toBe("60 fps · low 58 · worst 25 ms · dpr 1.50 · 47 calls · 61.2k tris");
  });

  it("warns about shaders compiled after warm-up and frames over the draw-call budget", () => {
    expect(formatFpsReading({ fps: 60, lowestFps: 58, worstFrameMs: 25, lateShaders: 0, peakCalls: 41 }, 1.5)).toBe(
      "60 fps · low 58 · worst 25 ms · dpr 1.50",
    );
    expect(formatFpsReading({ fps: 60, lowestFps: 20, worstFrameMs: 900, lateShaders: 2, peakCalls: 95 }, 1.5)).toBe(
      "60 fps · low 20 · worst 900 ms · dpr 1.50 · ⚠ late shaders 2 · ⚠ 95 calls peak",
    );
  });

  it("names the set-up work behind the worst frame, when there was any", () => {
    expect(
      formatFpsReading({ fps: 60, lowestFps: 40, worstFrameMs: 812, worstFrameWork: { shaders: 3, textures: 1 } }, 1.5),
    ).toBe("60 fps · low 40 · worst 812 ms (+3 shaders, +1 textures) · dpr 1.50");
  });
});
