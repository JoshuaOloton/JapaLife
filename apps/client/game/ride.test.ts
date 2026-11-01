import { describe, expect, it } from "vitest";
import { rideRoute, rideStage } from "./ride";
import type { ClientRide } from "./routeStore";

const ride: ClientRide = {
  kind: "danfo",
  toLabel: "Sabo Bus Stop",
  path: [
    { x: 0, z: 0 },
    { x: 0, z: 30 },
    { x: 40, z: 30 },
  ],
  startedAt: 1_000_000,
  boardingSeconds: 6,
  speed: 7,
  stopsAtMetres: 70,
  arrivesAt: 1_000_000 + 16_000,
  endsAt: 1_000_000 + 16_000,
};

describe("rideStage", () => {
  it("is boarding until the danfo sets off, then counts down to the end", () => {
    expect(rideStage(ride, ride.startedAt)).toEqual({ stage: "boarding" });
    expect(rideStage(ride, ride.startedAt + 5_999)).toEqual({ stage: "boarding" });
    expect(rideStage(ride, ride.startedAt + 6_000)).toEqual({ stage: "moving", leftMs: 10_000 });
    expect(rideStage(ride, ride.endsAt + 5_000)).toEqual({ stage: "moving", leftMs: 0 });
  });
});

describe("rideRoute", () => {
  it("draws the ride's road with its length", () => {
    expect(rideRoute(ride)).toEqual({ points: ride.path, length: 70 });
  });
});
