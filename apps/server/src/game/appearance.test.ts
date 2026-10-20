import type { Appearance } from "@japalife/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../test/gameHarness";
import type { DistrictMap } from "./district";

const PLAYER = "dresser";
const LOOK: Appearance = { body: "body-2", skinTone: "tone-6", hair: "bald", hairColour: "black", outfit: "senator", outfitColour: "green" };

let h: Harness;
let yaba: DistrictMap;
let home: { x: number; z: number };
let farFromHome: { x: number; z: number };

beforeEach(async () => {
  await h?.close();
  h = await createHarness();
  await h.game.players.ensurePlayer(PLAYER);
  yaba = h.game.districts.get("yaba")!;
  home = yaba.config.interactables.find((thing) => thing.kind === "home")!.position;
  farFromHome = { x: home.x + 20, z: home.z + 20 };
});

afterAll(() => h?.close());

describe("AppearanceService", () => {
  it("has no character until the player makes one", async () => {
    expect(await h.game.appearance.get(PLAYER)).toBeNull();
  });

  it("lets the first character be made anywhere (the creator), and keeps it", async () => {
    const outcome = await h.game.appearance.set(PLAYER, LOOK, farFromHome, yaba);
    expect(outcome).toEqual({ ok: true, appearance: LOOK });
    expect(await h.game.appearance.get(PLAYER)).toEqual(LOOK);
  });

  it("only changes clothes at home once the character exists", async () => {
    await h.game.appearance.set(PLAYER, LOOK, farFromHome, yaba);
    const changed = { ...LOOK, outfit: "office", outfitColour: "blue" };

    expect(await h.game.appearance.set(PLAYER, changed, farFromHome, yaba)).toEqual({ ok: false, reason: "not_at_home" });
    expect(await h.game.appearance.get(PLAYER)).toEqual(LOOK);

    expect(await h.game.appearance.set(PLAYER, changed, home, yaba)).toEqual({ ok: true, appearance: changed });
    expect(await h.game.appearance.get(PLAYER)).toEqual(changed);
  });

  it("refuses clothes that are not free starter items, and ids the catalog does not have", async () => {
    expect(await h.game.appearance.set(PLAYER, { ...LOOK, outfit: "security-uniform" }, home, yaba)).toEqual({
      ok: false,
      reason: "not_owned",
    });
    expect(await h.game.appearance.set(PLAYER, { ...LOOK, outfit: "agbada" }, home, yaba)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await h.game.appearance.get(PLAYER)).toBeNull();
  });

  it("falls back to the default for an option the catalog no longer has", async () => {
    await h.db.playerAppearance.create({ data: { playerId: PLAYER, ...LOOK, outfit: "retired-outfit" } });
    expect(await h.game.appearance.get(PLAYER)).toEqual({ ...LOOK, outfit: h.content.characters.defaults.outfit });
  });
});
