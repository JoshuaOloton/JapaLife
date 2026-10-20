"use client";

import {
  type Appearance,
  COPY,
  type DistrictConfig,
  type DistrictLayout,
  type Interactable,
  MAX_DEVICE_PIXEL_RATIO,
  type Point,
} from "@japalife/shared";
import { Canvas } from "@react-three/fiber";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CharacterCreator } from "./CharacterCreator";
import { type DistrictRoom, type MessageBuffer, useDistrictConnection } from "./connection";
import { placePrompt } from "./format";
import { FpsProbe, QualityProbe, useFpsMeterEnabled } from "./FpsMeter";
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
import { QualityGovernor } from "./world/quality";
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
  // Halves the traffic and people for good if the frame rate stays low (adaptive quality).
  const quality = useMemo(() => new QualityGovernor(), []);
  // How your character looks right now (saved, or the creator's draft), and whether the creator has the camera.
  const [shownLook, setShownLook] = useState<Appearance | null>(null);
  const [closeUp, setCloseUp] = useState(false);
  const showLook = useCallback((look: Appearance | null, creatorOpen: boolean) => {
    setShownLook(look);
    setCloseUp(creatorOpen);
  }, []);

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
        <World district={connection.district} street={street} predicted={predicted} quality={quality} />
        <Player
          room={connection.room}
          district={connection.district}
          input={input}
          predicted={predicted}
          activity={activity}
          appearance={shownLook}
          closeUp={closeUp}
        />
        <QualityProbe quality={quality} />
        {showFps && <FpsProbe output={fpsOutput} quality={quality} />}
      </Canvas>
      {touch && !closeUp && <Joystick input={input} />}
      <Overlay
        room={connection.room}
        messages={connection.messages}
        district={connection.district}
        predicted={predicted}
        activity={activity}
        street={street}
        fpsOutput={showFps ? fpsOutput : undefined}
        onLook={showLook}
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
  fpsOutput,
  onLook,
}: {
  room: DistrictRoom;
  messages: MessageBuffer;
  district: DistrictLayout;
  predicted: { current: Point };
  activity: { current: PlayerActivity };
  street: { current: StreetState };
  fpsOutput: RefObject<HTMLParagraphElement | null> | undefined;
  /** Tells the 3D view how your character looks and whether the creator is open. */
  onLook: (look: Appearance | null, creatorOpen: boolean) => void;
}) {
  const { server, toasts, interaction, closeInteraction, inbox, closeInbox, appearance, appearanceSaves, appearanceRefusals } =
    useGameMessages(messages);
  const now = useTicker(server);
  const near = useNearbyPlace(district, predicted);
  const [editing, setEditing] = useState<{ mode: "create" | "change"; draft: Appearance; saving: boolean } | null>(null);

  // A new player makes their character before anything else (the server says null).
  useEffect(() => {
    if (appearance === null && !editing) setEditing({ mode: "create", draft: district.characters.defaults, saving: false });
  }, [appearance, editing, district]);
  // The server saved it: close the creator. Refused: let them try again.
  useEffect(() => setEditing((current) => (current?.saving ? null : current)), [appearanceSaves]);
  useEffect(() => setEditing((current) => (current?.saving ? { ...current, saving: false } : current)), [appearanceRefusals]);
  // Show the draft live on your character; otherwise what the server saved.
  useEffect(() => onLook(editing?.draft ?? appearance ?? null, editing !== null), [editing, appearance, onLook]);

  const changeClothes = (): void => {
    closeInteraction();
    setEditing({ mode: "change", draft: appearance ?? district.characters.defaults, saving: false });
  };
  const saveLook = (): void => {
    if (!editing) return;
    room.send("setAppearance", editing.draft);
    setEditing({ ...editing, saving: true });
  };

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
        fpsOutput={fpsOutput}
      />
      {editing ? (
        <CharacterCreator
          catalog={district.characters}
          draft={editing.draft}
          mode={editing.mode}
          saving={editing.saving}
          onChange={(draft) => setEditing({ ...editing, draft })}
          onDone={saveLook}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <>
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
              onChangeClothes={changeClothes}
            />
          )}
          {!interaction && !inbox && <p className={styles.disclaimer}>{COPY.hud.disclaimer}</p>}
        </>
      )}
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
