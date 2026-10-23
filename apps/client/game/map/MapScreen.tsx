"use client";

import { COPY, type DistrictHeader, fill, type Point, type Route } from "@japalife/shared";
import { useCallback, useEffect, useRef } from "react";
import styles from "../hud.module.css";
import { type MapBase, type MapView, drawMap, screenToWorld } from "./mapPaint";

/** Zoom limits, screen pixels per metre: the whole district on a phone, down to a single street. */
const MIN_SCALE = 0.4;
const MAX_SCALE = 6;
const START_SCALE = 1.4;
/** A press that moves less than this (and lets go quickly) is a tap, not a drag. */
const TAP_PIXELS = 8;
const TAP_MS = 450;

/**
 * The full-screen map: drag to look around, pinch (or scroll) to zoom, tap a
 * spot to get the way there by road. Pointer events only, no gesture library.
 */
export function MapScreen({
  header,
  base,
  predicted,
  route,
  walking,
  onPick,
  onWalk,
  onClear,
  onClose,
}: {
  header: DistrictHeader;
  base: MapBase;
  predicted: { current: Point };
  route: Route | null;
  walking: boolean;
  onPick: (point: Point) => void;
  onWalk: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<MapView>({ x: predicted.current.x, z: predicted.current.z, scale: START_SCALE });
  const routeRef = useRef(route);
  routeRef.current = route;

  const draw = useCallback(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawMap(context, base, view.current, width, height, { header, player: predicted.current, route: routeRef.current, labels: true });
  }, [base, header, predicted]);

  // Redrawn when the route changes, and a few times a second so the player's dot moves.
  useEffect(() => {
    draw();
    const timer = window.setInterval(draw, 200);
    window.addEventListener("resize", draw);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", draw);
    };
  }, [draw, route]);

  // Panning, pinching and tapping.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let press: { x: number; y: number; at: number; moved: number } | null = null;
    let pinch: number | null = null;
    const zoomAbout = (factor: number, x: number, y: number): void => {
      const before = screenToWorld(view.current, element.clientWidth, element.clientHeight, x, y);
      view.current.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.current.scale * factor));
      const after = screenToWorld(view.current, element.clientWidth, element.clientHeight, x, y);
      view.current.x += before.x - after.x;
      view.current.z += before.z - after.z;
    };
    const local = (event: PointerEvent): { x: number; y: number } => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onDown = (event: PointerEvent): void => {
      element.setPointerCapture(event.pointerId);
      const point = local(event);
      pointers.set(event.pointerId, point);
      press = pointers.size === 1 ? { ...point, at: performance.now(), moved: 0 } : null;
      pinch = null;
    };
    const onMove = (event: PointerEvent): void => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const point = local(event);
      pointers.set(event.pointerId, point);
      if (pointers.size === 1) {
        view.current.x -= (point.x - previous.x) / view.current.scale;
        view.current.z -= (point.y - previous.y) / view.current.scale;
        if (press) press.moved += Math.hypot(point.x - previous.x, point.y - previous.y);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const spread = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoomAbout(spread / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = spread;
      }
      draw();
    };
    const onUp = (event: PointerEvent): void => {
      const point = local(event);
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (press && pointers.size === 0 && press.moved < TAP_PIXELS && performance.now() - press.at < TAP_MS) {
        onPick(screenToWorld(view.current, element.clientWidth, element.clientHeight, point.x, point.y));
      }
      press = null;
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const point = { x: event.offsetX, y: event.offsetY };
      zoomAbout(event.deltaY < 0 ? 1.15 : 1 / 1.15, point.x, point.y);
      draw();
    };
    element.addEventListener("pointerdown", onDown);
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", onUp);
    element.addEventListener("pointercancel", onUp);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", onDown);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", onUp);
      element.removeEventListener("pointercancel", onUp);
      element.removeEventListener("wheel", onWheel);
    };
  }, [draw, onPick]);

  return (
    <div className={styles.mapScreen} role="dialog" aria-label={header.name}>
      <canvas ref={canvas} className={styles.mapCanvas} />
      <p className={styles.mapHint}>
        {route ? fill(COPY.map.route, { metres: Math.round(route.length) }) : COPY.map.hint}
      </p>
      <div className={styles.mapButtons}>
        {route && !walking && (
          <button type="button" className={styles.action} onClick={onWalk}>
            {COPY.map.walkThere}
          </button>
        )}
        {route && (
          <button type="button" className={styles.mapSecondary} onClick={onClear}>
            {COPY.map.clearRoute}
          </button>
        )}
        <button type="button" className={styles.mapSecondary} onClick={onClose}>
          {COPY.map.close}
        </button>
      </div>
    </div>
  );
}
