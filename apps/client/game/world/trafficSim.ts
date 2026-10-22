import {
  type Box,
  type DistrictLayout,
  PLAYER_RADIUS,
  type Point,
  type TrafficSchedule,
  seededRandom,
} from "@japalife/shared";

/**
 * The street traffic, as a tiny simulation the client runs on its own (it is
 * cosmetic: not synced, never blocks the player). A lane is a line along the
 * road; a vehicle is how far along its lane it is, and its speed. Each step a
 * vehicle eases toward its cruising speed, but:
 *  - slows over speed bumps,
 *  - keeps a gap behind the vehicle ahead,
 *  - stops for the player standing in its path,
 *  - waits its turn at a junction (one direction of travel at a time),
 *  - pauses at bus stops if it is a danfo,
 * and at the end of its lane drives off the map and comes back at the start,
 * or parks out of sight when the hour's schedule has fewer vehicles out.
 * Pure, so it is unit-tested without a GPU.
 */

/** Metres per second squared. Vehicles pull away gently and brake harder. */
const ACCELERATION = 2.5;
const BRAKING = 7;
/** Bumper-to-bumper gap in a queue, metres. */
const QUEUE_GAP = 1.5;
/** Speed over a speed bump, and how far before and after it the vehicle slows. */
const BUMP_SPEED = 2;
const BUMP_SLOW_BEFORE = 4;
const BUMP_SLOW_AFTER = 1;
/** How far ahead a vehicle watches for the player, beyond its own front, and the room it leaves. */
const PLAYER_LOOKAHEAD = 6;
const PLAYER_ROOM = 0.8;
const PLAYER_SIDE_ROOM = 0.3;
/** A vehicle waits at a junction this far before it. */
const JUNCTION_WAIT_ROOM = 0.3;
/** After this long waiting, the other direction stops letting new vehicles in. */
const JUNCTION_FAIRNESS_SECONDS = 3;
/** How close to a bus stop counts as at it, metres. */
const BUS_STOP_REACH = 0.3;

export interface LaneSegment {
  from: Point;
  /** Unit direction. */
  dx: number;
  dz: number;
  length: number;
  /** Distance along the lane where this segment starts. */
  start: number;
}

export interface Lane {
  id: string;
  segments: LaneSegment[];
  length: number;
  /** Which way it mostly runs, for junction turn-taking: crossing directions take turns. */
  axis: "x" | "z";
  /** Speed bumps on this lane, as distances along it. */
  bumps: number[];
  /** Bus stops on this lane: where (distance along it) and how long a danfo waits. */
  stops: { at: number; seconds: number }[];
  /** Junctions this lane crosses: the stretch of the lane inside each. */
  junctions: { index: number; enter: number; exit: number }[];
  /**
   * The stretch of the lane inside the simulation window around the player
   * (`setTrafficWindow`): vehicles join at `windowFrom` and park once past
   * `windowTo`. The whole lane until a window is set; empty (from > to) when
   * the lane misses the window.
   */
  windowFrom: number;
  windowTo: number;
}

export function buildLane(id: string, points: readonly Point[]): Lane {
  const segments: LaneSegment[] = [];
  let start = 0;
  let alongX = 0;
  let alongZ = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length === 0) continue;
    segments.push({ from, dx: (to.x - from.x) / length, dz: (to.z - from.z) / length, length, start });
    alongX += Math.abs(to.x - from.x);
    alongZ += Math.abs(to.z - from.z);
    start += length;
  }
  return {
    id,
    segments,
    length: start,
    axis: alongX >= alongZ ? "x" : "z",
    bumps: [],
    stops: [],
    junctions: [],
    windowFrom: 0,
    windowTo: start,
  };
}

/** A place on a lane and the way it runs there. */
export interface LanePoint {
  x: number;
  z: number;
  heading: number;
}

/**
 * Where on the lane a distance falls, and which way the lane runs there (as a
 * turn about y, like the player's). Pass `out` from a per-frame loop to reuse
 * one object instead of making a new one each call (garbage-collection pauses
 * are hitches on a phone).
 */
