import {
  type ChunkContent,
  type DistrictConfig,
  type DistrictHeader,
  type DistrictLayout,
  type Interactable,
  type LayoutCatalogs,
  type Obstacles,
  type Point,
  type RideKind,
  type Road,
  type Route,
  buildDistrictLayout,
  districtHeader,
  districtObstacles,
  moveWithCollisions,
  obstacleGrid,
  routeBetween,
  splitIntoChunks,
} from "@japalife/shared";

const rideKey = (rideId: string, from: string, to: string): string => `${rideId}:${from}:${to}`;

/**
 * The roads a kind of ride may use: danfos keep to the main roads; okadas keep
 * off them (commercial okada is banned on Lagos Mainland, so riders use the
 * inner streets), crossing a main road only at a junction.
 */
export function rideRoads(roads: readonly Road[], kind: RideKind): Road[] {
  return roads.filter((road) => (kind === "danfo" ? road.class === "main" : road.class === "inner"));
}

/** A district's walkable area and the things in it, with the geometry checks the server needs. */
export class DistrictMap {
  /** The whole district: the config and what it uses from the content catalogs. */
  readonly layout: DistrictLayout;
  /** What the client gets on join: the layout less what travels in chunks. */
  readonly header: DistrictHeader;
  /** The buildings, props and NPCs by chunk, sent to each player as they walk (`ChunkStream`). */
  readonly chunks: ReadonlyMap<string, ChunkContent>;
  /** Every ride's road path between each pair of its stops, worked out once (`rideRoute`). */
  private readonly ridePaths = new Map<string, { kind: RideKind; path: Route }>();
  /** Everything that stops a player: the same list the client predicts with. */
  private readonly obstacles: Obstacles;

  constructor(
    readonly config: DistrictConfig,
    catalogs: LayoutCatalogs,
  ) {
    this.layout = buildDistrictLayout(config, catalogs);
    this.header = districtHeader(this.layout);
    this.chunks = splitIntoChunks(this.layout);
    this.obstacles = obstacleGrid(districtObstacles(this.layout));
    for (const ride of config.rides) {
      const roads = rideRoads(config.roads, ride.kind);
      for (const from of ride.stops) {
        for (const to of ride.stops) {
          const a = this.byId(from);
          const b = this.byId(to);
          if (from === to || !a || !b) continue;
          const path = routeBetween(roads, a.position, b.position);
          if (path) this.ridePaths.set(rideKey(ride.id, from, to), { kind: ride.kind, path });
        }
      }
    }
  }

  /** The road path of a ride from one of its stops to another, or undefined if it does not go there. */
  rideRoute(rideId: string, from: string, to: string): { kind: RideKind; path: Route } | undefined {
    return this.ridePaths.get(rideKey(rideId, from, to));
  }

  /** Every ride from a stop: where each goes, and its path. */
  ridesFrom(stopId: string): { rideId: string; kind: RideKind; to: Interactable; path: Route }[] {
    return this.config.rides.flatMap((ride) =>
      ride.stops.flatMap((to) => {
        const route = this.rideRoute(ride.id, stopId, to);
        const place = this.byId(to);
        return route && place ? [{ rideId: ride.id, kind: route.kind, to: place, path: route.path }] : [];
      }),
    );
  }

  get id(): string {
    return this.config.id;
  }

  get spawn(): { x: number; z: number } {
    return this.config.spawn;
  }

  /**
   * Walks from `from` by `delta`, stopping at buildings, props, standing NPCs
   * and the district edge. This is the shared function the client also runs to
   * predict its own walking, with the same obstacles.
   */
  move(from: Point, delta: Point): Point {
    return moveWithCollisions(from, delta, this.obstacles, this.config);
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
