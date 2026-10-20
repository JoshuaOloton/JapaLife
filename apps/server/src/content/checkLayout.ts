import {
  type Bounds,
  type Box,
  type DistrictLayout,
  NPC_HALF_SIZE,
  PLAYER_RADIUS,
  type Point,
  type Traffic,
  distanceBetween,
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
  if (layout.traffic) problems.push(...checkTraffic(where, layout.traffic, roads, bounds, obstacles));

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

/** How far apart traffic lanes and walkways are sampled for the checks, in metres. */
const SAMPLE_METRES = 1;
/** Room a walking person takes up, in metres from their centre. */
const PEDESTRIAN_RADIUS = 0.3;
/** How close a bus stop must be to its lane, in metres. */
const BUS_STOP_REACH = 0.5;

/**
 * The moving life must look right without anything blocking it: lanes stay on
 * roads (they may run past the district edge, so vehicles arrive off-screen),
 * people never walk through a wall, a generator or Mama Put, and every fleet
 * and bus stop names a real lane.
 */
function checkTraffic(where: string, traffic: Traffic, roads: readonly Box[], bounds: Bounds, obstacles: readonly Box[]): string[] {
  const problems: string[] = [];
  const inside = (point: Point, margin = 0): boolean =>
    Math.abs(point.x) <= bounds.halfWidth - margin && Math.abs(point.z) <= bounds.halfDepth - margin;
  const onRoad = (point: Point): boolean =>
    roads.some((road) => Math.abs(point.x - road.x) <= road.halfWidth && Math.abs(point.z - road.z) <= road.halfDepth);

  const lanes = new Map(traffic.lanes.map((lane) => [lane.id, lane.points]));
  if (lanes.size !== traffic.lanes.length) problems.push(`${where}: duplicate traffic lane id`);
  for (const lane of traffic.lanes) {
    const offRoad = samplePath(lane.points).find((point) => inside(point) && !onRoad(point));
    if (offRoad) problems.push(`${where}: lane "${lane.id}" leaves the road at ${offRoad.x.toFixed(1)}, ${offRoad.z.toFixed(1)}`);
  }
  for (const group of traffic.fleet) {
    for (const lane of group.lanes) {
      if (!lanes.has(lane)) problems.push(`${where}: fleet "${group.kind}" uses unknown lane "${lane}"`);
    }
  }
  for (const stop of traffic.busStops) {
    const points = lanes.get(stop.lane);
    if (!points) {
      problems.push(`${where}: bus stop uses unknown lane "${stop.lane}"`);
    } else if (!samplePath(points, 0.1).some((point) => distanceBetween(point, stop.at) <= BUS_STOP_REACH)) {
      problems.push(`${where}: bus stop at ${stop.at.x}, ${stop.at.z} is not on lane "${stop.lane}"`);
    }
  }
  for (const walkway of traffic.pedestrians.walkways) {
    const blocked = samplePath(walkway.points).find(
      (point) => !inside(point, PEDESTRIAN_RADIUS) || isBlocked(point, obstacles, PEDESTRIAN_RADIUS),
    );
    if (blocked) {
      problems.push(
        `${where}: walkway "${walkway.id}" runs into something (or off the district) at ${blocked.x.toFixed(1)}, ${blocked.z.toFixed(1)}`,
      );
    }
  }
  return problems;
}

/** Points along a path every `step` metres, ends included. */
function samplePath(points: readonly Point[], step = SAMPLE_METRES): Point[] {
  const samples: Point[] = [];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const pieces = Math.max(1, Math.ceil(distanceBetween(from, to) / step));
    for (let piece = 0; piece <= pieces; piece++) {
      const t = piece / pieces;
      samples.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
    }
  }
  return samples;
}
