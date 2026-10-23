import { Prisma } from "@japalife/db";
import {
  type Point,
  type RideKind,
  type RideMessage,
  type RideOption,
  type RideTiming,
  fill,
  pointAlongPath,
  rideFare,
} from "@japalife/shared";
import { InsufficientFundsError } from "../economy/money";
import type { GameDeps } from "./deps";
import type { DistrictMap } from "./district";
import type { InboxService } from "./inbox";
import { type Outcome, reject } from "./outcome";

/** An unpaid claim older than this was left by a crash between claiming and charging: it never started. */
const ABANDONED_CLAIM_MS = 60_000;
/** Where along the route the task force stops an okada, as a share of its length: [earliest, latest]. */
const TASK_FORCE_STOP: readonly [number, number] = [0.35, 0.75];

/** A paid ride under way, as the room moves the rider and the client draws it. */
export interface ActiveRide extends RideTiming {
  id: string;
  playerId: string;
  kind: RideKind;
  toLabel: string;
  arrivesAt: Date;
  endsAt: Date;
  stoppedEarly: boolean;
  /** Where the ride leaves the player: the stop, or where the task force stopped it. */
  endPoint: Point;
}

/**
 * Paid danfo and okada rides between stops (Slice 11i). The fare is a sink
 * (`transport`) taken through the wallet; the ride is a row the room moves the
 * player along, from the server clock, so it carries on while they are offline.
 *
 * Taking a ride claims a row first (its unique `activeKey` allows one live
 * ride per player), then charges the fare with a key from the row's id, then
 * marks it paid. If the charge fails the claim is removed: no money, no ride.
 */
export class RideService {
  constructor(
    private readonly deps: GameDeps,
    private readonly inbox: InboxService,
  ) {}

  /** What can be taken from a stop: each destination with the server's fare and about how long it takes. */
  options(district: DistrictMap, stopId: string): RideOption[] {
    const { transport } = this.deps.content.ngn;
    return district.ridesFrom(stopId).map(({ rideId, kind, to, path }) => ({
      rideId,
      kind,
      toStop: to.id,
      toLabel: to.label,
      // Safe as a number: a fare is far below the balance cap.
      fareKobo: Number(rideFare(kind, transport, path.length)),
      seconds: Math.round(this.boardingSeconds(kind) + path.length / this.speed(kind)),
    }));
  }

  /** Takes a ride: claims it, charges the fare, and returns it under way. */
  async take(
    playerId: string,
    district: DistrictMap,
    rideId: string,
    from: string,
    to: string,
    now: Date,
  ): Promise<Outcome<{ ride: ActiveRide }>> {
    const { db, wallet, content, rng } = this.deps;
    const route = district.rideRoute(rideId, from, to);
    const destination = district.byId(to);
    if (!route || !destination) return reject("no_ride");

    // Anything finished meanwhile frees the player; a crash's unpaid claim is cleared once it is old.
    await this.finishDue(playerId, now);
    await db.playerRide.deleteMany({
      where: { playerId, paidAt: null, startedAt: { lt: new Date(now.getTime() - ABANDONED_CLAIM_MS) } },
    });

    const { kind, path } = route;
    const speed = this.speed(kind);
    const boardingSeconds = this.boardingSeconds(kind);
    const fare = rideFare(kind, content.ngn.transport, path.length);
    // The task force stops some okada rides partway. The dice are the server's.
    const stopped = kind === "okada" && rng() < content.ngn.transport.okadaTaskForceChance;
    const stopsAtMetres = stopped
      ? path.length * (TASK_FORCE_STOP[0] + rng() * (TASK_FORCE_STOP[1] - TASK_FORCE_STOP[0]))
      : path.length;
    const after = (metres: number): Date => new Date(now.getTime() + (boardingSeconds + metres / speed) * 1000);

    let claim;
    try {
      claim = await db.playerRide.create({
        data: {
          playerId,
          rideId,
          kind,
          fromStop: from,
          toStop: to,
          fareKobo: fare,
          path: path.points.map(({ x, z }) => ({ x, z })),
          speed,
          boardingSeconds,
          stopsAtMetres,
          stoppedEarly: stopped,
          startedAt: now,
          arrivesAt: after(path.length),
          endsAt: after(stopsAtMetres),
          activeKey: playerId,
        },
      });
    } catch (error) {
      // The unique `activeKey`: this player already has a ride.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return reject("already_riding");
      throw error;
    }

    try {
      await wallet.debit({
        playerId,
        currency: "NGN",
        amount: fare,
        reason: "transport",
        // From the ride: a retried charge for the same ride never pays twice.
        reference: `ride:${playerId}:${claim.id}`,
      });
    } catch (error) {
      await db.playerRide.delete({ where: { id: claim.id } });
      if (error instanceof InsufficientFundsError) return reject("insufficient_funds");
      throw error;
    }
    const paid = await db.playerRide.update({ where: { id: claim.id }, data: { paidAt: now } });
    return { ok: true, ride: toActiveRide(paid, destination.label) };
  }

