import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../test/gameHarness";
import type { DistrictMap } from "./district";

let h: Harness;
let yaba: DistrictMap;

beforeAll(async () => {
  h = await createHarness();
  yaba = h.game.districts.get("yaba") as DistrictMap;
});

afterAll(() => h?.close());

describe("where a player comes back", () => {
  it("is the spawn for a player who has never left anywhere", async () => {
    await h.game.players.ensurePlayer("newcomer");
    expect(await h.game.locations.startingPoint("newcomer", yaba)).toEqual(yaba.spawn);
  });

  it("is where they last stood, saved again as they move", async () => {
    await h.game.players.ensurePlayer("walker");
    await h.game.locations.save("walker", "yaba", { x: 158, z: 6 });
    expect(await h.game.locations.startingPoint("walker", yaba)).toEqual({ x: 158, z: 6 });
    await h.game.locations.save("walker", "yaba", { x: 8, z: 25 });
    expect(await h.game.locations.startingPoint("walker", yaba)).toEqual({ x: 8, z: 25 });
  });

  it("is the spawn when the saved spot is now inside a building, off the map, or in another district", async () => {
    const building = yaba.layout.buildings[0]!;
    for (const [id, district, spot] of [
      ["walled-in", "yaba", { x: building.x, z: building.z }],
      ["off-map", "yaba", { x: 10_000, z: 0 }],
      ["elsewhere", "london-somewhere", { x: 8, z: 25 }],
    ] as const) {
      await h.game.players.ensurePlayer(id);
      await h.game.locations.save(id, district, spot);
      expect(await h.game.locations.startingPoint(id, yaba), id).toEqual(yaba.spawn);
    }
  });
});
