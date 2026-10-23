"use client";

import { COPY, type DistrictHeader, type Point, type Route } from "@japalife/shared";
import { useEffect, useRef } from "react";
import styles from "../hud.module.css";
import { type MapBase, drawMap } from "./mapPaint";

/** Side of the minimap on screen, CSS pixels. */
const SIZE = 112;
/** About 190 m across: the street around you and the next junction or two. */
const SCALE = 0.6;
/** Redraws a second: it follows the player, but nobody reads a minimap at 60 fps. */
const REDRAWS_PER_SECOND = 5;

/** The map round the player, on the HUD. Tapping it opens the full map. */
export function Minimap({
  header,
  base,
  predicted,
  route,
  onOpen,
}: {
  header: DistrictHeader;
  base: MapBase;
  predicted: { current: Point };
  route: Route | null;
  onOpen: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    element.width = SIZE * ratio;
    element.height = SIZE * ratio;
    const draw = (): void => {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const player = predicted.current;
      drawMap(context, base, { x: player.x, z: player.z, scale: SCALE }, SIZE, SIZE, { header, player, route, labels: false });
    };
    draw();
    const timer = window.setInterval(draw, 1000 / REDRAWS_PER_SECOND);
    return () => window.clearInterval(timer);
  }, [base, header, predicted, route]);

  return (
    <button type="button" className={styles.minimap} onClick={onOpen} aria-label={COPY.map.open}>
      <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} />
    </button>
  );
}