  /** The player's paid ride that has not been finished, if any (it may already be past its end). */
  async current(playerId: string, district: DistrictMap): Promise<ActiveRide | null> {
    const row = await this.deps.db.playerRide.findFirst({ where: { playerId, finishedAt: null, paidAt: { not: null } } });
    return row ? toActiveRide(row, district.byId(row.toStop)?.label ?? row.toStop) : null;
  }

  /**
   * Ends a ride, once: the first caller finishes it (a conditional update), any
   * other finds it done. A ride the task force stopped tells the player why.
   * Returns whether this call finished it.
   */
  async finish(ride: ActiveRide, now: Date): Promise<boolean> {
    const { count } = await this.deps.db.playerRide.updateMany({
      where: { id: ride.id, finishedAt: null },
      data: { finishedAt: now, activeKey: null },
    });
    if (count === 0) return false;
    if (ride.stoppedEarly) {
      const copy = this.deps.content.copy.notices;
      await this.inbox.deliver(
        ride.playerId,
        { kind: "ride", title: copy.taskForceTitle, message: fill(copy.taskForce, { place: ride.toLabel }) },
        now,
      );
    }
    return true;
  }

  /** Finishes every ride of the player's that has reached its end. */
  private async finishDue(playerId: string, now: Date): Promise<void> {
    const due = await this.deps.db.playerRide.findMany({
      where: { playerId, finishedAt: null, paidAt: { not: null }, endsAt: { lte: now } },
    });
    for (const row of due) await this.finish(toActiveRide(row, row.toStop), now);
  }

  private speed(kind: RideKind): number {
    return this.deps.content.vehicles.kinds[kind]?.speed ?? 6;
  }

  private boardingSeconds(kind: RideKind): number {
    return kind === "danfo" ? this.deps.content.ngn.transport.danfoBoardingSeconds : 0;
  }
}

type RideRow = Prisma.PlayerRideGetPayload<object>;

function toActiveRide(row: RideRow, toLabel: string): ActiveRide {
  const path = (row.path as { x: number; z: number }[]).map(({ x, z }) => ({ x, z }));
  const { x, z } = pointAlongPath(path, row.stopsAtMetres);
  return {
    id: row.id,
    playerId: row.playerId,
    kind: row.kind as RideKind,
    toLabel,
    path,
    startedAt: row.startedAt.getTime(),
    boardingSeconds: row.boardingSeconds,
    speed: row.speed,
    stopsAtMetres: row.stopsAtMetres,
    arrivesAt: row.arrivesAt,
    endsAt: row.endsAt,
    stoppedEarly: row.stoppedEarly,
    endPoint: { x, z },
  };
}

/** What the client is told about a ride (or that there is none). */
export function rideMessage(ride: ActiveRide | null): RideMessage {
  if (!ride) return { ride: null };
  return {
    ride: {
      kind: ride.kind,
      toLabel: ride.toLabel,
      path: [...ride.path],
      startedAt: new Date(ride.startedAt).toISOString(),
      arrivesAt: ride.arrivesAt.toISOString(),
      endsAt: ride.endsAt.toISOString(),
      boardingSeconds: ride.boardingSeconds,
      speed: ride.speed,
      stopsAtMetres: ride.stopsAtMetres,
    },
  };
}
