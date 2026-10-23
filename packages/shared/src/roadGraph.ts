import type { Point } from "./collision";
import type { Road } from "./content";

/**
 * Routes along the roads, for the map's "walk there" and (in 11i) the rides.
 * The roads become a graph: a node wherever two roads cross and at each road
 * end, an edge along the road between neighbouring nodes. A* (a shortest-path
 * search that explores toward the goal first) finds the shortest way through
 * it. A route keeps to the right-hand side of each road, inside the tar:
 * nothing solid may stand on a road (the content check refuses it), so the
 * only legs that can meet a wall are the first (from where you are to the
 * road) and the last (from the road to where you are going).
 */

/** How far in from the road edge a route walks, metres: clear of the gutter, on the tar. */
const EDGE_INSET = 0.8;

interface Line {
  /** "x" for a road running east-west (along x), "z" for north-south. */
  axis: "x" | "z";
  /** Its centre line: z for an east-west road, x for a north-south one. */
  at: number;
  from: number;
  to: number;
  /** How far right of the centre line a route walks on it. Lanes are narrow: walk the middle. */
  offset: number;
}

function lineOf(road: Road): Line {
  const alongX = road.halfWidth >= road.halfDepth;
  const half = alongX ? road.halfDepth : road.halfWidth;
  return {
    axis: alongX ? "x" : "z",
    at: alongX ? road.z : road.x,
    from: alongX ? road.x - road.halfWidth : road.z - road.halfDepth,
    to: alongX ? road.x + road.halfWidth : road.z + road.halfDepth,
    offset: road.class === "lane" ? 0 : Math.max(0, half - EDGE_INSET),
  };
}

const pointOn = (line: Line, along: number): Point =>
  line.axis === "x" ? { x: along, z: line.at } : { x: line.at, z: along };
const alongOf = (line: Line, point: Point): number => (line.axis === "x" ? point.x : point.z);

/** The road centre line nearest a point, and where on it the point is closest. */
function attach(lines: readonly Line[], point: Point): { line: number; along: number; distance: number } | undefined {
  let best: { line: number; along: number; distance: number } | undefined;
  lines.forEach((line, index) => {
    const along = Math.min(line.to, Math.max(line.from, alongOf(line, point)));
    const on = pointOn(line, along);
    const distance = Math.hypot(point.x - on.x, point.z - on.z);
    if (!best || distance < best.distance) best = { line: index, along, distance };
  });
  return best;
}

export interface Route {
  /** From the start, along the roads, to the end: walk them in order. */
  points: Point[];
  /** Length in metres. */
  length: number;
}

/**
 * The shortest way from `from` to `to` along the roads, or undefined if there
 * are no roads. Both ends join the nearest road in a straight line.
 */
export function routeBetween(roads: readonly Road[], from: Point, to: Point): Route | undefined {
  const lines = roads.map(lineOf);
  const start = attach(lines, from);
  const end = attach(lines, to);
  if (!start || !end) return undefined;

  // Nodes: each line's ends, every crossing, and where the two ends join the roads.
  const nodes: Point[] = [];
  const keyOf = new Map<string, number>();
  const nodeAt = (point: Point): number => {
    const key = `${Math.round(point.x * 100)},${Math.round(point.z * 100)}`;
    let index = keyOf.get(key);
    if (index === undefined) {
      index = nodes.length;
      nodes.push(point);
      keyOf.set(key, index);
    }
    return index;
  };
  const onLine: number[][] = lines.map((line) => [nodeAt(pointOn(line, line.from)), nodeAt(pointOn(line, line.to))]);
  lines.forEach((a, i) => {
    lines.forEach((b, j) => {
      if (j <= i || a.axis === b.axis) return;
      // a crosses b where each one's centre line meets the other's.
      if (b.at < a.from || b.at > a.to || a.at < b.from || a.at > b.to) return;
      const node = nodeAt(pointOn(a, b.at));
      onLine[i]?.push(node);
      onLine[j]?.push(node);
    });
  });
  const startNode = nodeAt(pointOn(lines[start.line] as Line, start.along));
  const endNode = nodeAt(pointOn(lines[end.line] as Line, end.along));
  onLine[start.line]?.push(startNode);
  onLine[end.line]?.push(endNode);

  // Edges along each line between neighbouring nodes, remembering the line (for its offset).
  const edges: { to: number; length: number; line: number }[][] = nodes.map(() => []);
  onLine.forEach((ids, lineIndex) => {
    const line = lines[lineIndex] as Line;
    const sorted = [...new Set(ids)].sort((a, b) => alongOf(line, nodes[a] as Point) - alongOf(line, nodes[b] as Point));
    for (let k = 1; k < sorted.length; k++) {
      const a = sorted[k - 1] as number;
      const b = sorted[k] as number;
      const length = Math.abs(alongOf(line, nodes[b] as Point) - alongOf(line, nodes[a] as Point));
      edges[a]?.push({ to: b, length, line: lineIndex });
      edges[b]?.push({ to: a, length, line: lineIndex });
    }
  });

  const path = aStar(nodes, edges, startNode, endNode);
  if (!path) return undefined;
  const points = [from, ...rightHandSide(nodes, lines, path), to];
  const length = points.slice(1).reduce((sum, point, index) => {
    const previous = points[index] as Point;
    return sum + Math.hypot(point.x - previous.x, point.z - previous.z);
  }, 0);
  return { points, length };
}

