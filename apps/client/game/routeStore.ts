"use client";

import type { Route } from "@japalife/shared";
import { useSyncExternalStore } from "react";

/**
 * The route picked on the map, kept outside React's state on purpose. As
 * state at the top of the game it re-rendered the whole 3D scene every time a
 * route was picked (a half-second freeze on the vivo Y29); here only what
 * draws it (the street strip, the minimap, the map) hears about it.
 */
export class RouteStore {
  private route: Route | null = null;
  private readonly listeners = new Set<() => void>();

  get = (): Route | null => this.route;

  set(route: Route | null): void {
    if (route === this.route) return;
    this.route = route;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** The current route, re-rendering only the component that asks. */
export function useRoute(store: RouteStore): Route | null {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
