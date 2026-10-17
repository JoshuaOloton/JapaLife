"use client";

import { type DistrictConfig, type Interactable, MAX_DEVICE_PIXEL_RATIO, type Point } from "@japalife/shared";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { type DistrictRoom, type ServerInbox, useDistrictConnection } from "./connection";
import { FpsProbe, useFpsMeterEnabled } from "./FpsMeter";
import { Hud, useTicker } from "./Hud";
import styles from "./hud.module.css";
import { MoveInput } from "./input";
import { Joystick } from "./Joystick";
import { nearestPlace } from "./nearby";
import { PlacePanel } from "./PlacePanel";
import { Player } from "./Player";
import { useGameMessages } from "./useGameMessages";
import { World } from "./World";

const SKY_COLOUR = "#bfdcef";
/** How often the "which place am I standing at?" check runs. Plenty for a walking player. */
const NEARBY_CHECK_MS = 200;

/**
 * The game screen. Loaded lazily by the page (see `app/GameLoader.tsx`), so
 * three.js and the scene code are not part of the first download.
 */
export default function Game() {
  const connection = useDistrictConnection();
  const input = useMemo(() => new MoveInput(), []);
  const touch = useCoarsePointer();
  const predicted = useRef<Point>({ x: 0, z: 0 });
  const showFps = useFpsMeterEnabled();
  const fpsOutput = useRef<HTMLParagraphElement>(null);

  useEffect(() => input.attachKeyboard(window), [input]);

  if (connection.status !== "connected") {
    return (
      <div style={{ position: "fixed", inset: 0, background: SKY_COLOUR }}>
        <p role="status" style={{ margin: 16, font: "600 16px system-ui, sans-serif", color: "#1d2b36" }}>
          {connection.status === "connecting" ? "Connecting..." : connection.message}
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: SKY_COLOUR, touchAction: "none" }}>
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
        <Player room={connection.room} district={connection.district} input={input} predicted={predicted} />
        {showFps && <FpsProbe output={fpsOutput} />}
      </Canvas>
      {touch && <Joystick input={input} />}
      {showFps && <p ref={fpsOutput} className={styles.fps} aria-hidden="true" />}
      <Overlay room={connection.room} inbox={connection.inbox} district={connection.district} predicted={predicted} />
    </div>
  );
}

/**
 * Everything drawn over the 3D view. It re-renders every second for the
 * countdowns, so it is kept a sibling of the Canvas, never a parent.
 */
function Overlay({
  room,
  inbox,
  district,
  predicted,
}: {
  room: DistrictRoom;
  inbox: ServerInbox;
  district: DistrictConfig;
  predicted: { current: Point };
}) {
  const { server, toasts, interaction, closeInteraction } = useGameMessages(inbox);
  const now = useTicker(server);
  const near = useNearbyPlace(district, predicted);

  const open = (place: Interactable): void => room.send("interact", { targetId: place.id });

  // Walking away from a place closes its sheet.
  useEffect(() => {
    if (interaction && interaction.targetId !== near?.id) closeInteraction();
  }, [near, interaction, closeInteraction]);

  // E (or Enter) uses the place you are standing at, on a keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.code === "KeyE" || event.code === "Enter") && near && !interaction) room.send("interact", { targetId: near.id });
      if (event.code === "Escape") closeInteraction();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [near, interaction, room, closeInteraction]);

  const openPlace = interaction ? district.interactables.find((place) => place.id === interaction.targetId) : undefined;

  return (
    <>
      <Hud
        server={server}
        now={now}
        toasts={toasts}
        districtName={district.name}
        onAnswer={(choiceId, answer) => room.send("answerEvent", { choiceId, answer })}
      />
      {near && !interaction && (
        <button type="button" className={styles.use} onClick={() => open(near)}>
          {near.label}
        </button>
      )}
      {interaction && openPlace && (
        <PlacePanel
          interaction={interaction}
          label={openPlace.label}
          stats={server?.stats ?? null}
          now={now}
          room={room}
          onClose={closeInteraction}
        />
      )}
      {!interaction && <p className={styles.disclaimer}>A game, not immigration advice</p>}
    </>
  );
}

/** The place the player is standing at, if any. A display hint only: the server re-checks distance. */
function useNearbyPlace(district: DistrictConfig, predicted: { current: Point }): Interactable | undefined {
  const [near, setNear] = useState<Interactable | undefined>();
  useEffect(() => {
    const timer = window.setInterval(
      () => setNear(nearestPlace(predicted.current, district.interactables, district.interactRadius)),
      NEARBY_CHECK_MS,
    );
    return () => window.clearInterval(timer);
  }, [district, predicted]);
  return near;
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
