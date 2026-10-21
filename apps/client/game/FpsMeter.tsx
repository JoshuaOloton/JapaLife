"use client";

import { useFrame } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useState } from "react";
import { FpsCounter, formatFpsReading } from "./fps";
import type { QualityGovernor } from "./world/quality";

/** True when the page was opened with `?fps`, e.g. http://192.168.1.20:3000/?fps */
export function useFpsMeterEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => setEnabled(new URLSearchParams(window.location.search).has("fps")), []);
  return enabled;
}

/**
 * Lives inside the Canvas and counts rendered frames. It writes straight to a
 * DOM element once a second rather than through React state, so measuring the
 * frame rate does not cost a React render per frame.
 */
export function FpsProbe({ output, quality }: { output: RefObject<HTMLElement | null>; quality: QualityGovernor }) {
  const counter = useMemo(() => new FpsCounter(), []);
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") counter.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [counter]);
  useFrame(({ gl }) => {
    // `info.render` still holds the previous frame's counts: this runs before the frame is drawn.
    const { calls, triangles } = gl.info.render;
    const reading = counter.frame(performance.now(), {
      shaders: gl.info.programs?.length ?? 0,
      textures: gl.info.memory.textures,
      calls,
    });
    if (reading && output.current) {
      output.current.textContent = formatFpsReading(reading, gl.getPixelRatio(), { calls, triangles, street: quality.scale });
    }
  });
  return null;
}

/** Feeds the adaptive-quality governor every frame (always on, not only with `?fps`). */
export function QualityProbe({ quality }: { quality: QualityGovernor }) {
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") quality.pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [quality]);
  useFrame(() => quality.frame(performance.now()));
  return null;
}