export function pointOnLane(lane: Lane, s: number, out: LanePoint = { x: 0, z: 0, heading: 0 }): LanePoint {
  let segment = lane.segments[lane.segments.length - 1];
  for (const candidate of lane.segments) {
    if (s <= candidate.start + candidate.length) {
      segment = candidate;
      break;
    }
  }
  if (!segment) {
    out.x = 0;
    out.z = 0;
    out.heading = 0;
    return out;
  }
  const along = s - segment.start;
  out.x = segment.from.x + segment.dx * along;
  out.z = segment.from.z + segment.dz * along;
  out.heading = Math.atan2(segment.dx, segment.dz);
  return out;
}

/** The point's distance along the lane (at the nearest point) and how far it is from the lane. `out` as for `pointOnLane`. */
export function projectOnLane(
  lane: Lane,
  point: Point,
  out: { s: number; lateral: number } = { s: 0, lateral: 0 },
): { s: number; lateral: number } {
  out.s = 0;
  out.lateral = Number.POSITIVE_INFINITY;
  for (const segment of lane.segments) {
    const rx = point.x - segment.from.x;
    const rz = point.z - segment.from.z;
    const along = Math.min(segment.length, Math.max(0, rx * segment.dx + rz * segment.dz));
    const lateral = Math.hypot(rx - segment.dx * along, rz - segment.dz * along);
    if (lateral < out.lateral) {
      out.s = segment.start + along;
      out.lateral = lateral;
    }
  }
  return out;
}

/**
 * Sets the lane's window to the stretch of it inside `box` (the slab method on
 * each segment), or empties it if the lane misses the box.
 */
export function clipLaneToBox(lane: Lane, box: Box): void {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const segment of lane.segments) {
    let enter = 0;
    let leave = segment.length;
    for (const [start, step, low, high] of [
      [segment.from.x, segment.dx, box.x - box.halfWidth, box.x + box.halfWidth],
      [segment.from.z, segment.dz, box.z - box.halfDepth, box.z + box.halfDepth],
    ] as const) {
      if (Math.abs(step) < 1e-9) {
        if (start < low || start > high) leave = -1;
        continue;
      }
      const a = (low - start) / step;
      const b = (high - start) / step;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
    }
    if (enter > leave) continue;
    from = Math.min(from, segment.start + enter);
    to = Math.max(to, segment.start + leave);
  }
  lane.windowFrom = from;
  lane.windowTo = to;
}

/** Whether a lane crosses the simulation window at all. */
export function inWindow(lane: Lane): boolean {
  return lane.windowFrom <= lane.windowTo;
}

/** The stretch of a lane inside a box (sampled every 0.25 m), or undefined if the lane misses it. */
export function laneThroughBox(lane: Lane, box: Box): { enter: number; exit: number } | undefined {
  let enter: number | undefined;
  let exit = 0;
  for (let s = 0; s <= lane.length; s += 0.25) {
    const { x, z } = pointOnLane(lane, s);
    if (Math.abs(x - box.x) <= box.halfWidth && Math.abs(z - box.z) <= box.halfDepth) {
      enter ??= s;
      exit = s;
    }
  }
  return enter === undefined ? undefined : { enter, exit };
}

export interface Vehicle {
  id: number;
  kind: string;
  lane: Lane;
  /** The lanes it may drive (its fleet's): it rejoins on whichever crosses the window. Just `lane` if left out. */
  lanes?: Lane[];
  /** Which of `lanes` to try first next time it rejoins, so vehicles spread over the lanes. */
  nextLane?: number;
  /** Distance of its centre along the lane, metres. */
  s: number;
  speed: number;
  cruise: number;
  halfLength: number;
  halfWidth: number;
  stopsAtBusStops: boolean;
  /** Fixed 0-1 number: out on the road when it is below the hour's share. */
  hash: number;
  /** Off the road, out of sight, waiting to come back on. */
  parked: boolean;
  /** Simulation time it last parked: it waits at least one step before coming back. */
  parkedAt?: number;
  /** Simulation time it may set off from a bus stop. */
  pausedUntil: number;
  /** Bus stops (distances) served on this run, so it stops once each. */
  served: Set<number>;
}

