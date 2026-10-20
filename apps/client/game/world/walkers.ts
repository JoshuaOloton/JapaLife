import type { Appearance, CharacterCatalog, DistrictLayout, Point } from "@japalife/shared";
import { seededRandom } from "./paint";
import { type Lane, buildLane, pointOnLane } from "./trafficSim";

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

/** Where a walker stands and which way they face. */
export function walkerPose(walker: Walker): { x: number; z: number; heading: number } {
  const point = pointOnLane(walker.path, walker.s);
  return { ...point, heading: walker.direction === 1 ? point.heading : point.heading + Math.PI };
}

export function stepWalker(walker: Walker, dt: number, player: Point, share: number): void {
  const here = walkerPose(walker);
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
