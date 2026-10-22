"use client";

import {
  type Appearance,
  type DistrictLayout,
  PLAYER_RADIUS,
  PLAYER_SPEED_UNITS_PER_SECOND,
  type Point,
  decodeAppearance,
  districtObstacles,
  encodeAppearance,
  moveWithCollisions,
  obstacleGrid,
} from "@japalife/shared";
import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type Group, PerspectiveCamera, Vector3 } from "three";
import { fitCamera } from "./camera";
import type { CharacterMotion } from "./character/animation";
import { resolveLook } from "./character/appearance";
import { Character } from "./character/Character";
import { ModelBoundary } from "./ModelBoundary";
import type { DistrictRoom } from "./connection";
import { DressingRoom } from "./DressingRoom";
import type { MoveInput } from "./input";
import { MoveSender } from "./moveSender";
import { reconcile } from "./reconcile";
import { INTERPOLATION_DELAY_MS, SnapshotBuffer } from "./snapshots";

const BODY_LENGTH = 1;
const BODY_COLOUR = "#2e7d4f";

/** Where the camera sits relative to the player: up and behind (south), looking north. */
const CAMERA_OFFSET = new Vector3(0, 9, 11);
/** How tightly the camera follows, per second. Lower is floatier. */
const CAMERA_FOLLOW_RATE = 6;
const TURN_RATE = 12;

/**
 * The character creator's close-up: in front at chest height, aimed near the
 * feet so the whole person stands in the band between the HUD bar and the
 * creator's sheet (which covers the bottom 42% of the screen). The creator
 * takes place in a bedroom set (`DressingRoom`), so the camera cuts to it
 * (under a fade) rather than gliding.
 */
const CLOSE_UP_OFFSET = new Vector3(0, 1.3, 5.6);
const CLOSE_UP_LOOK_HEIGHT = 0.2;
/** How far behind the close-up camera the bedroom's front wall stands. */
const ROOM_BEHIND_CAMERA = 0.8;
/** Heading that faces the camera (south, +z). */
const FACE_CAMERA = 0;
const STILL = { x: 0, z: 0 } as const;

/** Same cap as the server, so one long frame (a phone waking up) cannot fling the player. */
const MAX_FRAME_SECONDS = 0.25;
/** How quickly the measured speed follows the real one, per second. Smooths out uneven frames. */
const SPEED_SMOOTHING_RATE = 12;

/** What the HUD knows that the animation needs: on shift at the job site, and when a place was last used. */
export interface PlayerActivity {
  working: boolean;
  gestureAt: number;
}

/**
 * The local player. Each frame it:
 *  1. reads the joystick/keys and tells the server the direction (an intent),
 *  2. predicts the walk itself with the SAME collision code the server runs,
 *     so movement feels instant instead of waiting a round trip,
 *  3. nudges the prediction toward the server's interpolated position, which is the truth,
 *  4. moves the camera smoothly after it.
 */