export interface JunctionState {
  /** Which direction of travel is crossing now, or null when it is empty. */
  axis: "x" | "z" | null;
  inside: Set<number>;
  /** When a vehicle of each direction started waiting, for fairness. */
  waitingSince: { x: number | null; z: number | null };
}

export interface TrafficWorld {
  lanes: Lane[];
  vehicles: Vehicle[];
  junctions: JunctionState[];
  /** Simulation seconds. */
  time: number;
  /** Each lane's vehicles, made on the first step, and kept up to date as vehicles rejoin on other lanes. */
  byLane?: Map<Lane, Vehicle[]>;
  /** True once a simulation window has been set (the first one scatters the traffic through it). */
  windowed?: boolean;
}

/**
 * Simulates only the traffic in `box` around the player (`TRAFFIC_REACH`):
 * each lane's window becomes its stretch inside the box. Vehicles past their
 * lane's window park, and parked ones rejoin at the start of a lane crossing
 * it, so the same few dozen vehicles serve the player wherever they are. The
 * first call spreads the vehicles through the window, so the street is busy
 * from the start. Call it when the player crosses into another area cell.
 */
export function setTrafficWindow(world: TrafficWorld, box: Box, random: () => number): void {
  for (const lane of world.lanes) clipLaneToBox(lane, box);
  if (world.windowed) return;
  world.windowed = true;
  const lanes = lanesByVehicle(world);
  for (const lane of world.lanes) lanes.set(lane, []);
  world.vehicles.forEach((vehicle, index) => {
    const open = (vehicle.lanes ?? [vehicle.lane]).filter(inWindow);
    const lane = open[index % Math.max(1, open.length)];
    if (!lane) {
      vehicle.parked = true;
      lanes.get(vehicle.lane)?.push(vehicle);
      return;
    }
    vehicle.lane = lane;
    lanes.get(lane)?.push(vehicle);
  });
  // Spread each lane's vehicles out along its window, in a random order.
  for (const [lane, onLane] of lanes) {
    if (!inWindow(lane)) continue;
    const moving = onLane.filter((vehicle) => !vehicle.parked).sort(() => random() - 0.5);
    moving.forEach((vehicle, index) => {
      vehicle.s = lane.windowFrom + ((index + 0.3 + random() * 0.4) / moving.length) * (lane.windowTo - lane.windowFrom);
      vehicle.speed = vehicle.cruise;
    });
  }
}

/** Each lane's vehicles, made once (`byLane`). */
function lanesByVehicle(world: TrafficWorld): Map<Lane, Vehicle[]> {
  world.byLane ??= new Map(world.lanes.map((lane) => [lane, world.vehicles.filter((vehicle) => vehicle.lane === lane)]));
  return world.byLane;
}

export function createJunctions(count: number): JunctionState[] {
  return Array.from({ length: count }, () => ({ axis: null, inside: new Set<number>(), waitingSince: { x: null, z: null } }));
}

/** A speed bump counts as on a lane when the lane runs within this far of it, metres. */
const BUMP_ON_LANE = 1;

/**
 * The traffic for a district, from its layout: lanes with their bumps, bus
 * stops and junctions (where two roads overlap), and the fleet spread along
 * its lanes. Seeded, so every visit starts the same.
 */
