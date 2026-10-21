import {
  type Box,
  type Building,
  type DistrictConfig,
  type HalfSize,
  type Interactable,
  type LayoutCatalogs,
  type Landmark,
  NPC_HALF_SIZE,
  type Npc,
  type Prop,
  type QuarterTurn,
  type Road,
  type RoadClass,
  type Traffic,
  propBlockSize,
  propFootprint,
  seededRandom,
  turnHalfSize,
} from "@japalife/shared";
import type { BuildingType, DistrictPlan, Street } from "./plan";

/**
 * Turns a district plan into the district the game plays: roads from the
 * streets, buildings along every street front, electric poles with wires,
 * speed bumps, trees, traffic lanes and walkways, plus the hand-placed
 * landmarks copied as written. Seeded, so the same plan always gives the same
 * district. It only places things where the content check will accept them
 * (off roads, clear of each other, inside the edge); `pnpm city` still runs
 * the full check on the result.
 */

/** Electric poles stand this far outside the road edge, metres. */
const POLE_FROM_ROAD = 1.6;
const POLE_SPACING = 30;
/** Poles and bumps keep this far from a crossing road's edge, metres. */
const CROSSING_CLEARANCE = 3;
/** Generated buildings and props keep this far from every road edge (the gutters are within 1.15 m). */
const ROAD_CLEARANCE = 2.2;
/** Least space between a generated thing and anything else, metres. */
const SPACING = 0.6;
/** How far inside the district edge things stop, metres. */
const EDGE_MARGIN = 0.5;
/** Lanes run this far past the district edge, so traffic arrives off-screen. */
const LANE_RUN_OUT = 15;
/** Walkways run this far in from the road edge, on the tar, as Lagos people walk. */
const WALKWAY_IN_FROM_EDGE = 0.4;
/** Space left between neighbouring buildings, metres: [smallest, largest]. */
const BUILDING_GAP: readonly [number, number] = [1.5, 5];
/** How often a labelled kind of shop gets its name painted on (the rest face the street unlabelled). */
const LABEL_CHANCE = 0.5;
/** How far a speed bump sits from the junction it slows traffic for, metres. */
const BUMP_FROM_JUNCTION = 12;

const POLE_KIND = "electric-pole";
const BUMP_KIND = "speed-bump";
const GENERATOR_KIND = "generator";

type Catalogs = Pick<LayoutCatalogs, "models" | "propKinds">;

/** Two decimals: keeps the file small, and positions rounded before they are checked. */
const round = (value: number): number => Math.round(value * 100) / 100;
/** Rounds a model's size up, so the footprint always covers the model. */
const roundUp = (value: number): number => Math.ceil(value * 100 - 1e-9) / 100;

/** A street's own frame: `u` runs along it, `v` across it. */
interface Frame {
  street: Street;
  halfWidth: number;
  from: number;
  to: number;
}

/** A box given in a street's frame, turned into the world's x and z. */
function worldBox(street: Street, u: number, v: number, halfU: number, halfV: number): Box {
  return street.axis === "ew"
    ? { x: u, z: v, halfWidth: halfU, halfDepth: halfV }
    : { x: v, z: u, halfWidth: halfV, halfDepth: halfU };
}

/** Half sizes in the world, turned into a street's frame. */
function localSize(street: Street, size: HalfSize): { halfU: number; halfV: number } {
  return street.axis === "ew"
    ? { halfU: size.halfWidth, halfV: size.halfDepth }
    : { halfU: size.halfDepth, halfV: size.halfWidth };
}

/** The quarter turn that points a model's front (+z) at the street, from side -1 (north or west) or +1. */
function facingStreet(street: Street, side: number): QuarterTurn {
  if (street.axis === "ew") return side < 0 ? 0 : 180;
  return side < 0 ? 90 : 270;
}

const overlaps = (a: Box, b: Box, gap: number): boolean =>
  Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth + gap && Math.abs(a.z - b.z) < a.halfDepth + b.halfDepth + gap;

/** Everything placed so far, bucketed by position so each new placement checks only its neighbours. */
class Occupancy {
  private readonly cells = new Map<string, Box[]>();
  private static readonly CELL = 16;

  add(box: Box): void {
    this.forCells(box, 0, (key) => {
      const cell = this.cells.get(key);
      if (cell) cell.push(box);
      else this.cells.set(key, [box]);
      return false;
    });
  }

