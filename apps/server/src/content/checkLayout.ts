import {
  type Box,
  type DistrictLayout,
  NPC_HALF_SIZE,
  PLAYER_RADIUS,
  districtObstacles,
  isBlocked,
  propBlockSize,
  reachableTargets,
  turnHalfSize,
} from "@japalife/shared";

/**
 * Problems with a district's physical layout. A layout mistake would otherwise
 * only show up in play (a shop you cannot reach, a player spawned inside a
 * wall, a generator in the middle of the road), so it stops the server from
 * starting instead. Checks the layout the server sends, with the same
 * obstacles the game walks against.
 */
export function checkLayout(where: string, layout: DistrictLayout): string[] {
  const problems: string[] = [];
  const { buildings, props, npcs, roads, spawn, interactables, interactRadius } = layout;
  const bounds = { halfWidth: layout.halfWidth, halfDepth: layout.halfDepth };
  const sticksOut = (box: Box): boolean =>
    Math.abs(box.x) + box.halfWidth > bounds.halfWidth || Math.abs(box.z) + box.halfDepth > bounds.halfDepth;
  const onRoad = (box: Box): boolean =>
    roads.some(
      (road) =>
        Math.abs(box.x - road.x) < box.halfWidth + road.halfWidth &&
        Math.abs(box.z - road.z) < box.halfDepth + road.halfDepth,
    );

  const seen = new Set<string>();
  for (const building of buildings) {
    if (seen.has(building.id)) problems.push(`${where}: duplicate building id "${building.id}"`);
    seen.add(building.id);
    if (sticksOut(building)) {
      problems.push(`${where}: building "${building.id}" sticks out of the walkable area`);
    }
  }

  const wires = new Map<string, number>();
  props.forEach((prop, index) => {
    const what = `prop ${index} ("${prop.kind}" at ${prop.x}, ${prop.z})`;
    const kind = layout.propKinds[prop.kind];
    if (!kind) {
      problems.push(`${where}: ${what} is an unknown kind (not in props/kinds.json)`);
      return;
    }
    if (prop.wire) {
      if (!("built" in kind.look) || kind.look.built !== "electric_pole") {
        problems.push(`${where}: ${what} has a wire but is not an electric pole`);
      }
      wires.set(prop.wire, (wires.get(prop.wire) ?? 0) + 1);
    }
    const size = propBlockSize(kind, layout.models);
    if (!size) return; // walked over or under: may stand anywhere, roads included
    const box = { x: prop.x, z: prop.z, ...turnHalfSize(size, prop.rotation) };
    if (sticksOut(box)) problems.push(`${where}: ${what} sticks out of the walkable area`);
    if (onRoad(box)) problems.push(`${where}: ${what} blocks a road`);
  });
  for (const [wire, poles] of wires) {
    if (poles < 2) problems.push(`${where}: wire "${wire}" has only one pole, so there is nothing to string it to`);
  }

  const npcIds = new Set<string>();
  for (const npc of npcs) {
    if (npcIds.has(npc.id)) problems.push(`${where}: duplicate NPC id "${npc.id}"`);
    npcIds.add(npc.id);
    const box = { x: npc.x, z: npc.z, halfWidth: NPC_HALF_SIZE, halfDepth: NPC_HALF_SIZE };
    if (sticksOut(box)) problems.push(`${where}: NPC "${npc.id}" is outside the walkable area`);
    if (onRoad(box)) problems.push(`${where}: NPC "${npc.id}" stands in a road`);
  }

  const obstacles = districtObstacles(layout);
  if (isBlocked(spawn, obstacles)) {
    problems.push(`${where}: the spawn point is inside a building, prop or person`);
    return problems; // nothing below makes sense from inside a wall
  }

  const standable = interactables.filter((thing) => {
    if (!isBlocked(thing.position, obstacles)) return true;
    problems.push(`${where}: "${thing.id}" is inside a building, prop or person, so nobody could stand at it`);
    return false;
  });

  const reachable = reachableTargets(
    spawn,
    standable.map((thing) => thing.position),
    interactRadius,
    obstacles,
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
