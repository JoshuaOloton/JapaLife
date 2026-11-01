import { type Route, pathLength } from "@japalife/shared";
import type { ClientRide } from "./routeStore";

/** How a ride under way looks from the HUD: still waiting at the stop, or moving with this long to go. */
export type RideStage = { stage: "boarding" } | { stage: "moving"; leftMs: number };

/** `now` is the server's clock in ms, like the ride's times. */
export function rideStage(ride: ClientRide, now: number): RideStage {
  if (now < ride.startedAt + ride.boardingSeconds * 1000) return { stage: "boarding" };
  return { stage: "moving", leftMs: Math.max(0, ride.endsAt - now) };
}

/** The ride's road, drawn as the route on the street, the minimap and the map. */
export function rideRoute(ride: ClientRide): Route {
  return { points: ride.path, length: pathLength(ride.path) };
}

/**
 * Where the passenger sits on an okada: behind the rider, raised from the
 * ground-level "sit" pose (made for a bench) onto the seat. In the bike's own
 * frame, which faces +z.
 */
export const OKADA_SEAT = { back: 0.5, raise: 0.22 } as const;