export function createTraffic(layout: Pick<DistrictLayout, "traffic" | "roads" | "props" | "propKinds" | "vehicles" | "models">): TrafficWorld {
  const traffic = layout.traffic;
  if (!traffic) return { lanes: [], vehicles: [], junctions: [], time: 0 };

  const lanes = traffic.lanes.map((lane) => buildLane(lane.id, lane.points));
  const junctionBoxes = roadOverlaps(layout.roads);
  const bumps = layout.props.filter((prop) => {
    const look = layout.propKinds[prop.kind]?.look;
    return look !== undefined && "built" in look && look.built === "speed_bump";
  });
  for (const lane of lanes) {
    for (const bump of bumps) {
      const seen = projectOnLane(lane, bump);
      if (seen.lateral <= BUMP_ON_LANE) lane.bumps.push(seen.s);
    }
    for (const stop of traffic.busStops) {
      if (stop.lane === lane.id) lane.stops.push({ at: projectOnLane(lane, stop.at).s, seconds: stop.seconds });
    }
    junctionBoxes.forEach((box, index) => {
      const through = laneThroughBox(lane, box);
      if (through) lane.junctions.push({ index, ...through });
    });
  }

  const random = seededRandom(0x7aff1c);
  const vehicles: Vehicle[] = [];
  for (const group of traffic.fleet) {
    const kind = layout.vehicles.kinds[group.kind];
    if (!kind) continue;
    const size = vehicleSize(kind.look, layout.models);
    const groupLanes = lanes.filter((candidate) => group.lanes.includes(candidate.id));
    for (let index = 0; index < group.count; index++) {
      const lane = lanes.find((candidate) => candidate.id === group.lanes[index % group.lanes.length]);
      if (!lane) continue;
      vehicles.push({
        id: vehicles.length,
        kind: group.kind,
        lane,
        lanes: groupLanes,
        nextLane: index % Math.max(1, groupLanes.length),
        s: 0,
        speed: 0,
        cruise: kind.speed * (0.9 + random() * 0.2),
        ...size,
        stopsAtBusStops: kind.stopsAtBusStops,
        hash: random(),
        parked: false,
        pausedUntil: 0,
        served: new Set<number>(),
      });
    }
  }
  // Spread each lane's vehicles out along it, in a random order, so the street starts busy.
  for (const lane of lanes) {
    const onLane = vehicles.filter((vehicle) => vehicle.lane === lane).sort(() => random() - 0.5);
    onLane.forEach((vehicle, index) => {
      vehicle.s = ((index + 0.3 + random() * 0.4) / onLane.length) * lane.length;
      vehicle.speed = vehicle.cruise;
    });
  }
  return { lanes, vehicles, junctions: createJunctions(junctionBoxes.length), time: 0 };
}

/** A vehicle's half length (along its travel) and half width, measured from its model. */
export function vehicleSize(
  look: DistrictLayout["vehicles"]["kinds"][string]["look"],
  models: DistrictLayout["models"],
): { halfLength: number; halfWidth: number } {
  const model = models[look.model];
  // Models face +z, so their depth is their length.
  return model ? { halfLength: model.halfDepth * look.scale, halfWidth: model.halfWidth * look.scale } : { halfLength: 2, halfWidth: 1 };
}

/** Where roads cross: the overlap of every pair of road strips. */
export function roadOverlaps(roads: readonly Box[]): Box[] {
  const overlaps: Box[] = [];
  roads.forEach((a, i) => {
    roads.slice(i + 1).forEach((b) => {
      const minX = Math.max(a.x - a.halfWidth, b.x - b.halfWidth);
      const maxX = Math.min(a.x + a.halfWidth, b.x + b.halfWidth);
      const minZ = Math.max(a.z - a.halfDepth, b.z - b.halfDepth);
      const maxZ = Math.min(a.z + a.halfDepth, b.z + b.halfDepth);
      if (minX < maxX && minZ < maxZ) {
        overlaps.push({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, halfWidth: (maxX - minX) / 2, halfDepth: (maxZ - minZ) / 2 });
      }
    });
  });
  return overlaps;
}

/**
 * Moves every vehicle on by `dt` seconds. `share(kind)` is how much of that
 * kind should be out now (time of day times adaptive quality).
 */
