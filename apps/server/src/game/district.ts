import { type DistrictConfig, type Interactable, type Point, moveWithCollisions } from "@japalife/shared";

/** A district's walkable area and the things in it, with the geometry checks the server needs. */
export class DistrictMap {
  constructor(readonly config: DistrictConfig) {}

  get id(): string {
    return this.config.id;
  }

  get spawn(): { x: number; z: number } {
    return this.config.spawn;
  }

  /**
   * Walks from `from` by `delta`, stopping at buildings and the district edge.
   * This is the shared function the client also runs to predict its own walking.
   */
  move(from: Point, delta: Point): Point {
    return moveWithCollisions(from, delta, this.config.buildings, this.config);
  }

  byId(targetId: string): Interactable | undefined {
    return this.config.interactables.find((thing) => thing.id === targetId);
  }

  /** The nearest thing within interact range that passes `accept`, if any. */
  nearest(
    position: { x: number; z: number },
    accept: (thing: Interactable) => boolean = () => true,
  ): Interactable | undefined {
    let best: Interactable | undefined;
    let bestDistance = this.config.interactRadius;
    for (const thing of this.config.interactables) {
      if (!accept(thing)) continue;
      const distance = Math.hypot(thing.position.x - position.x, thing.position.z - position.z);
      if (distance <= bestDistance) {
        best = thing;
        bestDistance = distance;
      }
    }
    return best;
  }
}
