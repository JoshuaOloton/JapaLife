"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, type DirectionalLight, Fog, type HemisphereLight } from "three";
import { localHour, skyAt, sunDirection } from "./sky";
import type { StreetState } from "./street";

/** Light changes slowly; recomputing it once a second is plenty and costs nothing. */
const UPDATE_EVERY_SECONDS = 1;
/** Before the first stats arrive, show midday. */
const DEFAULT_HOUR = 12;
const FOG_NEAR = 50;
const FOG_FAR = 140;

/**
 * Sky, fog and the two lights, following the city's clock (server time). The
 * background and fog share one colour, so far buildings fade into the sky.
 */
export function Lighting({ street }: { street: { current: StreetState } }) {
  const scene = useThree((three) => three.scene);
  const hemisphere = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const skyColour = useMemo(() => new Color(), []);
  const sinceUpdate = useRef(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    scene.background = skyColour;
    scene.fog = new Fog(skyColour, FOG_NEAR, FOG_FAR);
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, skyColour]);

  useFrame((_, frameSeconds) => {
    sinceUpdate.current += frameSeconds;
    if (sinceUpdate.current < UPDATE_EVERY_SECONDS) return;
    sinceUpdate.current = 0;

    const { serverNow, timeZone, blackoutEndsAt } = street.current;
    const now = serverNow?.() ?? 0;
    const hour = serverNow && timeZone ? localHour(now, timeZone) : DEFAULT_HOUR;
    const blackout = blackoutEndsAt !== null && Date.parse(blackoutEndsAt) > now;
    const look = skyAt(hour, blackout);
    skyColour.set(look.sky);
    if (scene.fog instanceof Fog) scene.fog.color.copy(skyColour);
    if (hemisphere.current) {
      hemisphere.current.color.set(look.hemiSky);
      hemisphere.current.groundColor.set(look.hemiGround);
      hemisphere.current.intensity = look.hemiIntensity;
    }
    if (sun.current) {
      sun.current.color.set(look.sunColour);
      sun.current.intensity = look.sunIntensity;
      sun.current.position.set(...sunDirection(hour));
    }
  });

  // Cheap lighting and no real-time shadows, per the performance budget.
  return (
    <>
      <hemisphereLight ref={hemisphere} />
      <directionalLight ref={sun} />
    </>
  );
}
