import type { NeedsConfig } from "@japalife/shared";
import { MS_PER_HOUR } from "./clock";

export interface Meters {
  hunger: number;
  energy: number;
}

export interface StoredMeters extends Meters {
  statsAt: Date;
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/**
 * The meters right now. Only the value at `statsAt` is stored; hunger drains and
 * energy regenerates with real elapsed time, so they keep moving while the
 * player is offline. Fractions are kept (the stored values are floats) so
 * frequent saves do not lose partial progress to rounding.
 */
export function metersAt(stored: StoredMeters, now: Date, needs: NeedsConfig): Meters {
  const hours = Math.max(0, now.getTime() - stored.statsAt.getTime()) / MS_PER_HOUR;
  return {
    hunger: clamp(stored.hunger - needs.hungerDecayPerHour * hours),
    energy: clamp(stored.energy + needs.energyRegenPerHour * hours),
  };
}

/** What the client sees: whole numbers, rounded down so 0 really means empty. */
export function displayMeters(meters: Meters): Meters {
  return { hunger: Math.floor(meters.hunger), energy: Math.floor(meters.energy) };
}
