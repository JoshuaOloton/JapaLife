"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Group } from "three";
import { FAN_BLADES, dressingRoomSlabs } from "./bedroomSet";
import { Boxes } from "./world/Boxes";

/** How fast the ceiling fan turns, radians per second (a lazy medium setting). */
const FAN_SPEED = 7;
const MAX_FRAME_SECONDS = 0.25;

/**
 * The wardrobe screen's bedroom, drawn around the character (at the origin of
 * its parent) while the creator is open. Two draw calls: the room and the fan.
 */
export function DressingRoom({ frontZ }: { frontZ: number }) {
  const slabs = useMemo(() => dressingRoomSlabs(frontZ), [frontZ]);
  const fan = useRef<Group>(null);
  useFrame((_, frameSeconds) => {
    if (fan.current) fan.current.rotation.y += Math.min(frameSeconds, MAX_FRAME_SECONDS) * FAN_SPEED;
  });
  return (
    <>
      <Boxes slabs={slabs} />
      <group ref={fan}>
        <Boxes slabs={FAN_BLADES} />
      </group>
    </>
  );
}
