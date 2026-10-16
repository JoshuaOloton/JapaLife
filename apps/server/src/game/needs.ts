import type { NeedsConfig } from "@japalife/shared";
import { type Interval, MS_PER_HOUR } from "./clock";

/** The player's meters. All 0-100 except the fuel, which is hours of generator running time. */
export interface Needs {
  hunger: number;
  energy: number;
  morale: number;
  generatorFuelHours: number;
}

export interface StoredNeeds extends Needs {
  statsAt: Date;
}

/** What else was going on between `statsAt` and now. Intervals may overlap or reach outside that span. */
export interface NeedsConditions {
  nights: Interval[];
  blackouts: Interval[];
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

/** Morale moves towards its resting level at a steady rate and stops there. */
export function moraleAfter(morale: number, hours: number, needs: NeedsConfig): number {
  const target = needs.moraleRestingLevel;
  const step = needs.moraleDriftPerHour * hours;
  return morale < target ? Math.min(target, morale + step) : Math.max(target, morale - step);
}

export const isLowMorale = (morale: number, needs: NeedsConfig): boolean => morale < needs.lowMorale.below;

/** Shift pay as a percent of the full rate, given the player's morale when the shift starts. */
export function shiftPayPercent(morale: number, needs: NeedsConfig): number {
  return isLowMorale(morale, needs) ? needs.lowMorale.shiftPayPercent : 100;
}

const covers = (intervals: Interval[], at: number): boolean =>
  intervals.some((interval) => interval.start.getTime() <= at && at < interval.end.getTime());

/**
 * The meters at `now`. Only the values at `statsAt` are stored; everything else
 * follows from elapsed real time, so the meters keep moving while the player is
 * offline. Hunger drains and morale drifts at steady rates. Energy's rate
 * changes along the way (night, power cuts, the generator's fuel, low morale),
 * so the elapsed time is cut into segments wherever a condition changes, and
 * each segment uses its own rate. Fractions are kept (the stored values are
 * floats) so frequent saves do not lose partial progress to rounding.
 */
export function needsAt(stored: StoredNeeds, now: Date, needs: NeedsConfig, conditions: NeedsConditions): Needs {
  const from = stored.statsAt.getTime();
  const to = now.getTime();
  if (to <= from) {
    return {
      hunger: clamp(stored.hunger),
      energy: clamp(stored.energy),
      morale: clamp(stored.morale),
      generatorFuelHours: stored.generatorFuelHours,
    };
  }
  const totalHours = (to - from) / MS_PER_HOUR;

  // Every moment a condition starts or stops is a segment boundary.
  const cuts = new Set<number>([from, to]);
  for (const interval of [...conditions.nights, ...conditions.blackouts]) {
    for (const edge of [interval.start.getTime(), interval.end.getTime()]) {
      if (edge > from && edge < to) cuts.add(edge);
    }
  }
  // So is the moment morale drifts across the low-morale line.
  const gap = needs.lowMorale.below - stored.morale;
  const towardsRest = needs.moraleRestingLevel - stored.morale;
  if (needs.moraleDriftPerHour > 0 && gap !== 0 && Math.sign(gap) === Math.sign(towardsRest) && Math.abs(gap) <= Math.abs(towardsRest)) {
    const crossing = from + (Math.abs(gap) / needs.moraleDriftPerHour) * MS_PER_HOUR;
    if (crossing < to) cuts.add(crossing);
  }
  const edges = [...cuts].sort((a, b) => a - b);

  let energy = stored.energy;
  let fuel = stored.generatorFuelHours;
  for (let i = 0; i + 1 < edges.length; i++) {
    const start = edges[i] as number;
    const end = edges[i + 1] as number;
    const hours = (end - start) / MS_PER_HOUR;
    const middle = (start + end) / 2;

    const moraleNow = moraleAfter(stored.morale, (middle - from) / MS_PER_HOUR, needs);
    const rate = needs.energyRegenPerHour * (isLowMorale(moraleNow, needs) ? needs.lowMorale.energyRegenPercent / 100 : 1);
    const dark = covers(conditions.nights, middle) && covers(conditions.blackouts, middle);

    if (!dark) {
      energy += rate * hours;
    } else {
      // The generator runs while it has fuel; after that the player sweats it out.
      const powered = Math.min(fuel, hours);
      fuel -= powered;
      energy += rate * powered + rate * (needs.blackoutNightEnergyRegenPercent / 100) * (hours - powered);
    }
    energy = clamp(energy);
  }

  return {
    hunger: clamp(stored.hunger - needs.hungerDecayPerHour * totalHours),
    energy,
    morale: clamp(moraleAfter(stored.morale, totalHours, needs)),
    generatorFuelHours: Math.max(0, fuel),
  };
}

/** What the client sees: whole numbers rounded down, so 0 really means empty; fuel to a tenth of an hour. */
export function displayNeeds(current: Needs): Needs {
  return {
    hunger: Math.floor(current.hunger),
    energy: Math.floor(current.energy),
    morale: Math.floor(current.morale),
    generatorFuelHours: Math.floor(current.generatorFuelHours * 10) / 10,
  };
}
