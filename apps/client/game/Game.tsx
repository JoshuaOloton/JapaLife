"use client";

import {
  type Appearance,
  COPY,
  type DistrictConfig,
  type DistrictHeader,
  type DistrictLayout,
  type Interactable,
  MAX_DEVICE_PIXEL_RATIO,
  type Point,
  type Route,
} from "@japalife/shared";
import { Canvas } from "@react-three/fiber";
import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CharacterCreator } from "./CharacterCreator";
import { describeDiagnostics, useDiagnostics } from "./diagnostics";
import {
  type Connection,
  type DistrictRoom,
  type MessageBuffer,
  useDistrictConnection,
  useLoadedDistrict,
} from "./connection";
import { placePrompt } from "./format";
import { FpsProbe, QualityProbe, useFpsMeterEnabled } from "./FpsMeter";
import { Hud, useTicker } from "./Hud";
import styles from "./hud.module.css";
import { InboxPanel } from "./InboxPanel";
import { MoveInput } from "./input";
import { Joystick } from "./Joystick";
import { MapScreen } from "./map/MapScreen";
import { paintMapBase } from "./map/mapPaint";
import { Minimap } from "./map/Minimap";
import { nearestPlace } from "./nearby";
import { PlacePanel } from "./PlacePanel";
import { ShaderWarmUp, WARM_UP_WHILE_HIDDEN } from "./ShaderWarmUp";
import { Player, type PlayerActivity } from "./Player";
import { RouteFollower, planRoute } from "./route";
import { useGameMessages } from "./useGameMessages";
import { World } from "./World";
import { FOG_FAR, Lighting } from "./world/Lighting";
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
  const diagnostics = useDiagnostics();
  // The way picked on the map: drawn on the minimap, the map and the street.
  const [route, setRoute] = useState<Route | null>(null);
  const fpsOutput = useRef<HTMLParagraphElement>(null);
  const street = useRef<StreetState>(initialStreet());
  // Halves the traffic and people for good if the frame rate stays low (adaptive quality).
  const quality = useMemo(() => new QualityGovernor(), []);
  // How your character looks right now (saved, or the creator's draft), and whether the creator has the camera.
  const [shownLook, setShownLook] = useState<Appearance | null>(null);
  const [closeUp, setCloseUp] = useState(false);
  // In the creator, how far you have turned your character round by dragging.
  const turn = useRef(0);
  const showLook = useCallback((look: Appearance | null, creatorOpen: boolean) => {
    setShownLook(look);
    setCloseUp(creatorOpen);
  }, []);
  useEffect(() => {
    if (closeUp) turn.current = 0;
  }, [closeUp]);

  useEffect(() => input.attachKeyboard(window), [input]);

  if (connection.status !== "connected") {
    return (
      <div style={{ position: "fixed", inset: 0, background: SKY_COLOUR }}>
        <p role="status" style={{ margin: 16, font: "600 16px system-ui, sans-serif", color: "#1d2b36" }}>
          {connection.status === "connecting" ? COPY.app.connecting : connection.message}
        </p>
        {connection.status === "failed" && connection.retry && (
          <button
            type="button"
            onClick={connection.retry}
            style={{
              margin: "0 16px",
              padding: "12px 20px",
              font: "600 16px system-ui, sans-serif",
              color: "#ffffff",
              background: "#2f7a55",
              border: "none",
              borderRadius: 10,
            }}
          >
            {COPY.app.tryAgain}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: SKY_COLOUR, touchAction: "none" }}>
      <Canvas
        // Phones report devicePixelRatio 2-3; drawing that many pixels melts weak GPUs.
        dpr={diagnostics.dpr ? [diagnostics.dpr, diagnostics.dpr] : [1, MAX_DEVICE_PIXEL_RATIO]}
        // Antialiasing costs a lot on mobile GPUs and matters little at 1.5x.
        gl={{ antialias: false, powerPreference: "high-performance" }}
        // The haze hides everything past FOG_FAR, so nothing beyond it needs drawing.
        camera={{ fov: 50, near: 0.5, far: FOG_FAR + 5 }}
      >
        <Lighting street={street} indoors={closeUp} />
        <Scene connection={connection}>
          {(district) => (
            <>
              {/* The creator takes place in a bedroom set, so the street is hidden (still simulated) meanwhile. */}
              <group visible={!closeUp} userData={{ [WARM_UP_WHILE_HIDDEN]: true }}>
                <World
                  district={district}
                  header={connection.header}
                  hide={diagnostics.hide}
                  route={route}
                  street={street}
                  predicted={predicted}
                  quality={quality}
                />
              </group>
              <Player
                room={connection.room}
                district={district}
                input={input}
                predicted={predicted}
                activity={activity}
                appearance={shownLook}
                closeUp={closeUp}
                turn={turn}
              />
            </>
          )}
        </Scene>
        <QualityProbe quality={quality} />
        <ShaderWarmUp />
        {showFps && <FpsProbe output={fpsOutput} quality={quality} switches={describeDiagnostics(diagnostics)} />}
      </Canvas>
      {touch && !closeUp && <Joystick input={input} />}
      {closeUp && <TurnArea turn={turn} />}
      {/* Going into or out of the bedroom cuts the scene; a quick fade from black hides the cut. */}
      <div key={closeUp ? "indoors" : "street"} className={styles.sceneFade} />
      {connection.dropped && (
        <p role="status" className={styles.reconnecting}>
          {COPY.app.reconnecting}
        </p>
      )}
      <Overlay
        room={connection.room}
        messages={connection.messages}
        district={connection.district}
        header={connection.header}
        input={input}
        route={route}
        onRoute={setRoute}
        predicted={predicted}
        activity={activity}
        street={street}
        fpsOutput={showFps ? fpsOutput : undefined}
        onLook={showLook}
      />
    </div>
  );
}

