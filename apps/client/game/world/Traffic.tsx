"use client";

import type { DistrictLayout, ModelInfo, Point, VehicleKind } from "@japalife/shared";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import { Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, type MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSET_ROOT, withDecoders } from "../character/loaders";
import { ModelBoundary } from "../ModelBoundary";
import type { QualityGovernor } from "./quality";
import { localHour } from "./sky";
import type { StreetState } from "./street";
import { type TrafficWorld, type Vehicle, activeShare, createTraffic, pointOnLane, stepTraffic } from "./trafficSim";

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

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
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
  const { schedule, kinds } = layout.vehicles;

  useFrame((_, frameSeconds) => {
    const { serverNow, timeZone } = street.current;
    const hour = serverNow && timeZone ? localHour(serverNow(), timeZone) : DEFAULT_HOUR;
    const share = (kind: string): number => activeShare(schedule, hour, kinds[kind]?.rushHourBoost ?? false) * quality.scale;
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
            <ModelFleet world={world} kindId={id} look={look} model={model} />
          </Suspense>
        </ModelBoundary>
      ))}
    </>
  );
}

/** Where a vehicle stands and which way it faces, or null while it is parked off the road. */
function placeVehicle(vehicle: Vehicle, scale: number, target: Matrix4): Matrix4 | null {
  if (vehicle.parked) return null;
  const { x, z, heading } = pointOnLane(vehicle.lane, vehicle.s);
  return target.compose(new Vector3(x, 0, z), new Quaternion().setFromAxisAngle(UP, heading), new Vector3(scale, scale, scale));
}

/** Every vehicle of one kind, as one instanced mesh per mesh in its model (usually just one). */
function ModelFleet({
  world,
  kindId,
  look,
  model,
}: {
  world: TrafficWorld;
  kindId: string;
  look: VehicleKind["look"];
  model: ModelInfo;
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
    fleet.forEach((vehicle, index) => {
      const at = placeVehicle(vehicle, look.scale, placed);
      for (const { mesh, local } of meshes) mesh.setMatrixAt(index, at ? combined.multiplyMatrices(at, local) : HIDDEN);
    });
    for (const { mesh } of meshes) mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={group} />;
}
