"use client";

import { type DistrictLayout, type Point, encodeAppearance } from "@japalife/shared";
import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import type { Group, Mesh } from "three";
import type { CharacterMotion } from "../character/animation";
import { type CharacterLook, resolveLook } from "../character/appearance";
import { Character } from "../character/Character";
import { ModelBoundary } from "../ModelBoundary";
import { WARM_UP_WHILE_HIDDEN } from "../ShaderWarmUp";
import { paintSign } from "./paint";

/**
 * The people who stay in one spot: Mama Put, the okada riders, the gateman.
 * Each is the same rigged character as the player, holding one looping clip.
 * They block the player (the server and the prediction both get them from
 * `districtObstacles`), but they are drawn here only: nothing about them is
 * synced, since they never move.
 *
 * An animated person costs a few draw calls and an animation update a frame,
 * so anyone further than `ANIMATION_RANGE` from the player freezes in their
 * pose (a simple level of detail: far away, nobody can tell).
 */

/** Metres from the player within which NPCs animate. */
const ANIMATION_RANGE = 30;
/** Metres from the player within which NPCs are drawn at all; past it the haze hides them. */
const DRAW_RANGE = 90;
/** Metres from the player within which a speech bubble shows. */
const BUBBLE_RANGE = 10;
/** How often to re-check distances, in seconds. People do not need it every frame. */
const RANGE_CHECK_SECONDS = 0.25;
const BUBBLE_HEIGHT = 2.35;
const BUBBLE_SIZE = { width: 3.2, height: 0.6 } as const;

/** NPCs never walk, so they all share one motion: standing still. */
const STANDING: { current: CharacterMotion } = {
  current: { speed: 0, working: false, gestureAt: Number.NEGATIVE_INFINITY },
};

export function Npcs({
  layout,
  predicted,
}: {
  layout: Pick<DistrictLayout, "npcs" | "characters" | "models">;
  predicted: { current: Point };
}) {
  const { npcs } = layout;
  // The NPC list changes whenever chunks arrive, but each person must keep the same look
  // object (and pause flag), or their whole character is rebuilt: resolved once per NPC and look.
  const known = useRef(new Map<string, { code: string; look: CharacterLook; paused: { current: boolean } }>());
  const resolved = useMemo(
    () =>
      npcs.map((npc) => {
        const code = encodeAppearance(npc.look);
        let person = known.current.get(npc.id);
        if (!person || person.code !== code) {
          person = { code, look: resolveLook(npc.look, layout.characters, layout.models), paused: { current: false } };
          known.current.set(npc.id, person);
        }
        return person;
      }),
    [npcs, layout.characters, layout.models],
  );
  const paused = resolved.map((person) => person.paused);
  const looks = resolved.map((person) => person.look);
  const bubbles = useRef<(Mesh | null)[]>([]);
  const people = useRef<(Group | null)[]>([]);
  const sinceCheck = useRef(Number.POSITIVE_INFINITY);

  useFrame((_, frameSeconds) => {
    sinceCheck.current += frameSeconds;
    if (sinceCheck.current < RANGE_CHECK_SECONDS) return;
    sinceCheck.current = 0;
    const { x, z } = predicted.current;
    npcs.forEach((npc, index) => {
      const distance = Math.hypot(npc.x - x, npc.z - z);
      const flag = paused[index];
      if (flag) flag.current = distance > ANIMATION_RANGE;
      const bubble = bubbles.current[index];
      if (bubble) bubble.visible = distance <= BUBBLE_RANGE;
      const person = people.current[index];
      if (person) person.visible = distance <= DRAW_RANGE;
    });
  });

  return (
    <>
      {npcs.map((npc, index) => {
        const look = looks[index];
        if (!look) return null;
        return (
          <group
            key={npc.id}
            ref={(group) => {
              people.current[index] = group;
            }}
            position={[npc.x, 0, npc.z]}
            rotation-y={(npc.facing * Math.PI) / 180}
            // Warmed up at load even if they start out of range.
            userData={{ [WARM_UP_WHILE_HIDDEN]: true }}
          >
            {/* No stand-in: they arrive with the player's own character download. */}
            <ModelBoundary fallback={null}>
              <Suspense fallback={null}>
                <Character look={look} motion={STANDING} pose={npc.pose} paused={paused[index]} />
              </Suspense>
            </ModelBoundary>
            {npc.says ? (
              <SpeechBubble
                text={npc.says}
                facing={npc.facing}
                onMesh={(mesh) => {
                  bubbles.current[index] = mesh;
                }}
              />
            ) : null}
          </group>
        );
      })}
    </>
  );
}

/** A white bubble over the head. It stays facing the camera (south) whichever way the NPC faces. */
function SpeechBubble({ text, facing, onMesh }: { text: string; facing: number; onMesh: (mesh: Mesh | null) => void }) {
  const texture = useMemo(
    () => paintSign(text, { background: "#ffffff", text: "#1d1d1d", width: 384, height: 72 }),
    [text],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh ref={onMesh} position-y={BUBBLE_HEIGHT} rotation-y={(-facing * Math.PI) / 180} visible={false}>
      <planeGeometry args={[BUBBLE_SIZE.width, BUBBLE_SIZE.height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
