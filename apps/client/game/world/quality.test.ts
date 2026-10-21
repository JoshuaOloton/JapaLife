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

  it("would have mistaken that gap for struggling without the pause", () => {
    const governor = new QualityGovernor();
    run(governor, 0, 8000, 1000 / 60);
    run(governor, 38_000, 50_000, 1000 / 60);
    expect(governor.scale).toBe(0.5);
  });
});
