"use client";

import { useEffect, useState } from "react";

/**
 * Developer switches for finding what costs frame time on a phone, read from
 * the URL alongside `?fps` (and ignored without it, so normal play never sees
 * them). Take one reading per switch and compare it with plain `?fps`:
 *  - `dpr=1` draws fewer pixels: if the frame rate jumps, the GPU is short of
 *    fill rate (pixels drawn, overdraw), not of geometry;
 *  - `hide=buildings,props,people,npcs,traffic` leaves those layers out: the
 *    one whose absence brings the frame rate back is the cost.
 * Developer-only text, so not in the copy file.
 */

export const DIAGNOSTIC_LAYERS = ["buildings", "props", "people", "npcs", "traffic"] as const;
export type DiagnosticLayer = (typeof DIAGNOSTIC_LAYERS)[number];

export interface Diagnostics {
  /** A pixel ratio to use instead of the usual cap. */
  dpr: number | undefined;
  hide: ReadonlySet<DiagnosticLayer>;
}

const NONE: Diagnostics = { dpr: undefined, hide: new Set() };

export function readDiagnostics(search: string): Diagnostics {
  const params = new URLSearchParams(search);
  if (!params.has("fps")) return NONE;
  const dpr = Number(params.get("dpr"));
  const hide = (params.get("hide") ?? "")
    .split(",")
    .filter((layer): layer is DiagnosticLayer => (DIAGNOSTIC_LAYERS as readonly string[]).includes(layer));
  return { dpr: dpr >= 0.5 && dpr <= 3 ? dpr : undefined, hide: new Set(hide) };
}

/** How the switches read on the meter, so a reading always says what was left out. */
export function describeDiagnostics({ dpr, hide }: Diagnostics): string {
  const parts = [...(dpr ? [`dpr=${dpr}`] : []), ...(hide.size > 0 ? [`hide=${[...hide].join(",")}`] : [])];
  return parts.length > 0 ? ` · ${parts.join(" ")}` : "";
}

export function useDiagnostics(): Diagnostics {
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(NONE);
  useEffect(() => setDiagnostics(readDiagnostics(window.location.search)), []);
  return diagnostics;
}