  overlaps(box: Box, gap: number): boolean {
    return this.forCells(box, gap, (key) => (this.cells.get(key) ?? []).some((other) => overlaps(box, other, gap)));
  }

  private forCells(box: Box, gap: number, visit: (key: string) => boolean): boolean {
    const cell = Occupancy.CELL;
    for (let cx = Math.floor((box.x - box.halfWidth - gap) / cell); cx <= Math.floor((box.x + box.halfWidth + gap) / cell); cx++) {
      for (let cz = Math.floor((box.z - box.halfDepth - gap) / cell); cz <= Math.floor((box.z + box.halfDepth + gap) / cell); cz++) {
        if (visit(`${cx},${cz}`)) return true;
      }
    }
    return false;
  }
}

export function generateDistrict(plan: DistrictPlan, catalogs: Catalogs): DistrictConfig {
  const random = seededRandom(plan.seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const between = ([low, high]: readonly [number, number]): number => low + random() * (high - low);

  const frames: Frame[] = plan.streets.map((street) => {
    const half = street.axis === "ew" ? plan.halfWidth : plan.halfDepth;
    return {
      street,
      halfWidth: plan.classes[street.class].halfWidth,
      from: street.from ?? -half,
      to: street.to ?? half,
    };
  });
  const roadBoxes: Box[] = frames.map(({ street, halfWidth, from, to }) =>
    worldBox(street, (from + to) / 2, street.at, (to - from) / 2, halfWidth),
  );
  const roads: Road[] = frames.map(({ street }, index) => {
    const box = roadBoxes[index] as Box;
    return {
      x: box.x,
      z: box.z,
      halfWidth: box.halfWidth,
      halfDepth: box.halfDepth,
      colour: plan.roadColour,
      ...(street.name ? { name: street.name } : {}),
      class: street.class,
    };
  });

  // ---- Hand-placed landmarks, copied as written and moved to where they stand.
  const interactables: Interactable[] = [];
  const buildings: Building[] = [];
  const props: Prop[] = [];
  const npcs: Npc[] = [];
  const landmarks: Landmark[] = [];
  const reserved: Box[] = [];
  const taken = new Occupancy();
  const blockOf = (prop: Prop): HalfSize | undefined => {
    const kind = catalogs.propKinds[prop.kind];
    const size = kind ? propBlockSize(kind, catalogs.models) : undefined;
    return size ? turnHalfSize(size, prop.rotation) : undefined;
  };

  for (const landmark of plan.landmarks) {
    const at = { x: landmark.x, z: landmark.z };
    if (landmark.name) landmarks.push({ id: landmark.id, name: landmark.name, ...at });
    if (landmark.clear) reserved.push({ ...at, ...landmark.clear });
    for (const thing of landmark.interactables) {
      const position = { x: round(at.x + thing.position.x), z: round(at.z + thing.position.z) };
      interactables.push({ ...thing, position });
      // Keep the spot free, so nobody generated stands where the player must.
      taken.add({ ...position, halfWidth: 1, halfDepth: 1 });
    }
    for (const building of landmark.buildings) {
      const placed = { ...building, x: round(at.x + building.x), z: round(at.z + building.z) };
      buildings.push(placed);
      taken.add(placed);
    }
    for (const prop of landmark.props) {
      const placed = { ...prop, x: round(at.x + prop.x), z: round(at.z + prop.z) };
      props.push(placed);
      const block = blockOf(placed);
      if (block) taken.add({ x: placed.x, z: placed.z, ...block });
    }
    for (const npc of landmark.npcs) {
      const placed = { ...npc, x: round(at.x + npc.x), z: round(at.z + npc.z) };
      npcs.push(placed);
      taken.add({ x: placed.x, z: placed.z, halfWidth: NPC_HALF_SIZE, halfDepth: NPC_HALF_SIZE });
    }
  }

  const insideEdge = (box: Box): boolean =>
    Math.abs(box.x) + box.halfWidth <= plan.halfWidth - EDGE_MARGIN &&
    Math.abs(box.z) + box.halfDepth <= plan.halfDepth - EDGE_MARGIN;
  const nearRoad = (box: Box, clearance: number): boolean => roadBoxes.some((road) => overlaps(box, road, clearance));
  const inReserved = (box: Box): boolean => reserved.some((area) => overlaps(box, area, 0));
  const fits = (box: Box, roadClearance: number, spacing: number): boolean =>
    insideEdge(box) && !nearRoad(box, roadClearance) && !inReserved(box) && !taken.overlaps(box, spacing);

  /** Where a street is crossed by streets of the other axis, as ranges along it, widened by `clearance`. */
  const crossings = (frame: Frame, clearance: number): [number, number][] =>
    frames
      .filter((other) => other.street.axis !== frame.street.axis && other.from <= frame.street.at && frame.street.at <= other.to)
      .map((other) => [other.street.at - other.halfWidth - clearance, other.street.at + other.halfWidth + clearance] as [number, number])
      .sort((a, b) => a[0] - b[0]);

  /** The open runs of a street between its crossings. */
  const segments = (frame: Frame, clearance: number): [number, number][] => {
    const runs: [number, number][] = [];
    let start = frame.from + EDGE_MARGIN;
    for (const [gapStart, gapEnd] of crossings(frame, clearance)) {
      if (gapStart > start) runs.push([start, Math.min(gapStart, frame.to - EDGE_MARGIN)]);
      start = Math.max(start, gapEnd);
    }
    if (start < frame.to - EDGE_MARGIN) runs.push([start, frame.to - EDGE_MARGIN]);
    return runs;
  };

  // ---- Electric poles first, so the buildings keep clear of them.
  let poleRuns = 0;
  for (const frame of frames) {
    if (!plan.classes[frame.street.class].poles) continue;
    const { street } = frame;
    const block = blockOf({ kind: POLE_KIND, x: 0, z: 0, rotation: 0 }) ?? { halfWidth: 0.15, halfDepth: 0.15 };
    for (const side of [-1, 1]) {
      const v = street.at + side * (frame.halfWidth + POLE_FROM_ROAD);
      for (const [start, end] of segments(frame, CROSSING_CLEARANCE)) {
        const length = end - start;
        if (length < POLE_SPACING) continue;
        const count = Math.round(length / POLE_SPACING);
        let run: Prop[] = [];
        const finishRun = (): void => {
          if (run.length >= 2) {
            const wire = `${street.id}-${side < 0 ? "a" : "b"}-${poleRuns++}`;
            for (const pole of run) props.push({ ...pole, wire });
          }
          run = [];
        };
        for (let index = 0; index <= count; index++) {
          const u = round(start + (index * length) / count);
          // The cross arm runs across the road.
          const rotation: QuarterTurn = street.axis === "ew" ? 90 : 0;
          const { halfU, halfV } = localSize(street, turnHalfSize(block, rotation));
          const box = worldBox(street, u, round(v), halfU, halfV);
          if (fits(box, 0.3, 0.3)) {
            taken.add(box);
            run.push({ kind: POLE_KIND, x: box.x, z: box.z, rotation });
          } else {
            finishRun();
          }
        }
        finishRun();
      }
    }
  }

  // ---- Speed bumps, just before junctions on the streets that have them.
  for (const frame of frames) {
    if (!plan.classes[frame.street.class].bumps) continue;
    const { street } = frame;
    for (const [start, end] of segments(frame, 0)) {
      if (end - start < BUMP_FROM_JUNCTION * 4) continue;
      const u = round(start + BUMP_FROM_JUNCTION);
      const rotation: QuarterTurn = street.axis === "ew" ? 0 : 90;
      const spot = worldBox(street, u, street.at, 0.5, frame.halfWidth);
      if (!inReserved(spot)) props.push({ kind: BUMP_KIND, x: spot.x, z: spot.z, rotation });
    }
  }

  // ---- Buildings along every street front, big streets first so they get the corners.
  const order = ["main", "inner", "lane"] as const;
  const zoneMix = (point: { x: number; z: number }) =>
    plan.zones.find((zone) => Math.abs(point.x - zone.x) <= zone.halfWidth && Math.abs(point.z - zone.z) <= zone.halfDepth)?.mix;
  let labelIndex = 0;

  for (const roadClass of order) {
    for (const frame of frames) {
      if (frame.street.class !== roadClass) continue;
      const { street } = frame;
      const cls = plan.classes[roadClass];
      let built = 0;
      for (const side of [-1, 1]) {
        const front = street.at + side * (frame.halfWidth + cls.setback);
        let u = frame.from + EDGE_MARGIN;
        while (u < frame.to - EDGE_MARGIN) {
          const mix = zoneMix(worldBox(street, u, front + side * 3, 0, 0)) ?? cls.mix;
          const typeId = pickWeighted(mix, random);
          const type = plan.buildingTypes[typeId] as BuildingType;
          const facing = facingStreet(street, side);
          const shape = shapeOf(type, typeId, facing, street, catalogs, random, () => random() < LABEL_CHANCE);
          const centreU = round(u + shape.halfU);
          const centreV = round(front + side * shape.halfV);
          if (centreU + shape.halfU > frame.to - EDGE_MARGIN) break;
          const box = worldBox(street, centreU, centreV, shape.halfU, shape.halfV);
          if (!fits(box, ROAD_CLEARANCE, SPACING)) {
            u += 2;
            continue;
          }
          taken.add(box);
          if (shape.building) {
            buildings.push({
              id: `${street.id}-${built++}`,
              name: shape.building.name,
              x: box.x,
              z: box.z,
              halfWidth: box.halfWidth,
              halfDepth: box.halfDepth,
              height: shape.building.height,
              colour: pick(plan.colours),
              ...(shape.building.model ? { model: shape.building.model } : {}),
              rotation: shape.building.model ? facing : 0,
              scale: shape.building.scale,
            });
          } else if (shape.prop) {
            const label = shape.prop.labelled ? plan.shopLabels[labelIndex++ % plan.shopLabels.length] : undefined;
            props.push({ kind: shape.prop.kind, x: box.x, z: box.z, rotation: shape.prop.rotation, ...(label ? { label } : {}) });
          }

          // Now and then the gap to the next building gets a generator or a tree.
          const gap = between(BUILDING_GAP);
          const gapU = round(centreU + shape.halfU + gap / 2);
          const roll = random();
          if (gap >= 2.4 && roll < 0.3) {
            placeProp(GENERATOR_KIND, gapU, round(front + side * 1.2), facing, street, 0.3);
          } else if (gap >= 3.2 && roll < 0.55) {
            placeProp(pick(plan.scatter.kinds), gapU, round(front + side * 1), 0, street, 0.8);
          }
          u = centreU + shape.halfU + gap;
        }
      }
    }
  }

  function placeProp(kind: string, u: number, v: number, rotation: QuarterTurn, street: Street, spacing: number): void {
    const prop: Prop = { ...worldPoint(street, u, v), kind, rotation };
    const block = blockOf(prop);
    if (!block) return;
    const box = { x: prop.x, z: prop.z, ...block };
    if (!fits(box, ROAD_CLEARANCE, spacing)) return;
    taken.add(box);
    props.push({ kind, x: prop.x, z: prop.z, rotation });
  }

  // ---- Trees and palms on open ground.
  let planted = 0;
  for (let attempt = 0; attempt < plan.scatter.count * 6 && planted < plan.scatter.count; attempt++) {
    const kind = pick(plan.scatter.kinds);
    const x = round((random() * 2 - 1) * plan.halfWidth);
    const z = round((random() * 2 - 1) * plan.halfDepth);
    const block = blockOf({ kind, x, z, rotation: 0 });
    if (!block) continue;
    const box = { x, z, ...block };
    if (!fits(box, 3, 1.5)) continue;
    taken.add(box);
    props.push({ kind, x, z, rotation: 0 });
    planted++;
  }

  return {
    id: plan.id,
    name: plan.name,
    halfWidth: plan.halfWidth,
    halfDepth: plan.halfDepth,
    spawn: plan.spawn,
    interactRadius: plan.interactRadius,
    interactables,
    roads,
    buildings,
    props,
    npcs,
    landmarks,
    traffic: trafficFor(plan, frames),
  };
}

function worldPoint(street: Street, u: number, v: number): { x: number; z: number } {
  return street.axis === "ew" ? { x: u, z: v } : { x: v, z: u };
}

function pickWeighted(mix: DistrictPlan["classes"]["main"]["mix"], random: () => number): string {
  const total = mix.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of mix) {
    roll -= entry.weight;
    if (roll < 0) return entry.type;
  }
  return (mix.at(-1) as (typeof mix)[number]).type;
}