/** A* over the road graph, with straight-line distance as the guide. Returns the nodes and the line each step takes. */
function aStar(
  nodes: readonly Point[],
  edges: readonly { to: number; length: number; line: number }[][],
  start: number,
  goal: number,
): { node: number; line: number }[] | undefined {
  const goalPoint = nodes[goal] as Point;
  const guess = (node: number): number => {
    const point = nodes[node] as Point;
    return Math.abs(point.x - goalPoint.x) + Math.abs(point.z - goalPoint.z);
  };
  const cost = new Map<number, number>([[start, 0]]);
  const came = new Map<number, { from: number; line: number }>();
  const open = new Set<number>([start]);
  while (open.size > 0) {
    let current = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const node of open) {
      const score = (cost.get(node) ?? Infinity) + guess(node);
      if (score < bestScore) {
        bestScore = score;
        current = node;
      }
    }
    if (current === goal) {
      const path: { node: number; line: number }[] = [];
      let at = goal;
      while (at !== start) {
        const step = came.get(at);
        if (!step) break;
        path.unshift({ node: at, line: step.line });
        at = step.from;
      }
      path.unshift({ node: start, line: path[0]?.line ?? -1 });
      return path;
    }
    open.delete(current);
    for (const edge of edges[current] ?? []) {
      const next = (cost.get(current) ?? Infinity) + edge.length;
      if (next < (cost.get(edge.to) ?? Infinity)) {
        cost.set(edge.to, next);
        came.set(edge.to, { from: current, line: edge.line });
        open.add(edge.to);
      }
    }
  }
  return undefined;
}

/**
 * The path's centre-line nodes moved to the right-hand side of each road. Where
 * the path turns from one road onto a crossing one, the corner is where the
 * two moved lines meet, inside the junction.
 */
function rightHandSide(nodes: readonly Point[], lines: readonly Line[], path: readonly { node: number; line: number }[]): Point[] {
  // Steps that actually move, with their line and direction.
  const steps: { from: Point; to: Point; line: Line }[] = [];
  for (let k = 1; k < path.length; k++) {
    const from = nodes[(path[k - 1] as { node: number }).node] as Point;
    const to = nodes[(path[k] as { node: number }).node] as Point;
    const line = lines[(path[k] as { line: number }).line];
    if (line && (from.x !== to.x || from.z !== to.z)) steps.push({ from, to, line });
  }
  if (steps.length === 0) return path.length > 0 ? [nodes[(path[0] as { node: number }).node] as Point] : [];
  const shifted = (step: (typeof steps)[number], point: Point): Point => {
    const length = Math.hypot(step.to.x - step.from.x, step.to.z - step.from.z);
    const dx = (step.to.x - step.from.x) / length;
    const dz = (step.to.z - step.from.z) / length;
    // Right of the way you are facing (x east, z south): (-dz, dx).
    return { x: point.x - dz * step.line.offset, z: point.z + dx * step.line.offset };
  };
  const points: Point[] = [shifted(steps[0] as (typeof steps)[number], (steps[0] as (typeof steps)[number]).from)];
  for (let k = 1; k < steps.length; k++) {
    const before = steps[k - 1] as (typeof steps)[number];
    const after = steps[k] as (typeof steps)[number];
    if (before.line.axis === after.line.axis) continue; // straight on: no corner
    const a = shifted(before, before.to);
    const b = shifted(after, after.from);
    // One step runs along x and the other along z: the corner takes a coordinate from each.
    points.push(before.line.axis === "x" ? { x: b.x, z: a.z } : { x: a.x, z: b.z });
  }
  const last = steps[steps.length - 1] as (typeof steps)[number];
  points.push(shifted(last, last.to));
  return points;
}