export function stepTraffic(world: TrafficWorld, dt: number, player: Point, share: (kind: string) => number): void {
  world.time += dt;
  // Each lane's list is made once and only re-sorted in place, never rebuilt: new arrays every
  // frame feed the garbage collector, whose pauses show as hitches on a phone.
  const byLane = lanesByVehicle(world);
  for (const lane of world.lanes) {
    const onLane = byLane.get(lane);
    if (!onLane) continue;
    // Leaders first, so each follower sees where the vehicle ahead has got to.
    onLane.sort(leaderFirst);
    let leader: Vehicle | undefined;
    for (const vehicle of onLane) {
      if (vehicle.parked) continue;
      stepVehicle(world, vehicle, leader, dt, player);
      if (!vehicle.parked) leader = vehicle;
    }
  }
  // After the moves, so a vehicle that parked this frame comes back on the next at the earliest.
  for (const vehicle of world.vehicles) {
    if (vehicle.parked) tryToRejoin(world, vehicle, byLane, share(vehicle.kind));
  }
}

const leaderFirst = (a: Vehicle, b: Vehicle): number => b.s - a.s;

/**
 * A parked vehicle comes back on, when the hour's share wants it out, at the
 * start of the window on one of its lanes whose start is clear.
 */
function tryToRejoin(world: TrafficWorld, vehicle: Vehicle, byLane: Map<Lane, Vehicle[]>, share: number): void {
  if (vehicle.hash >= share || vehicle.parkedAt === world.time) return;
  const lanes = vehicle.lanes ?? [vehicle.lane];
  const first = vehicle.nextLane ?? 0;
  for (let tried = 0; tried < lanes.length; tried++) {
    const lane = lanes[(first + tried) % lanes.length] as Lane;
    if (!inWindow(lane)) continue;
    const entry = lane.windowFrom;
    const onLane = byLane.get(lane) ?? [];
    const startClear = onLane.every(
      (other) =>
        other === vehicle ||
        other.parked ||
        other.s - other.halfLength - entry > 2 * vehicle.halfLength + QUEUE_GAP ||
        other.s + other.halfLength < entry - vehicle.halfLength,
    );
    if (!startClear) continue;
    if (lane !== vehicle.lane) {
      const old = byLane.get(vehicle.lane);
      old?.splice(old.indexOf(vehicle), 1);
      onLane.push(vehicle);
      byLane.set(lane, onLane);
      vehicle.lane = lane;
    }
    vehicle.nextLane = (first + tried + 1) % lanes.length;
    vehicle.parked = false;
    vehicle.s = entry;
    vehicle.speed = vehicle.cruise * 0.6;
    vehicle.served.clear();
    return;
  }
}

/** Reused by `stepVehicle` every frame, rather than a new object per vehicle. */
const SEEN = { s: 0, lateral: 0 };

