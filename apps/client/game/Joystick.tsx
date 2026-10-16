"use client";

import { type PointerEvent, useRef, useState } from "react";
import type { MoveInput } from "./input";

/** How far the knob can travel from the centre, in CSS pixels. Full speed at the rim. */
const RADIUS = 48;
/** Small movements near the centre are ignored, so a resting thumb does not drift. */
const DEAD_ZONE = 0.15;

/**
 * An on-screen thumbstick for touch screens. Dragging up walks north (away from
 * the camera). Uses pointer capture, so the thumb can slide off the pad and keep
 * steering, and a second finger elsewhere on the screen is not stolen.
 */
export function Joystick({ input }: { input: MoveInput }) {
  const pad = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const steer = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = pad.current?.getBoundingClientRect();
    if (!rect) return;
    let x = event.clientX - (rect.left + rect.width / 2);
    let y = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(x, y);
    if (length > RADIUS) {
      x = (x / length) * RADIUS;
      y = (y / length) * RADIUS;
    }
    setKnob({ x, y });
    const strength = Math.min(1, length / RADIUS);
    if (strength < DEAD_ZONE) {
      input.setJoystick({ x: 0, z: 0 });
      return;
    }
    // Screen y grows downward, which is +z (toward the camera) in the world.
    input.setJoystick({ x: x / RADIUS, z: y / RADIUS });
  };

  const release = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerId !== activePointer.current) return;
    activePointer.current = null;
    setKnob({ x: 0, y: 0 });
    input.setJoystick({ x: 0, z: 0 });
  };

  return (
    <div
      ref={pad}
      aria-label="Movement joystick"
      onPointerDown={(event) => {
        if (activePointer.current !== null) return;
        activePointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        steer(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerId === activePointer.current) steer(event);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      style={{
        position: "absolute",
        left: "max(24px, env(safe-area-inset-left))",
        bottom: "max(24px, env(safe-area-inset-bottom))",
        width: RADIUS * 2 + 32,
        height: RADIUS * 2 + 32,
        borderRadius: "50%",
        background: "rgba(0, 0, 0, 0.25)",
        border: "2px solid rgba(255, 255, 255, 0.5)",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 48,
          height: 48,
          marginLeft: -24,
          marginTop: -24,
          borderRadius: "50%",
          background: "rgba(255, 255, 255, 0.8)",
          transform: `translate(${knob.x}px, ${knob.y}px)`,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
