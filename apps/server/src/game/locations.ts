import type { Point } from "@japalife/shared";
import type { GameDeps } from "./deps";
import type { DistrictMap } from "./district";

/**
 * Where each player last stood, so they come back there (decided 2026-10-23)
 * rather than at the district's spawn. Only a position in a district: no
 * personal data.
 */
export class LocationService {
  constructor(private readonly deps: GameDeps) {}

  /** Where the player should appear in this district: where they left, or the spawn if that spot is gone or blocked. */
  async startingPoint(playerId: string, district: DistrictMap): Promise<Point> {
    const row = await this.deps.db.playerLocation.findUnique({ where: { playerId } });
    if (!row || row.districtId !== district.id) return { ...district.spawn };
    const saved = { x: row.x, z: row.z };
    // A building may have been put there since (a new city file): never start inside a wall.
    return district.canStand(saved) ? saved : { ...district.spawn };
  }

  async save(playerId: string, districtId: string, point: Point): Promise<void> {
    const at = { districtId, x: point.x, z: point.z };
    await this.deps.db.playerLocation.upsert({ where: { playerId }, update: at, create: { playerId, ...at } });
  }
}
