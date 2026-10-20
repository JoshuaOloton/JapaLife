import { type Appearance, type Point, appearanceProblem, resolveAppearance } from "@japalife/shared";
import type { GameDeps } from "./deps";
import type { DistrictMap } from "./district";
import { type Outcome, reject } from "./outcome";

/**
 * A player's character. Made once in the creator (allowed anywhere), then
 * changed only at home. Only free starter items are allowed until the shop
 * sells more (decided 2026-10-17). Stored as catalog ids; an id the catalog
 * no longer has falls back to that slot's default when read.
 */
export class AppearanceService {
  constructor(private readonly deps: GameDeps) {}

  /** The player's character, or null if they have never made one. */
  async get(playerId: string): Promise<Appearance | null> {
    const row = await this.deps.db.playerAppearance.findUnique({ where: { playerId } });
    if (!row) return null;
    const { body, skinTone, hair, hairColour, outfit, outfitColour } = row;
    return resolveAppearance({ body, skinTone, hair, hairColour, outfit, outfitColour }, this.deps.content.characters);
  }

  async set(
    playerId: string,
    appearance: Appearance,
    position: Point,
    district: DistrictMap,
  ): Promise<Outcome<{ appearance: Appearance }>> {
    const { db, content } = this.deps;
    const problem = appearanceProblem(appearance, content.characters, { starterOnly: true });
    if (problem) return reject(problem.reason === "not_owned" ? "not_owned" : "invalid");

    const existing = await db.playerAppearance.findUnique({ where: { playerId }, select: { playerId: true } });
    if (existing && !district.nearest(position, (thing) => thing.kind === "home")) return reject("not_at_home");

    await db.playerAppearance.upsert({ where: { playerId }, update: appearance, create: { playerId, ...appearance } });
    return { ok: true, appearance };
  }
}
