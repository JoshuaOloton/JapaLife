import { describe, expect, it } from "vitest";
import { FAN_BLADES, ROOM_BACK, ROOM_HALF_WIDTH, ROOM_HEIGHT, dressingRoomSlabs } from "./bedroomSet";

const FRONT = 9;
const slabs = dressingRoomSlabs(FRONT);
const WALL = 0.1;

describe("the dressing room", () => {
  it("keeps the character's spot clear: nothing stands where they do but the floor and rug", () => {
    const inTheWay = slabs.filter(
      (slab) =>
        Math.abs(slab.x) < slab.halfWidth + 0.4 &&
        Math.abs(slab.z) < slab.halfDepth + 0.4 &&
        (slab.y ?? 0) < 2 && // the fan hangs above head height
        (slab.y ?? 0) + slab.height > 0.05, // floor and rug lie under the feet
    );
    expect(inTheWay).toEqual([]);
  });

  it("keeps everything inside its walls, floor and ceiling", () => {
    for (const slab of [...slabs, ...FAN_BLADES]) {
      expect(Math.abs(slab.x) - slab.halfWidth).toBeGreaterThanOrEqual(-ROOM_HALF_WIDTH - WALL - 1e-9);
      expect(Math.abs(slab.x) + slab.halfWidth).toBeLessThanOrEqual(ROOM_HALF_WIDTH + WALL + 1e-9);
      expect(slab.z - slab.halfDepth).toBeGreaterThanOrEqual(ROOM_BACK - WALL - 1e-9);
      expect(slab.z + slab.halfDepth).toBeLessThanOrEqual(FRONT + WALL + 1e-9);
      expect((slab.y ?? 0) + slab.height).toBeLessThanOrEqual(ROOM_HEIGHT + WALL + 1e-9);
    }
  });

  it("puts its front wall where it is asked, so the camera stands inside the room", () => {
    const front = dressingRoomSlabs(6).filter((slab) => slab.halfDepth < 0.1 && slab.halfWidth > ROOM_HALF_WIDTH);
    expect(front.map((slab) => slab.z - slab.halfDepth)).toContain(6);
  });
});