interface Shape {
  halfU: number;
  halfV: number;
  building?: { name: string; height: number; model?: string; scale: number };
  prop?: { kind: string; rotation: QuarterTurn; labelled: boolean };
}

/** How big one building type comes out, in the street's frame, and what to write for it. */
function shapeOf(
  type: BuildingType,
  typeId: string,
  facing: QuarterTurn,
  street: Street,
  { models, propKinds }: Catalogs,
  random: () => number,
  labelNow: () => boolean,
): Shape {
  const tenth = (value: number): number => Math.round(value * 10) / 10;
  if ("model" in type) {
    const model = models[type.model];
    if (!model) throw new Error(`building type "${typeId}" uses unknown model "${type.model}" (run pnpm assets?)`);
    const turned = turnHalfSize({ halfWidth: model.halfWidth * type.scale, halfDepth: model.halfDepth * type.scale }, facing);
    const size = { halfWidth: roundUp(turned.halfWidth), halfDepth: roundUp(turned.halfDepth) };
    return {
      ...localSize(street, size),
      building: { name: type.name, height: round(model.height * type.scale), model: type.model, scale: type.scale },
    };
  }
  if ("frontage" in type) {
    const pickIn = ([low, high]: readonly [number, number]): number => tenth(low + random() * (high - low));
    const halfU = pickIn(type.frontage) / 2;
    const halfV = pickIn(type.depth) / 2;
    return { halfU, halfV, building: { name: type.name, height: pickIn(type.height), scale: 1 } };
  }
  const kind = propKinds[type.prop];
  const footprint = kind ? propFootprint(kind, models) : undefined;
  if (!footprint) throw new Error(`building type "${typeId}" uses unknown prop kind "${type.prop}"`);
  // A painted name reads only on a prop facing +z (the camera always looks north).
  const labelled = type.labelled && labelNow();
  const rotation = labelled ? 0 : facing;
  return { ...localSize(street, turnHalfSize(footprint, rotation)), prop: { kind: type.prop, rotation, labelled } };
}

