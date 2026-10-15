import {
  PLAYER_RADIUS,
  isBlocked,
  reachableTargets,
  type DistrictConfig,
} from "@japalife/shared";

/**
 * Problems with a district's physical layout. A layout mistake would otherwise
 * only show up in play (a shop you cannot reach, a player spawned inside a
 * wall), so it stops the server from starting instead.
 */
export function checkLayout(where: string, district: DistrictConfig): string[] {
  const problems: string[] = [];
  const { buildings, spawn, interactables, interactRadius } = district;
  const bounds = { halfWidth: district.halfWidth, halfDepth: district.halfDepth };

  const seen = new Set<string>();
  for (const building of buildings) {
    if (seen.has(building.id)) problems.push(`${where}: duplicate building id "${building.id}"`);
    seen.add(building.id);
    if (
      Math.abs(building.x) + building.halfWidth > district.halfWidth ||
      Math.abs(building.z) + building.halfDepth > district.halfDepth
    ) {
      problems.push(`${where}: building "${building.id}" sticks out of the walkable area`);
    }
  }

  if (isBlocked(spawn, buildings)) {
    problems.push(`${where}: the spawn point is inside a building`);
    return problems; // nothing below makes sense from inside a wall
  }

  const standable = interactables.filter((thing) => {
    if (!isBlocked(thing.position, buildings)) return true;
    problems.push(`${where}: "${thing.id}" is inside a building, so nobody could stand at it`);
    return false;
  });

  const reachable = reachableTargets(
    spawn,
    standable.map((thing) => thing.position),
    interactRadius,
    buildings,
    bounds,
    PLAYER_RADIUS,
  );
  standable.forEach((thing, index) => {
    if (!reachable[index]) {
      problems.push(`${where}: "${thing.id}" cannot be reached on foot from the spawn point`);
    }
  });

  return problems;
}
