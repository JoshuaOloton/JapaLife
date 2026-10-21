import { describe, expect, it } from "vitest";
import { blocksView } from "./occlusion";

// The church: 10.4 x 12.4 m, nearly 10 m tall, at (16, 44).
const church = { x: 16, z: 44, halfWidth: 5.2, halfDepth: 6.2, height: 9.9 };
const chest = (x: number, z: number) => ({ x, y: 1.2, z });
const cameraFor = (x: number, z: number) => ({ x, y: 9, z: z + 11 });

describe("blocksView", () => {
  it("is true for a tall building between the camera and the player (the player just north of it)", () => {
    expect(blocksView(church, cameraFor(16, 35), chest(16, 35))).toBe(true);
  });

  it("is false for a building beyond the player, or off to the side", () => {
    expect(blocksView(church, cameraFor(16, 60), chest(16, 60))).toBe(false);
    expect(blocksView(church, cameraFor(0, 35), chest(0, 35))).toBe(false);
  });

  it("is false for a low building the line passes over", () => {
    const shelter = { x: 16, z: 38, halfWidth: 1.6, halfDepth: 0.9, height: 2.6 };
    expect(blocksView(shelter, cameraFor(16, 35), chest(16, 35))).toBe(false);
  });
});
