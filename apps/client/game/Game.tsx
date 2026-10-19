"use client";

import { COPY, type DistrictConfig, type Interactable, MAX_DEVICE_PIXEL_RATIO, type Point } from "@japalife/shared";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { type DistrictRoom, type MessageBuffer, useDistrictConnection } from "./connection";
import { placePrompt } from "./format";
import { FpsProbe, useFpsMeterEnabled } from "./FpsMeter";
import { Hud, useTicker } from "./Hud";
import styles from "./hud.module.css";
import { InboxPanel } from "./InboxPanel";
import { MoveInput } from "./input";
import { Joystick } from "./Joystick";
import { nearestPlace } from "./nearby";
import { PlacePanel } from "./PlacePanel";
import { Player, type PlayerActivity } from "./Player";
import { useGameMessages } from "./useGameMessages";
import { World } from "./World";
import { Lighting } from "./world/Lighting";
import { type StreetState, initialStreet } from "./world/street";

/** Behind the loading message and the canvas until the first frame paints the sky. */
const SKY_COLOUR = "#c4dcea";
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
  const activity = useRef<PlayerActivity>({ working: false, gestureAt: Number.NEGATIVE_INFINITY });
  const showFps = useFpsMeterEnabled();
  const fpsOutput = useRef<HTMLParagraphElement>(null);
  const street = useRef<StreetState>(initialStreet());

  useEffect(() => input.attachKeyboard(window), [input]);

  if (connection.status !== "connected") {
    return (
      <div style={{ position: "fixed", inset: 0, background: SKY_COLOUR }}>
        <p role="status" style={{ margin: 16, font: "600 16px system-ui, sans-serif", color: "#1d2b36" }}>
          {connection.status === "connecting" ? COPY.app.connecting : connection.message}
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
        // The fog hides everything past 140 m, so nothing beyond it needs drawing.
        camera={{ fov: 50, near: 0.5, far: 150 }}
      >
        <Lighting street={street} />
        <World district={connection.district} street={street} />
        <Player
          room={connection.room}
          district={connection.district}
          input={input}
          predicted={predicted}
          activity={activity}
        />
        {showFps && <FpsProbe output={fpsOutput} />}
      </Canvas>
      {touch && <Joystick input={input} />}
      {showFps && <p ref={fpsOutput} className={styles.fps} aria-hidden="true" />}
      <Overlay
        room={connection.room}
        messages={connection.messages}
        district={connection.district}
        predicted={predicted}
        activity={activity}
        street={street}
      />
    </div>
  );
}

/**
 * Everything drawn over the 3D view. It re-renders every second for the
 * countdowns, so it is kept a sibling of the Canvas, never a parent.
 */
function Overlay({
  room,
  messages,
  district,
  predicted,
  activity,
  street,
}: {
  room: DistrictRoom;
  messages: MessageBuffer;
  district: DistrictConfig;
  predicted: { current: Point };
  activity: { current: PlayerActivity };
  street: { current: StreetState };
}) {
  const { server, toasts, interaction, closeInteraction, inbox, closeInbox } = useGameMessages(messages);
  const now = useTicker(server);
  const near = useNearbyPlace(district, predicted);

  // Tell the 3D street what time it is and whether there is light.
  useEffect(() => {
    if (!server) return;
    const { timeZone, isNight, blackoutEndsAt } = server.stats;
    street.current = { serverNow: server.serverNow, timeZone, isNight, blackoutEndsAt };
  }, [street, server]);

  // Tell the character what it is doing: on shift at that job's site, it works.
  const activeJobId = server?.stats.activeShift?.jobId;
  useEffect(() => {
    activity.current.working = activeJobId !== undefined && near?.kind === "job_site" && near.jobId === activeJobId;
  }, [activity, activeJobId, near]);

  // Opening a place's sheet plays a short "using it" gesture.
  const interactionTarget = interaction?.targetId;
  useEffect(() => {
    if (interactionTarget) activity.current.gestureAt = performance.now();
  }, [activity, interactionTarget]);

  const open = (place: Interactable): void => room.send("interact", { targetId: place.id });

  // Walking away from a place closes its sheet.
  useEffect(() => {
    if (interaction && interaction.targetId !== near?.id) closeInteraction();
  }, [near, interaction, closeInteraction]);

  // E (or Enter) uses the place you are standing at, on a keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.code === "KeyE" || event.code === "Enter") && near && !interaction) room.send("interact", { targetId: near.id });
      if (event.code === "Escape") {
        closeInteraction();
        closeInbox();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [near, interaction, room, closeInteraction, closeInbox]);

  const openPlace = interaction ? district.interactables.find((place) => place.id === interaction.targetId) : undefined;

  return (
    <>
      <Hud
        server={server}
        now={now}
        toasts={toasts}
        districtName={district.name}
        onAnswer={(choiceId, answer) => room.send("answerEvent", { choiceId, answer })}
        onOpenInbox={() => {
          closeInteraction();
          room.send("openInbox", {});
        }}
      />
      {near && !interaction && !inbox && (
        <button type="button" className={styles.use} onClick={() => open(near)}>
          {placePrompt(near)}
        </button>
      )}
      {inbox && <InboxPanel messages={inbox} stats={server?.stats ?? null} onClose={closeInbox} />}
      {interaction && openPlace && !inbox && (
        <PlacePanel
          interaction={interaction}
          label={openPlace.label}
          stats={server?.stats ?? null}
          now={now}
          room={room}
          onClose={closeInteraction}
        />
      )}
      {!interaction && !inbox && <p className={styles.disclaimer}>{COPY.hud.disclaimer}</p>}
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