/** Two lanes on every street with traffic (driving on the right), walkways along the road edges. */
function trafficFor(plan: DistrictPlan, frames: readonly Frame[]): Traffic {
  const lanes: Traffic["lanes"] = [];
  const walkways: Traffic["pedestrians"]["walkways"] = [];
  const laneClass = new Map<string, RoadClass>();

  for (const { street, halfWidth, from, to } of frames) {
    const half = street.axis === "ew" ? plan.halfWidth : plan.halfDepth;
    const point = (u: number, v: number) => worldPoint(street, round(u), round(v));
    if (plan.classes[street.class].traffic) {
      const start = from <= -half ? from - LANE_RUN_OUT : from;
      const end = to >= half ? to + LANE_RUN_OUT : to;
      const offset = halfWidth / 2;
      // East and south run with growing u; on the right of the road means +v for them.
      const forward = street.axis === "ew" ? "east" : "south";
      const back = street.axis === "ew" ? "west" : "north";
      const forwardSide = street.axis === "ew" ? 1 : -1;
      lanes.push({ id: `${street.id}-${forward}`, points: [point(start, street.at + forwardSide * offset), point(end, street.at + forwardSide * offset)] });
      lanes.push({ id: `${street.id}-${back}`, points: [point(end, street.at - forwardSide * offset), point(start, street.at - forwardSide * offset)] });
      laneClass.set(`${street.id}-${forward}`, street.class);
      laneClass.set(`${street.id}-${back}`, street.class);

      const walkFrom = Math.max(from, -half + EDGE_MARGIN);
      const walkTo = Math.min(to, half - EDGE_MARGIN);
      const edge = halfWidth - WALKWAY_IN_FROM_EDGE;
      const [low, high] = street.axis === "ew" ? ["north", "south"] : ["west", "east"];
      walkways.push({ id: `${street.id}-${low}-edge`, points: [point(walkFrom, street.at - edge), point(walkTo, street.at - edge)] });
      walkways.push({ id: `${street.id}-${high}-edge`, points: [point(walkTo, street.at + edge), point(walkFrom, street.at + edge)] });
    } else {
      const walkFrom = Math.max(from, -half + EDGE_MARGIN);
      const walkTo = Math.min(to, half - EDGE_MARGIN);
      walkways.push({ id: `${street.id}-walk`, points: [point(walkFrom, street.at), point(walkTo, street.at)] });
    }
  }

  return {
    lanes,
    fleet: plan.traffic.fleet.map((group) => ({
      kind: group.kind,
      lanes: lanes.filter((lane) => group.classes.some((roadClass) => laneClass.get(lane.id) === roadClass)).map((lane) => lane.id),
      count: group.count,
    })),
    busStops: plan.traffic.busStops,
    pedestrians: { count: plan.traffic.pedestrians, walkways },
  };
}