export function stepVehicle(
  world: TrafficWorld,
  vehicle: Vehicle,
  leader: Vehicle | undefined,
  dt: number,
  player: Point,
): void {
  const { lane } = vehicle;
  const front = vehicle.s + vehicle.halfLength;
  let limit = Number.POSITIVE_INFINITY;

  if (leader) limit = Math.min(limit, leader.s - leader.halfLength - QUEUE_GAP - vehicle.halfLength);

  // The player standing in its path: stop short of them.
  const seen = projectOnLane(lane, player, SEEN);
  const ahead = seen.s - front;
  if (seen.lateral < vehicle.halfWidth + PLAYER_RADIUS + PLAYER_SIDE_ROOM && ahead > -vehicle.halfLength && ahead < PLAYER_LOOKAHEAD) {
    limit = Math.min(limit, seen.s - PLAYER_RADIUS - PLAYER_ROOM - vehicle.halfLength);
  }

  // Junctions: register on entering, release on leaving, and wait at the line when the other direction has it.
  for (const crossing of lane.junctions) {
    const junction = world.junctions[crossing.index];
    if (!junction) continue;
    const inside = junction.inside.has(vehicle.id);
    if (inside && vehicle.s - vehicle.halfLength > crossing.exit) {
      junction.inside.delete(vehicle.id);
      if (junction.inside.size === 0) junction.axis = null;
    } else if (!inside && front < crossing.enter && front > crossing.enter - (vehicle.halfLength + PLAYER_LOOKAHEAD)) {
      const other = lane.axis === "x" ? "z" : "x";
      const otherWaiting = junction.waitingSince[other];
      const fairToGo =
        junction.axis === null ||
        (junction.axis === lane.axis && (otherWaiting === null || world.time - otherWaiting < JUNCTION_FAIRNESS_SECONDS));
      if (fairToGo && front + vehicle.speed * dt >= crossing.enter - JUNCTION_WAIT_ROOM) {
        junction.inside.add(vehicle.id);
        junction.axis = lane.axis;
        junction.waitingSince[lane.axis] = null;
      } else if (!fairToGo) {
        junction.waitingSince[lane.axis] ??= world.time;
        limit = Math.min(limit, crossing.enter - JUNCTION_WAIT_ROOM - vehicle.halfLength);
      }
    }
  }

  // A danfo stops at each bus stop on its lane once per run.
  if (vehicle.stopsAtBusStops) {
    for (const stop of lane.stops) {
      if (vehicle.served.has(stop.at)) continue;
      if (vehicle.s >= stop.at - BUS_STOP_REACH) {
        vehicle.served.add(stop.at);
        vehicle.pausedUntil = world.time + stop.seconds;
      } else if (stop.at - vehicle.s < vehicle.halfLength + PLAYER_LOOKAHEAD * 2) {
        limit = Math.min(limit, stop.at);
      }
    }
  }
  if (world.time < vehicle.pausedUntil) limit = Math.min(limit, vehicle.s);

  let target = vehicle.cruise;
  if (lane.bumps.some((bump) => bump - front < BUMP_SLOW_BEFORE && vehicle.s - vehicle.halfLength - bump < BUMP_SLOW_AFTER)) {
    target = Math.min(target, BUMP_SPEED);
  }
  vehicle.speed =
    vehicle.speed < target ? Math.min(target, vehicle.speed + ACCELERATION * dt) : Math.max(target, vehicle.speed - BRAKING * dt);
  // Never faster than it could still stop in before the limit.
  const room = Math.max(0, limit - vehicle.s);
  vehicle.speed = Math.min(vehicle.speed, Math.sqrt(2 * BRAKING * room));

  const next = vehicle.s + vehicle.speed * dt;
  if (next > limit) {
    vehicle.s = Math.max(vehicle.s, limit);
    vehicle.speed = 0;
  } else {
    vehicle.s = next;
  }

  // Out of the simulation window (or off the end of the lane): park, out of sight, until it can rejoin.
  if (vehicle.s - vehicle.halfLength > lane.windowTo || vehicle.s + vehicle.halfLength < lane.windowFrom - vehicle.halfLength) {
    for (const junction of world.junctions) {
      if (junction.inside.delete(vehicle.id) && junction.inside.size === 0) junction.axis = null;
    }
    // Parked: it comes back at the start of a window once the schedule wants it out and the start is clear.
    vehicle.parked = true;
    vehicle.parkedAt = world.time;
    vehicle.speed = 0;
  }
}

/**
 * How much of the traffic (or of the people) is out at a local hour: the
 * schedule's night share in the quiet hours, all of a rush kind at rush
 * hours, the day share otherwise.
 */
export function activeShare(schedule: TrafficSchedule, hour: number, rushHourBoost: boolean): number {
  const h = ((hour % 24) + 24) % 24;
  const quiet =
    schedule.quietFrom > schedule.quietUntil
      ? h >= schedule.quietFrom || h < schedule.quietUntil
      : h >= schedule.quietFrom && h < schedule.quietUntil;
  if (quiet) return schedule.nightShare;
  const rush = schedule.rushHours.some((window) => h >= window.from && h < window.to);
  return rush && rushHourBoost ? schedule.rushShare : schedule.dayShare;
}