/** Hands its children the district as far as the loaded chunks go, re-rendering them as chunks arrive. */
function Scene({
  connection,
  children,
}: {
  connection: Extract<Connection, { status: "connected" }>;
  children: (district: DistrictLayout) => ReactNode;
}) {
  return children(useLoadedDistrict(connection.district, connection.chunks));
}

/** Radians your character turns per pixel dragged. */
const TURN_PER_PIXEL = 0.012;

/** In the creator, dragging across the view turns your character round to see them from every side. */
function TurnArea({ turn }: { turn: { current: number } }) {
  const lastX = useRef<number | null>(null);
  return (
    <div
      className={styles.turnArea}
      onPointerDown={(event) => {
        lastX.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (lastX.current === null) return;
        turn.current += (event.clientX - lastX.current) * TURN_PER_PIXEL;
        lastX.current = event.clientX;
      }}
      onPointerUp={() => (lastX.current = null)}
      onPointerCancel={() => (lastX.current = null)}
    />
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
  header,
  input,
  route,
  onRoute,
  predicted,
  activity,
  street,
  fpsOutput,
  onLook,
}: {
  room: DistrictRoom;
  messages: MessageBuffer;
  district: DistrictLayout;
  /** What came on join: every road and building outline, for the map. */
  header: DistrictHeader;
  /** Walks a route by itself ("walk there"). */
  input: MoveInput;
  route: Route | null;
  onRoute: (route: Route | null) => void;
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

  // The map: painted once from the header; tap a spot for the way there by road, then "walk there".
  const mapBase = useMemo(() => paintMapBase(header), [header]);
  const [mapOpen, setMapOpen] = useState(false);
  const [walking, setWalking] = useState(false);
  const [mapStatus, setMapStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!mapStatus) return;
    const timer = window.setTimeout(() => setMapStatus(null), MAP_STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [mapStatus]);
  const pickOnMap = useCallback(
    (point: Point) => {
      input.clearAutopilot();
      setWalking(false);
      const picked = planRoute(header, predicted.current, point);
      onRoute(picked ?? null);
      if (!picked) setMapStatus(COPY.map.noRoute);
    },
    [header, input, onRoute, predicted],
  );
  const walkRoute = (): void => {
    if (!route) return;
    input.setAutopilot(new RouteFollower(route.points), (end) => {
      setWalking(false);
      if (end === "arrived") {
        onRoute(null);
        setMapStatus(COPY.map.arrived);
      } else if (end === "stuck") {
        setMapStatus(COPY.map.stuck);
      }
    });
    setWalking(true);
    setMapOpen(false);
  };
  const stopWalking = (): void => {
    input.clearAutopilot();
    setWalking(false);
  };
  const clearRoute = (): void => {
    stopWalking();
    onRoute(null);
  };

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
          {!interaction && !inbox && !mapOpen && (
            <Minimap header={header} base={mapBase} predicted={predicted} route={route} onOpen={() => setMapOpen(true)} />
          )}
          {walking && !mapOpen && (
            <button type="button" className={styles.mapStop} onClick={stopWalking}>
              {COPY.map.stop}
            </button>
          )}
          {mapStatus && !mapOpen && <p className={styles.mapStatus}>{mapStatus}</p>}
          {mapOpen && (
            <MapScreen
              header={header}
              base={mapBase}
              predicted={predicted}
              route={route}
              walking={walking}
              onPick={pickOnMap}
              onWalk={walkRoute}
              onClear={clearRoute}
              onClose={() => setMapOpen(false)}
            />
          )}
        </>
      )}
    </>
  );
}

/** How long a line like "You're there." stays up. */
const MAP_STATUS_MS = 3000;

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
