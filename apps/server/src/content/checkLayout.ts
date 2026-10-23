import {
  type Bounds,
  type Box,
  CHUNK_METRES,
  type DistrictLayout,
  NPC_HALF_SIZE,
  type Obstacles,
  PLAYER_RADIUS,
  type Point,
  SpatialGrid,
  type Traffic,
  distanceBetween,
  districtObstacles,
  isBlocked,
  obstacleGrid,
  propBlockSize,
  reachableTargets,
  routeBetween,
  turnHalfSize,
} from "@japalife/shared";
import { rideRoads } from "../game/district";

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
  /**
   * Streaming sends things by the chunk their centre is in, and the chunks
   * next to the player's are always loaded, so nothing may reach further than
   * a chunk from its centre, or the client could miss a wall the player touches.
   */
  const tooBigForChunks = (box: Box): boolean => box.halfWidth > CHUNK_METRES || box.halfDepth > CHUNK_METRES;
  const onRoad = (box: Box): boolean =>
    roads.some(
      (road) =>
        Math.abs(box.x - road.x) < box.halfWidth + road.halfWidth &&
        Math.abs(box.z - road.z) < box.halfDepth + road.halfDepth,
    );

  const seen = new Set<string>();
  const buildingGrid = new SpatialGrid(buildings);
  for (const building of buildings) {
    if (seen.has(building.id)) problems.push(`${where}: duplicate building id "${building.id}"`);
    seen.add(building.id);
    if (sticksOut(building)) {
      problems.push(`${where}: building "${building.id}" sticks out of the walkable area`);
    }
    if (onRoad(building)) problems.push(`${where}: building "${building.id}" stands on a road`);
    if (tooBigForChunks(building)) {
      problems.push(`${where}: building "${building.id}" reaches more than ${CHUNK_METRES} m from its centre (split it: it travels in one chunk)`);
    }
    const clash = buildingGrid
      .near(building.x, building.z, building.halfWidth, building.halfDepth)
      .find(
        (other) =>
          other !== building &&
          building.id < other.id && // report each pair once
          Math.abs(building.x - other.x) < building.halfWidth + other.halfWidth &&
          Math.abs(building.z - other.z) < building.halfDepth + other.halfDepth,
      );
    if (clash) problems.push(`${where}: buildings "${building.id}" and "${clash.id}" overlap`);
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
    if (tooBigForChunks(box)) problems.push(`${where}: ${what} reaches more than ${CHUNK_METRES} m from its centre`);
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

  const obstacles = obstacleGrid(districtObstacles(layout));
  if (layout.traffic) problems.push(...checkTraffic(where, layout.traffic, roads, bounds, obstacles));
  problems.push(...checkRides(where, layout));

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
function checkTraffic(where: string, traffic: Traffic, roads: readonly Box[], bounds: Bounds, obstacles: Obstacles): string[] {
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

/** A stop may stand this far from the nearest road its rides may use, metres: a short walk to the kerb. */
const STOP_TO_ROAD_METRES = 35;

/**
 * Every ride works: its stops are real places of the right kind (bus stops for
 * danfos, okada parks for okadas), each stands near a road its ride may use
 * (danfos the main roads, okadas only the inner streets), and every stop can be
 * reached from every other on those roads.
 */
function checkRides(where: string, layout: DistrictLayout): string[] {
  const problems: string[] = [];
  const places = new Map(layout.interactables.map((place) => [place.id, place]));
  for (const ride of layout.rides) {
    const what = `${where}: ride "${ride.id}"`;
    const wanted = ride.kind === "danfo" ? "bus_stop" : "okada_park";
    const roads = rideRoads(layout.roads, ride.kind);
    if (roads.length === 0) {
      problems.push(`${what} has no roads it may use`);
      continue;
    }
    for (const stopId of ride.stops) {
      const stop = places.get(stopId);
      if (!stop) {
        problems.push(`${what} stops at "${stopId}", which is not a place in the district`);
        continue;
      }
      if (stop.kind !== wanted) problems.push(`${what} stops at "${stopId}", which is a ${stop.kind}, not a ${wanted}`);
      const nearest = Math.min(
        ...roads.map((road) => Math.max(Math.abs(stop.position.x - road.x) - road.halfWidth, Math.abs(stop.position.z - road.z) - road.halfDepth, 0)),
      );
      if (nearest > STOP_TO_ROAD_METRES) problems.push(`${what}: "${stopId}" is ${nearest.toFixed(0)} m from any road a ${ride.kind} may use`);
    }
    const [first, ...rest] = ride.stops.map((id) => places.get(id)).filter((place) => place !== undefined);
    for (const other of rest) {
      if (first && !routeBetween(roads, first.position, other.position)) {
        problems.push(`${what} has no road route from "${first.id}" to "${other.id}"`);
      }
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
