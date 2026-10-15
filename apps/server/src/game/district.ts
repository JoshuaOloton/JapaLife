import type { DistrictConfig, Interactable } from "@japalife/shared";

/** A district's walkable area and the things in it, with the geometry checks the server needs. */
export class DistrictMap {
  constructor(readonly config: DistrictConfig) {}

  get id(): string {
    return this.config.id;
  }

  get spawn(): { x: number; z: number } {
    return this.config.spawn;
  }

  /** Keeps a position inside the walkable rectangle. */
  clamp(x: number, z: number): { x: number; z: number } {
    const { halfWidth, halfDepth } = this.config;
    return {
      x: Math.min(halfWidth, Math.max(-halfWidth, x)),
      z: Math.min(halfDepth, Math.max(-halfDepth, z)),
    };
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
