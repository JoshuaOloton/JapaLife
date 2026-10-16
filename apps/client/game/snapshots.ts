import type { Point } from "@japalife/shared";

/** A position the server reported, stamped with when it arrived (performance.now() ms). */
export interface Snapshot extends Point {
  t: number;
}

/**
 * How far behind "now" positions are drawn. Server updates arrive about every
 * 67 ms (15 Hz) and unevenly on mobile data; drawing slightly in the past means
 * there is almost always an update on each side of the moment being drawn, so
 * movement can be blended smoothly instead of jumping from update to update.
 */
export const INTERPOLATION_DELAY_MS = 120;

/** Enough history to cover the delay several times over, even with gaps. */
const MAX_SNAPSHOTS = 30;

/**
 * Snapshot interpolation: keeps recent server positions and answers "where was
 * this entity at time t?" by blending between the two updates either side of t.
 */
export class SnapshotBuffer {
  private readonly snapshots: Snapshot[] = [];

  push(snapshot: Snapshot): void {
    const last = this.snapshots.at(-1);
    // Out-of-order or duplicate timestamps would break the bracketing search.
    if (last && snapshot.t <= last.t) return;
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
  }

  get latest(): Snapshot | undefined {
    return this.snapshots.at(-1);
  }

  /** The interpolated position at `time`. Never extrapolates past the newest update. */
  sample(time: number): Point | undefined {
    const first = this.snapshots[0];
    const last = this.snapshots.at(-1);
    if (!first || !last) return undefined;
    if (time <= first.t) return { x: first.x, z: first.z };
    if (time >= last.t) return { x: last.x, z: last.z };

    for (let i = this.snapshots.length - 1; i > 0; i--) {
      const before = this.snapshots[i - 1] as Snapshot;
      const after = this.snapshots[i] as Snapshot;
      if (before.t <= time) {
        const k = (time - before.t) / (after.t - before.t);
        return { x: before.x + (after.x - before.x) * k, z: before.z + (after.z - before.z) * k };
      }
    }
    return { x: first.x, z: first.z };
  }
}
