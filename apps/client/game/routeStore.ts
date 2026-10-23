"use client";

import type { Route, RideKind } from "@japalife/shared";
import { Store, useStore } from "./store";

/** The route picked on the map (or the ride's road while riding): drawn on the street, the minimap and the map. */
export class RouteStore extends Store<Route | null> {
  constructor() {
    super(null);
  }
}

/** The current route, re-rendering only the component that asks. */
export function useRoute(store: RouteStore): Route | null {
  return useStore(store);
}

/** A ride under way, as the client draws it: the server's numbers, with times in ms on the server clock. */
export interface ClientRide {
  kind: RideKind;
  toLabel: string;
  path: { x: number; z: number }[];
  startedAt: number;
  arrivesAt: number;
  endsAt: number;
  boardingSeconds: number;
  speed: number;
  stopsAtMetres: number;
}

/** The player's ride under way, or null. Read every frame by the player; set from the server's `ride` messages. */
export class RideStore extends Store<ClientRide | null> {
  constructor() {
    super(null);
  }
}