export function Player({
  room,
  district,
  input,
  predicted,
  activity,
  appearance,
  closeUp,
  turn,
}: {
  room: DistrictRoom;
  district: DistrictLayout;
  input: MoveInput;
  /** Where the player is drawn. Owned by the parent so the HUD can see which place is near. */
  predicted: { current: Point };
  activity: { current: PlayerActivity };
  /** How the player looks: the saved character, or the creator's draft. Null shows the catalog's default. */
  appearance: Appearance | null;
  /** The character creator is open: stand still in the bedroom set, face the camera, and bring the camera in. */
  closeUp: boolean;
  /** In the creator, how far the player has turned the character round by dragging (radians). */
  turn: { current: number };
}) {
  const body = useRef<Group>(null);
  const bedroom = useRef<Group>(null);
  const camera = useThree((three) => three.camera);
  const aspect = useThree((three) => three.size.width / three.size.height);
  const offset = useMemo(() => {
    const { fov, distanceScale } = fitCamera(aspect);
    if (camera instanceof PerspectiveCamera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    return CAMERA_OFFSET.clone().multiplyScalar(distanceScale);
  }, [aspect, camera]);
  const closeOffset = useMemo(() => CLOSE_UP_OFFSET.clone().multiplyScalar(offset.length() / CAMERA_OFFSET.length()), [offset]);
  const viewOffset = useMemo(() => new Vector3(), []);
  // 1 in the creator's close-up, 0 on the street. Switches at once: the fade hides the cut.
  const zoom = useRef(0);
  // Keyed by the look's code, not the object: an equal appearance arriving as a
  // new object must not rebuild the character, only a real change (a tap in the
  // creator, a saved change) does.
  const shown = appearance ?? district.characters.defaults;
  const lookCode = encodeAppearance(shown);
  const look = useMemo(
    () => resolveLook(decodeAppearance(lookCode) ?? district.characters.defaults, district.characters, district.models),
    // Not the whole district: it changes as chunks arrive, and the character must not rebuild then.
    [lookCode, district.characters, district.models],
  );
  const heading = useRef(Math.PI); // facing north, away from the camera
  const sender = useMemo(() => new MoveSender(room), [room]);
  const server = useMemo(() => new SnapshotBuffer(), []);
  const cameraTarget = useMemo(() => new Vector3(), []);
  const lookAt = useMemo(() => new Vector3(), []);
  const motion = useRef<CharacterMotion>({ speed: 0, working: false, gestureAt: Number.NEGATIVE_INFINITY });
  // The same walls, props and people the server stops the player at, so the prediction agrees with it.
  // Rebuilt as chunks arrive; the chunks next to the player's are always loaded, so no wall it could touch is missing.
  const obstacles = useMemo(() => obstacleGrid(districtObstacles(district)), [district]);

  useEffect(() => {
    const record = (): void => {
      const mine = room.state.players.get(room.sessionId);
      if (mine) server.push({ t: performance.now(), x: mine.x, z: mine.z });
    };
    record();
    room.onStateChange(record);
    return () => room.onStateChange.remove(record);
  }, [room, server]);

  // Rendering pauses in a hidden tab, so stop walking now rather than when it comes back.
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState !== "hidden") return;
      input.clear();
      sender.stop(performance.now());
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [input, sender]);

  // The server spawns every joining player here; start the prediction at the same spot.
  useLayoutEffect(() => {
    predicted.current = { ...district.spawn };
  }, [district.spawn, predicted]);

  // Put the camera in place before the first frame, so the scene does not swoop in.
  useEffect(() => {
    const { x, z } = predicted.current;
    camera.position.set(x + offset.x, offset.y, z + offset.z);
    camera.lookAt(x, 1, z);
  }, [camera, offset, predicted]);

  useFrame((_, frameSeconds) => {
    const dt = Math.min(frameSeconds, MAX_FRAME_SECONDS);
    const now = performance.now();
    // In the character creator the player stands still and turns to face the camera.
    const direction = closeUp ? STILL : input.direction();
    const moving = direction.x !== 0 || direction.z !== 0;
    sender.update(direction, now);

    let position = moveWithCollisions(
      predicted.current,
      { x: direction.x * PLAYER_SPEED_UNITS_PER_SECOND * dt, z: direction.z * PLAYER_SPEED_UNITS_PER_SECOND * dt },
      obstacles,
      district,
    );
    const truth = server.sample(now - INTERPOLATION_DELAY_MS);
    if (truth) {
      position = reconcile({
        predicted: position,
        server: truth,
        moving,
        deltaSeconds: dt,
        obstacles,
        bounds: district,
      });
    }
    // Speed from how far the player really moved, so walking into a wall stops the run animation.
    const previous = predicted.current;
    const speed = dt > 0 ? Math.hypot(position.x - previous.x, position.z - previous.z) / dt : 0;
    motion.current.speed += (speed - motion.current.speed) * (1 - Math.exp(-SPEED_SMOOTHING_RATE * dt));
    motion.current.working = activity.current.working;
    motion.current.gestureAt = activity.current.gestureAt;
    predicted.current = position;

    const group = body.current;
    if (group) {
      group.position.set(position.x, 0, position.z);
      if (moving || closeUp) {
        const want = closeUp ? FACE_CAMERA + turn.current : Math.atan2(direction.x, direction.z);
        // Turn the short way round, smoothly.
        const diff = Math.atan2(Math.sin(want - heading.current), Math.cos(want - heading.current));
        heading.current += diff * (1 - Math.exp(-TURN_RATE * dt));
        group.rotation.y = heading.current;
      }
    }

    bedroom.current?.position.set(position.x, 0, position.z);

    // Cut between the street camera and the creator's close-up (a fade covers it): a glide
    // would swing the camera through the bedroom's walls.
    const cut = zoom.current !== (closeUp ? 1 : 0);
    zoom.current = closeUp ? 1 : 0;
    viewOffset.lerpVectors(offset, closeOffset, zoom.current);
    const lookHeight = 1 + (CLOSE_UP_LOOK_HEIGHT - 1) * zoom.current;
    cameraTarget.set(position.x + viewOffset.x, viewOffset.y, position.z + viewOffset.z);
    if (cut) camera.position.copy(cameraTarget);
    else camera.position.lerp(cameraTarget, 1 - Math.exp(-CAMERA_FOLLOW_RATE * dt));
    // Look at a point that trails the camera the same way, so the view never tilts while following.
    lookAt.set(camera.position.x - viewOffset.x, lookHeight, camera.position.z - viewOffset.z);
    camera.lookAt(lookAt);
  });

  const standIn = <Capsule />;
  return (
    <>
      {/* Placed on the player every frame (they stand still while it is up). */}
      {closeUp && (
        <group ref={bedroom}>
          <DressingRoom frontZ={closeOffset.z + ROOM_BEHIND_CAMERA} />
        </group>
      )}
      <group ref={body}>
        {/* The capsule shows while the model downloads, or for good if the download fails. */}
        <ModelBoundary fallback={standIn}>
          <Suspense fallback={standIn}>
            <Character look={look} motion={motion} />
          </Suspense>
        </ModelBoundary>
        {/* A dark disc instead of a real shadow: almost free on the GPU. */}
        <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
          <circleGeometry args={[PLAYER_RADIUS * 1.3, 16]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.3} />
        </mesh>
      </group>
    </>
  );
}

/** The placeholder body: a capsule with a nose, so you can see which way it faces. */
function Capsule() {
  return (
    <>
      <mesh position-y={PLAYER_RADIUS + BODY_LENGTH / 2}>
        <capsuleGeometry args={[PLAYER_RADIUS, BODY_LENGTH, 4, 10]} />
        <meshLambertMaterial color={BODY_COLOUR} />
      </mesh>
      <mesh position={[0, PLAYER_RADIUS + BODY_LENGTH * 0.8, PLAYER_RADIUS * 0.9]}>
        <boxGeometry args={[0.25, 0.15, 0.2]} />
        <meshLambertMaterial color="#f2d16b" />
      </mesh>
    </>
  );
}
