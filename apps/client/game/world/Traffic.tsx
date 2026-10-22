"use client";

import { type Box, type DistrictLayout, type ModelInfo, type Point, type VehicleKind, seededRandom } from "@japalife/shared";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, type MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSET_ROOT, withDecoders } from "../character/loaders";
import { ModelBoundary } from "../ModelBoundary";
import { DRAW_REACH, TRAFFIC_REACH, areaBox, areaCell, busyShare } from "./area";
import type { QualityGovernor } from "./quality";
import { localHour } from "./sky";
import type { StreetState } from "./street";
import {
  type LanePoint,
  type TrafficWorld,
  type Vehicle,
  activeShare,
  createTraffic,
  pointOnLane,
  setTrafficWindow,
  stepTraffic,
} from "./trafficSim";

const NO_AREAS: readonly Box[] = [];

/**
 * The street traffic: danfos, keke, okadas and cars driving the district's
 * lanes. Client-only and cosmetic (see `trafficSim.ts`). Every copy of a
 * vehicle model is one instanced mesh whose positions are rewritten each
 * frame, so the whole fleet costs about one draw call per kind of vehicle.
 */

/** Before the first stats arrive, the street looks like midday. */
const DEFAULT_HOUR = 12;
/** A long frame (a phone waking up) must not fling the traffic down the road. */
const MAX_STEP_SECONDS = 0.1;
/** Runs before the drawing frame callbacks (lower runs first; negative never takes over rendering). */
const SIMULATE_FIRST = -1;

const UP = new Vector3(0, 1, 0);

export function Traffic({
  layout,
  predicted,
  street,
  quality,
}: {
  layout: DistrictLayout;
  predicted: { current: Point };
  street: { current: StreetState };
  quality: QualityGovernor;
}) {
  const world = useMemo(() => createTraffic(layout), [layout]);
  const random = useMemo(() => seededRandom(0x7aff1d), []);
  const { schedule, kinds } = layout.vehicles;
  const busyAreas = layout.traffic?.busyAreas ?? NO_AREAS;

  // Only the traffic around the player is simulated; the window moves when they cross into another area cell.
  const windowCell = useRef<Point | null>(null);
  useFrame((_, frameSeconds) => {
    const cell = areaCell(predicted.current);
    if (!windowCell.current || windowCell.current.x !== cell.x || windowCell.current.z !== cell.z) {
      windowCell.current = cell;
      setTrafficWindow(world, areaBox(cell, TRAFFIC_REACH), random);
    }
    const { serverNow, timeZone } = street.current;
    const hour = serverNow && timeZone ? localHour(serverNow(), timeZone) : DEFAULT_HOUR;
    // Busier at the markets and motor parks, calmer on the back streets.
    const here = busyShare(busyAreas, schedule.calmShare, predicted.current) * quality.scale;
    const share = (kind: string): number => activeShare(schedule, hour, kinds[kind]?.rushHourBoost ?? false) * here;
    stepTraffic(world, Math.min(frameSeconds, MAX_STEP_SECONDS), predicted.current, share);
  }, SIMULATE_FIRST);

  const fleets = useMemo(
    () =>
      Object.entries(kinds).flatMap(([id, kind]) => {
        const model = layout.models[kind.look.model];
        return model ? [{ id, look: kind.look, model }] : [];
      }),
    [kinds, layout.models],
  );

  return (
    <>
      {fleets.map(({ id, look, model }) => (
        // No stand-in while a model downloads: traffic arrives after the street is on screen.
        <ModelBoundary key={id} fallback={null}>
          <Suspense fallback={null}>
            <ModelFleet world={world} kindId={id} look={look} model={model} predicted={predicted} />
          </Suspense>
        </ModelBoundary>
      ))}
    </>
  );
}

/** Reused every frame: new ones per vehicle per frame fed the garbage collector, whose pauses are hitches. */
const PLACE = { position: new Vector3(), turn: new Quaternion(), size: new Vector3(), on: { x: 0, z: 0, heading: 0 } as LanePoint };

/** Where a vehicle stands and which way it faces, or null while it is parked off the road. */
function placeVehicle(vehicle: Vehicle, scale: number, target: Matrix4): Matrix4 | null {
  if (vehicle.parked) return null;
  const { x, z, heading } = pointOnLane(vehicle.lane, vehicle.s, PLACE.on);
  return target.compose(
    PLACE.position.set(x, 0, z),
    PLACE.turn.setFromAxisAngle(UP, heading),
    PLACE.size.setScalar(scale),
  );
}

/** Every vehicle of one kind, as one instanced mesh per mesh in its model (usually just one). */
function ModelFleet({
  world,
  kindId,
  look,
  model,
  predicted,
}: {
  world: TrafficWorld;
  kindId: string;
  look: VehicleKind["look"];
  model: ModelInfo;
  /** Where the player is: only vehicles in the drawn area around them are drawn. */
  predicted: { current: Point };
}) {
  const gl = useThree((three) => three.gl);
  const gltf = useLoader(GLTFLoader, `${ASSET_ROOT}/${model.file}`, withDecoders(gl));
  const fleet = useMemo(() => world.vehicles.filter((vehicle) => vehicle.kind === kindId), [world, kindId]);

  const { group, meshes } = useMemo(() => {
    const root = new Group();
    const parts: { mesh: InstancedMesh; local: Matrix4 }[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const original = object.material as MeshStandardMaterial;
      // Lambert, not the glTF's physically based material: far cheaper on a weak GPU.
      const material = new MeshLambertMaterial({ map: original.map, color: original.color.clone() });
      const mesh = new InstancedMesh(object.geometry, material, Math.max(1, fleet.length));
      // The instances move every frame, so their bounds are never up to date; there are few of them.
      mesh.frustumCulled = false;
      root.add(mesh);
      parts.push({ mesh, local: object.matrixWorld.clone() });
    });
    return { group: root, meshes: parts };
  }, [gltf, fleet.length]);

  // Geometry and textures belong to the loader's cache; only the materials are ours.
  useEffect(
    () => () => {
      for (const { mesh } of meshes) (mesh.material as MeshLambertMaterial).dispose();
    },
    [meshes],
  );

  const placed = useMemo(() => new Matrix4(), []);
  const combined = useMemo(() => new Matrix4(), []);
  useFrame(() => {
    // Only vehicles in the drawn area take a slot: the rest of the district's traffic costs the GPU nothing.
    const area = areaBox(predicted.current, DRAW_REACH);
    let shown = 0;
    for (const vehicle of fleet) {
      const at = placeVehicle(vehicle, look.scale, placed);
      if (!at) continue;
      const x = at.elements[12] ?? 0;
      const z = at.elements[14] ?? 0;
      if (Math.abs(x - area.x) > area.halfWidth || Math.abs(z - area.z) > area.halfDepth) continue;
      for (const { mesh, local } of meshes) mesh.setMatrixAt(shown, combined.multiplyMatrices(at, local));
      shown++;
    }
    for (const { mesh } of meshes) {
      mesh.count = shown;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return <primitive object={group} />;
}
