import type { Box } from "./collision";

/**
 * Side of one grid cell, in metres. About two building plots: small enough
 * that a cell holds only a handful of things, big enough that a player's check
 * touches one to four cells.
 */
export const GRID_CELL_METRES = 8;

/**
 * Widens every lookup by a hair, so a box that only just touches the area is
 * never missed through rounding. It only adds candidates; the caller's own
 * test still decides.
 */
const EDGE_SLACK = 1e-9;

/**
 * A "spatial grid": the ground cut into square cells, each listing the boxes
 * that touch it. A collision check then looks only at the few boxes in the
 * cells around the player instead of every box in the district, so its cost
 * stays the same however big the district grows.
 *
 * Built once from a fixed list (buildings, props and NPCs do not move).
 */
export class SpatialGrid<T extends Box> {
  /** How many boxes the grid holds. */
  readonly size: number;
  private readonly cells: (T[] | undefined)[];
  private readonly minX: number;
  private readonly minZ: number;
  private readonly columns: number;
  private readonly rows: number;

  constructor(
    items: readonly T[],
    private readonly cellSize = GRID_CELL_METRES,
  ) {
    this.size = items.length;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const item of items) {
      minX = Math.min(minX, item.x - item.halfWidth);
      minZ = Math.min(minZ, item.z - item.halfDepth);
      maxX = Math.max(maxX, item.x + item.halfWidth);
      maxZ = Math.max(maxZ, item.z + item.halfDepth);
    }
    this.minX = items.length > 0 ? minX : 0;
    this.minZ = items.length > 0 ? minZ : 0;
    this.columns = items.length > 0 ? Math.floor((maxX - minX) / cellSize) + 1 : 0;
    this.rows = items.length > 0 ? Math.floor((maxZ - minZ) / cellSize) + 1 : 0;
    this.cells = new Array<T[] | undefined>(this.columns * this.rows);

    for (const item of items) {
      this.forEachCell(item.x, item.z, item.halfWidth, item.halfDepth, (index) => {
        const cell = this.cells[index];
        if (cell) cell.push(item);
        else this.cells[index] = [item];
      });
    }
  }

  /**
   * True if `test` passes for any box touching the rectangle centred on
   * (x, z). Stops at the first pass. A box spanning several cells may be
   * tested more than once, so `test` must not count anything.
   */
  some(x: number, z: number, halfWidth: number, halfDepth: number, test: (item: T) => boolean): boolean {
    let found = false;
    this.forEachCell(x, z, halfWidth + EDGE_SLACK, halfDepth + EDGE_SLACK, (index) => {
      for (const item of this.cells[index] ?? []) {
        if (test(item)) {
          found = true;
          return true;
        }
      }
      return false;
    });
    return found;
  }

  /** Every box touching the rectangle centred on (x, z), each listed once. */
  near(x: number, z: number, halfWidth: number, halfDepth: number): T[] {
    const found = new Set<T>();
    this.forEachCell(x, z, halfWidth + EDGE_SLACK, halfDepth + EDGE_SLACK, (index) => {
      for (const item of this.cells[index] ?? []) found.add(item);
    });
    return [...found];
  }

  /** Calls `visit` with each cell the rectangle touches; `visit` returning true stops early. */
  private forEachCell(
    x: number,
    z: number,
    halfWidth: number,
    halfDepth: number,
    visit: (index: number) => boolean | void,
  ): void {
    const firstColumn = Math.max(0, Math.floor((x - halfWidth - this.minX) / this.cellSize));
    const lastColumn = Math.min(this.columns - 1, Math.floor((x + halfWidth - this.minX) / this.cellSize));
    const firstRow = Math.max(0, Math.floor((z - halfDepth - this.minZ) / this.cellSize));
    const lastRow = Math.min(this.rows - 1, Math.floor((z + halfDepth - this.minZ) / this.cellSize));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        if (visit(row * this.columns + column)) return;
      }
    }
  }
}
