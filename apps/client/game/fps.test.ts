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
  });
});

describe("formatFpsReading", () => {
  it("shows dashes until the lows are known", () => {
    expect(formatFpsReading({ fps: 59.6, lowestFps: null, worstFrameMs: null }, 1.5)).toBe(
      "60 fps · low - · worst - ms · dpr 1.50",
    );
  });
});
