import { type Appearance, type Box, type CharacterCatalog, type DistrictLayout, type Point, seededRandom } from "@japalife/shared";
import { type Lane, type LanePoint, buildLane, clipLaneToBox, inWindow, pointOnLane } from "./trafficSim";

/**
 * People strolling the roadsides: cosmetic and client-only, like the traffic.
 * Each walks a walkway to its end and back at their own pace. They walk
 * through the player (nothing about them is solid) but pause when the player
 * stands right in front of them, and they only appear or leave (as the hour
 * changes) where the player is not looking. Pure, so it is unit-tested.
 */

/** Walking pace range, metres per second. */
const PACE = { min: 1.1, max: 1.5 } as const;
/** A walker pauses when the player is this close ahead of them, and this close to their line. */
const PAUSE_AHEAD = 1.2;
const PAUSE_SIDE = 0.6;
/** People only appear or leave this far from the player, so nobody pops in or out in plain view. */
const OUT_OF_SIGHT = 25;

export interface Walker {
  id: number;
  path: Lane;
  /** Every walkway: a walker leaving the simulation window comes back on whichever crosses it. Just `path` if left out. */
  paths?: readonly Lane[];
  /** Which of `paths` to try first next time, so walkers spread over the walkways. */
  nextPath?: number;
  /** Distance along the walkway. */
  s: number;
  /** +1 walking toward the walkway's end, -1 walking back. */
  direction: 1 | -1;
  pace: number;
  /** Fixed 0-1 number: out walking when it is below the hour's share. */
  hash: number;
  appearance: Appearance;
  /** Out on the street now. */
  shown: boolean;
  /** Walking this frame (false when paused for the player or not shown). */
  moving: boolean;
}

export function createWalkers(layout: Pick<DistrictLayout, "traffic" | "characters">): Walker[] {
  const people = layout.traffic?.pedestrians;
  if (!people || people.walkways.length === 0) return [];
  const paths = people.walkways.map((walkway) => buildLane(walkway.id, walkway.points));
  const random = seededRandom(0x9ed);
  return Array.from({ length: people.count }, (_, id) => {
    const path = paths[id % paths.length] as Lane;
    return {
      id,
      path,
      paths,
      nextPath: id % paths.length,
      s: random() * path.length,
      direction: random() < 0.5 ? 1 : -1,
      pace: PACE.min + random() * (PACE.max - PACE.min),
      hash: random(),
      appearance: randomStarterLook(layout.characters, random),
      shown: true,
      moving: true,
    };
  });
}

/** A random look from the free starter options, so the street shows off what the creator offers. */
export function randomStarterLook(catalog: CharacterCatalog, random: () => number): Appearance {
  const pick = (section: Readonly<Record<string, { starter: boolean }>>, fallback: string): string => {
    const ids = Object.entries(section)
      .filter(([, option]) => option.starter)
      .map(([id]) => id);
    return ids[Math.floor(random() * ids.length)] ?? fallback;
  };
  const { defaults } = catalog;
  return {
    body: pick(catalog.bodies, defaults.body),
    skinTone: pick(catalog.skinTones, defaults.skinTone),
    hair: pick(catalog.hairs, defaults.hair),
    hairColour: pick(catalog.hairColours, defaults.hairColour),
    outfit: pick(catalog.outfits, defaults.outfit),
    outfitColour: pick(catalog.outfitColours, defaults.outfitColour),
  };
}

/**
 * Simulates only the walkers in `box` around the player (`WALKER_REACH`):
 * each walkway's window becomes its stretch inside the box, and a walker who
 * walks out of it comes back at the edge of a walkway crossing it, walking in.
 * The first call spreads them through the window. Call it when the player
 * crosses into another area cell.
 */
export function setWalkerWindow(walkers: readonly Walker[], box: Box, random: () => number, first: boolean): void {
  const paths = walkers[0]?.paths ?? [];
  for (const path of paths) clipLaneToBox(path, box);
  if (!first) return;
  const open = paths.filter(inWindow);
  walkers.forEach((walker, index) => {
    const path = open[index % Math.max(1, open.length)];
    if (!path) return;
    walker.path = path;
    walker.s = path.windowFrom + random() * (path.windowTo - path.windowFrom);
  });
}

/** Puts a walker who left the window back at the edge of a walkway crossing it, walking inward. */
function rejoin(walker: Walker): boolean {
  const paths = walker.paths ?? [walker.path];
  const first = walker.nextPath ?? 0;
  for (let tried = 0; tried < paths.length; tried++) {
    const path = paths[(first + tried) % paths.length] as Lane;
    if (!inWindow(path)) continue;
    walker.nextPath = (first + tried + 1) % paths.length;
    walker.path = path;
    // Alternate which end they come in from, so both directions fill.
    walker.direction = walker.nextPath % 2 === 0 ? 1 : -1;
    walker.s = walker.direction === 1 ? path.windowFrom : path.windowTo;
    return true;
  }
  return false;
}

/** Where a walker stands and which way they face. `out` reuses an object in per-frame loops. */
export function walkerPose(walker: Walker, out: LanePoint = { x: 0, z: 0, heading: 0 }): LanePoint {
  pointOnLane(walker.path, walker.s, out);
  if (walker.direction === -1) out.heading += Math.PI;
  return out;
}

/** Reused by `stepWalker` every frame. */
const HERE: LanePoint = { x: 0, z: 0, heading: 0 };

export function stepWalker(walker: Walker, dt: number, player: Point, share: number): void {
  // Walked out of the simulation window (or it moved away from them): come back in at its edge, unseen.
  const { path } = walker;
  if (walker.s < path.windowFrom - 0.5 || walker.s > path.windowTo + 0.5) {
    if (!rejoin(walker)) {
      walker.moving = false;
      return;
    }
  }
  const here = walkerPose(walker, HERE);
  const playerDistance = Math.hypot(player.x - here.x, player.z - here.z);

  // Come out or go home only where the player cannot see it happen.
  const wanted = walker.hash < share;
  if (wanted !== walker.shown && playerDistance > OUT_OF_SIGHT) walker.shown = wanted;
  if (!walker.shown) {
    walker.moving = false;
    return;
  }

  // Pause for the player standing right in front of them.
  const forwardX = Math.sin(here.heading);
  const forwardZ = Math.cos(here.heading);
  const toX = player.x - here.x;
  const toZ = player.z - here.z;
  const ahead = toX * forwardX + toZ * forwardZ;
  const side = Math.abs(toX * forwardZ - toZ * forwardX);
  if (ahead > 0 && ahead < PAUSE_AHEAD && side < PAUSE_SIDE) {
    walker.moving = false;
    return;
  }

  walker.moving = true;
  walker.s += walker.direction * walker.pace * dt;
  if (walker.s >= walker.path.length) {
    walker.s = walker.path.length;
    walker.direction = -1;
  } else if (walker.s <= 0) {
    walker.s = 0;
    walker.direction = 1;
  }
}
