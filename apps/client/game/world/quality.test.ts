import { describe, expect, it } from "vitest";
import { QualityGovernor } from "./quality";

/** Feeds frames at a steady interval. */
function run(governor: QualityGovernor, from: number, to: number, frameMs: number): void {
  for (let t = from; t <= to; t += frameMs) governor.frame(t);
}

describe("QualityGovernor", () => {
  it("keeps the full street on a phone that holds its frame rate", () => {
    const governor = new QualityGovernor();
    run(governor, 0, 30_000, 1000 / 60);
    expect(governor.scale).toBe(1);
  });

  it("halves the street after five seconds below 30 fps", () => {
    const governor = new QualityGovernor();
    run(governor, 0, 6000, 1000 / 60);
    run(governor, 6050, 14_000, 1000 / 20);
    expect(governor.scale).toBe(0.5);
  });

  it("does not count time spent in another app as struggling", () => {
    const governor = new QualityGovernor();
    run(governor, 0, 8000, 1000 / 60);
    governor.pause(); // 30 s in another app: the browser draws nothing meanwhile
    run(governor, 38_000, 50_000, 1000 / 60);
    expect(governor.scale).toBe(1);
  });

  it("does not count a stretch where nothing was drawn as struggling, even unannounced (a reconnect, a held page)", () => {
    const governor = new QualityGovernor();
    run(governor, 0, 8000, 1000 / 60);
    run(governor, 38_000, 50_000, 1000 / 60); // 30 s with no frames, and no pause call
    expect(governor.scale).toBe(1);
  });

  it("still halves the street on a phone that keeps drawing slowly after such a gap", () => {
    const governor = new QualityGovernor();
    run(governor, 0, 8000, 1000 / 60);
    run(governor, 20_000, 30_000, 1000 / 20);
    expect(governor.scale).toBe(0.5);
  });

  it("ignores the slow loading seconds again when the 3D view is rebuilt", () => {
    const governor = new QualityGovernor();
    run(governor, 0, 20_000, 1000 / 60);
    governor.restart();
    run(governor, 20_500, 24_500, 1000 / 10); // 4 s of loading at 10 fps, inside the new warm-up
    run(governor, 24_600, 40_000, 1000 / 60);
    expect(governor.scale).toBe(1);
  });
});
