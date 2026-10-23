"use client";

import { useSyncExternalStore } from "react";

/**
 * A value kept outside React's state on purpose (the route picked on the map,
 * the ride under way). As state at the top of the game, a change re-rendered
 * the whole 3D scene (a half-second freeze on the vivo Y29); here only what
 * subscribes hears about it, and the frame loop reads it with `get`.
 */
export class Store<T> {
  private readonly listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  set(value: T): void {
    if (value === this.value) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

/** The store's value, re-rendering only the component that asks. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
