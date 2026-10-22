"use client";

import type { DistrictLayout, Point } from "@japalife/shared";
import { useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import type { Group } from "three";
import type { CharacterMotion } from "../character/animation";
import { resolveLook } from "../character/appearance";
import { Character } from "../character/Character";
import { ModelBoundary } from "../ModelBoundary";
import { createWalkers, stepWalker, walkerPose } from "./walkers";
import type { QualityGovernor } from "./quality";
import { skipWhileHidden } from "./skipWhileHidden";
import { localHour } from "./sky";
import type { StreetState } from "./street";
import { activeShare } from "./trafficSim";

/**
 * People strolling the roadsides (see `walkers.ts`), drawn with the same
 * character as the player, in random starter clothes. An animated person
 * costs about four draw calls, so anyone further than `DRAW_RANGE` is not
 * drawn at all and anyone beyond `ANIMATION_RANGE` freezes mid-step.
 */

const DRAW_RANGE = 40;
const ANIMATION_RANGE = 30;
const DEFAULT_HOUR = 12;
const MAX_STEP_SECONDS = 0.1;

export function Pedestrians({
  layout,
  predicted,
  street,
  quality,
}: {
  layout: Pick<DistrictLayout, "traffic" | "characters" | "models" | "vehicles">;
  predicted: { current: Point };
  street: { current: StreetState };
  quality: QualityGovernor;
}) {
  const walkers = useMemo(() => createWalkers(layout), [layout]);
  const looks = useMemo(
    () => walkers.map((walker) => resolveLook(walker.appearance, layout.characters, layout.models)),
    [walkers, layout.characters, layout.models],
  );
  const motions = useMemo(
    () => walkers.map(() => ({ current: { speed: 0, working: false, gestureAt: Number.NEGATIVE_INFINITY } as CharacterMotion })),
    [walkers],
  );
  const paused = useMemo(() => walkers.map(() => ({ current: false })), [walkers]);
  const groups = useRef<(Group | null)[]>([]);

  useFrame((_, frameSeconds) => {
    const dt = Math.min(frameSeconds, MAX_STEP_SECONDS);
    const { serverNow, timeZone } = street.current;
    const hour = serverNow && timeZone ? localHour(serverNow(), timeZone) : DEFAULT_HOUR;
    const share = activeShare(layout.vehicles.schedule, hour, false) * quality.scale;
    const player = predicted.current;
    walkers.forEach((walker, index) => {
      stepWalker(walker, dt, player, share);
      const pose = walkerPose(walker);
      const distance = Math.hypot(pose.x - player.x, pose.z - player.z);
      const group = groups.current[index];
      if (group) {
        group.visible = walker.shown && distance <= DRAW_RANGE;
        group.position.set(pose.x, 0, pose.z);
        group.rotation.y = pose.heading;
      }
      const motion = motions[index];
      if (motion) motion.current.speed = walker.moving ? walker.pace : 0;
      const flag = paused[index];
      if (flag) flag.current = !walker.shown || distance > ANIMATION_RANGE;
    });
  });

  return (
    <>
      {walkers.map((walker, index) => {
        const look = looks[index];
        const motion = motions[index];
        if (!look || !motion) return null;
        return (
          <group
            key={walker.id}
            ref={(group) => {
              groups.current[index] = group;
              if (group) skipWhileHidden(group);
            }}
          >
            <ModelBoundary fallback={null}>
              <Suspense fallback={null}>
                <Character look={look} motion={motion} paused={paused[index]} />
              </Suspense>
            </ModelBoundary>
          </group>
        );
      })}
    </>
  );
}
