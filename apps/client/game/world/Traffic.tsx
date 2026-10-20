"use client";

import type { DistrictLayout, ModelInfo, Point, VehicleKind } from "@japalife/shared";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSET_ROOT, withDecoders } from "../character/loaders";
import { ModelBoundary } from "../ModelBoundary";
import type { QualityGovernor } from "./quality";
import { localHour } from "./sky";
import type { StreetState } from "./street";
import { type TrafficWorld, type Vehicle, activeShare, createTraffic, pointOnLane, stepTraffic } from "./trafficSim";
import { BODY_PAINT_ATTRIBUTE, addBodyPaint } from "./vehiclePaint";
import { type BuiltVehicleLook, builtVehicleParts } from "./vehicleShapes";
import { flagUvCells } from "./windowGlass";

/**
 * The street traffic: danfos, cars, keke and okadas driving the district's
 * lanes. Client-only and cosmetic (see `trafficSim.ts`). Every copy of a car model
 * is one instanced mesh whose positions are rewritten each frame, and every
 * keke and okada is part of one moving instanced box mesh, so the whole fleet
 * costs a handful of draw calls.
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

  const modelKinds = useMemo(
    () =>
      Object.entries(kinds).flatMap(([id, kind]) => {
        const model = "model" in kind.look ? layout.models[kind.look.model] : undefined;
        return model && "model" in kind.look ? [{ id, look: kind.look, model }] : [];
      }),
    [kinds, layout.models],
  );

  return (
    <>
      {modelKinds.map(({ id, look, model }) => (
        // No stand-in while a model downloads: traffic arrives after the street is on screen.
        <ModelBoundary key={id} fallback={null}>
          <Suspense fallback={null}>
            <ModelFleet world={world} kindId={id} look={look} model={model} />
          </Suspense>
        </ModelBoundary>
      ))}
      <BuiltFleet world={world} kinds={kinds} />
    </>
  );
}

/** Where a vehicle stands and which way it faces, or null while it is parked off the road. */
function placeVehicle(vehicle: Vehicle, scale: number, target: Matrix4): Matrix4 | null {
  if (vehicle.parked) return null;
  const { x, z, heading } = pointOnLane(vehicle.lane, vehicle.s);
  return target.compose(new Vector3(x, 0, z), new Quaternion().setFromAxisAngle(UP, heading), new Vector3(scale, scale, scale));
}

/** Every vehicle of one model kind, as one instanced mesh per mesh in the model. */
function ModelFleet({
  world,
  kindId,
  look,
  model,
}: {
  world: TrafficWorld;
  kindId: string;
  look: Extract<VehicleKind["look"], { model: string }>;
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
      if (look.paint && model.paint) {
        flagUvCells(object.geometry, model.paint, BODY_PAINT_ATTRIBUTE);
        const stripe = look.stripe
          ? { colour: look.stripe.colour, from: look.stripe.from * model.height, to: look.stripe.to * model.height }
          : undefined;
        addBodyPaint(material, { paint: look.paint, stripe });
      }
      const mesh = new InstancedMesh(object.geometry, material, Math.max(1, fleet.length));
      // The instances move every frame, so their bounds are never up to date; there are few of them.
      mesh.frustumCulled = false;
      root.add(mesh);
      parts.push({ mesh, local: object.matrixWorld.clone() });
    });
    return { group: root, meshes: parts };
  }, [gltf, look, model, fleet.length]);

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

/** Every keke and okada (and rider) as parts of one moving instanced box mesh: one draw call for all of them. */
function BuiltFleet({ world, kinds }: { world: TrafficWorld; kinds: Readonly<Record<string, VehicleKind>> }) {
  const slots = useMemo(
    () =>
      world.vehicles.flatMap((vehicle) => {
        const look = kinds[vehicle.kind]?.look;
        if (!look || !("built" in look)) return [];
        return builtVehicleParts(look as BuiltVehicleLook).map((part) => ({
          vehicle,
          colour: part.colour,
          local: new Matrix4().compose(
            new Vector3(part.dx, part.y + part.height / 2, part.dz),
            new Quaternion(),
            new Vector3(part.halfWidth * 2, part.height, part.halfDepth * 2),
          ),
        }));
      }),
    [world, kinds],
  );
  const geometry = useMemo(() => new BoxGeometry(), []);
  const mesh = useRef<InstancedMesh>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const colour = new Color();
    slots.forEach((slot, index) => instanced.setColorAt(index, colour.set(slot.colour)));
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  }, [slots]);

  const placed = useMemo(() => new Matrix4(), []);
  const combined = useMemo(() => new Matrix4(), []);
  useFrame(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    let current: Vehicle | undefined;
    let at: Matrix4 | null = null;
    slots.forEach((slot, index) => {
      if (slot.vehicle !== current) {
        current = slot.vehicle;
        at = placeVehicle(slot.vehicle, 1, placed);
      }
      instanced.setMatrixAt(index, at ? combined.multiplyMatrices(at, slot.local) : HIDDEN);
    });
    instanced.instanceMatrix.needsUpdate = true;
  });

  if (slots.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, slots.length]} key={slots.length} frustumCulled={false}>
      <meshLambertMaterial />
    </instancedMesh>
  );
}
