"use client";

import { MAX_DEVICE_PIXEL_RATIO } from "@japalife/shared";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { useDistrictConnection } from "./connection";
import { MoveInput } from "./input";
import { Joystick } from "./Joystick";
import { Player } from "./Player";
import { World } from "./World";

const SKY_COLOUR = "#bfdcef";

/**
 * The game screen. Loaded lazily by the page (see `app/GameLoader.tsx`), so
 * three.js and the scene code are not part of the first download.
 */
export default function Game() {
  const connection = useDistrictConnection();
  const input = useMemo(() => new MoveInput(), []);
  const touch = useCoarsePointer();

  useEffect(() => input.attachKeyboard(window), [input]);

  return (
    <div style={{ position: "fixed", inset: 0, background: SKY_COLOUR, touchAction: "none" }}>
      {connection.status === "connected" && (
        <Canvas
          // Phones report devicePixelRatio 2-3; drawing that many pixels melts weak GPUs.
          dpr={[1, MAX_DEVICE_PIXEL_RATIO]}
          // Antialiasing costs a lot on mobile GPUs and matters little at 1.5x.
          gl={{ antialias: false, powerPreference: "high-performance" }}
          camera={{ fov: 50, near: 0.5, far: 220 }}
        >
          <color attach="background" args={[SKY_COLOUR]} />
          <fog attach="fog" args={[SKY_COLOUR, 50, 140]} />
          {/* Cheap lighting and no real-time shadows, per the performance budget. */}
          <hemisphereLight args={["#ffffff", "#6f8f4f", 1.6]} />
          <directionalLight position={[20, 40, 10]} intensity={1.4} />
          <World district={connection.district} />
          <Player room={connection.room} district={connection.district} input={input} />
        </Canvas>
      )}
      <Status connection={connection} />
      {connection.status === "connected" && touch && <Joystick input={input} />}
    </div>
  );
}

function Status({ connection }: { connection: ReturnType<typeof useDistrictConnection> }) {
  const text =
    connection.status === "connecting"
      ? "Connecting..."
      : connection.status === "failed"
        ? connection.message
        : connection.district.name;
  return (
    <p
      role="status"
      style={{
        position: "absolute",
        top: "max(12px, env(safe-area-inset-top))",
        left: 16,
        right: 16,
        margin: 0,
        font: "600 16px system-ui, sans-serif",
        color: "#1d2b36",
        pointerEvents: "none",
      }}
    >
      {text}
    </p>
  );
}

/** True on touch-first devices (phones, tablets), where the joystick is shown. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = (): void => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
}
