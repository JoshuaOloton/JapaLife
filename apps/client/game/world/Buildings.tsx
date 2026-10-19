"use client";

import type { Building, ModelInfo } from "@japalife/shared";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import { Color, type InstancedMesh, Mesh, MeshLambertMaterial, type MeshStandardMaterial, Object3D } from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSET_ROOT, withDecoders } from "../character/loaders";
import { ModelBoundary } from "../ModelBoundary";
import type { Slab } from "./Boxes";
import type { StreetState } from "./street";
import { WINDOW_HEIGHT, WINDOW_WIDTH, type WindowSpot, isWindowLit, streetPower, windowsOf } from "./windows";

/**
 * Yaba's buildings. A building with a `model` draws that model, rotated and
 * scaled as its config says, and shows the plain box while it downloads (or
 * if the download fails). A building without one is a painted cement box with
 * a zinc roof and windows that light up at night.
 *
 * Either way the footprint in the city file is what stops the player; the
 * server refuses to start if a model does not fill it.
 */

const ROOF_THICKNESS = 0.25;
const ROOF_OVERHANG = 0.3;
/** Zinc goes from new grey to rusty brown; each roof gets one, from its id. */
const ZINC_COLOURS = ["#8d9196", "#7b7f82", "#8a6a52", "#7a5640", "#96999c"] as const;

const WINDOW_COLOURS = { glass: "#34424e", lit: "#ffd98a", dark: "#161b22" } as const;
/** How often the windows check whether night fell or the power went. */
const WINDOW_CHECK_SECONDS = 1;

/** The boxes for plain buildings: walls and roofs, drawn by the world's single `Boxes` call. */
export function plainBuildingSlabs(buildings: readonly Building[]): Slab[] {
  return buildings.flatMap((building, index) => [
    { ...building, height: building.height - ROOF_THICKNESS },
    {
      x: building.x,
      z: building.z,
      halfWidth: building.halfWidth + ROOF_OVERHANG,
      halfDepth: building.halfDepth + ROOF_OVERHANG,
      height: ROOF_THICKNESS,
      y: building.height - ROOF_THICKNESS,
      colour: ZINC_COLOURS[index % ZINC_COLOURS.length] ?? ZINC_COLOURS[0],
    },
  ]);
}

/** Buildings that have a model, each with its plain box as the stand-in. */
export function ModelBuildings({
  buildings,
  models,
}: {
  buildings: readonly Building[];
  models: Readonly<Record<string, ModelInfo>>;
}) {
  return (
    <>
      {buildings.map((building) => {
        const model = building.model ? models[building.model] : undefined;
        if (!model) return null;
        const standIn = <PlainBox building={building} />;
        return (
          <ModelBoundary key={building.id} fallback={standIn}>
            <Suspense fallback={standIn}>
              <BuildingModel building={building} model={model} />
            </Suspense>
          </ModelBoundary>
        );
      })}
    </>
  );
}

function BuildingModel({ building, model }: { building: Building; model: ModelInfo }) {
  const gl = useThree((three) => three.gl);
  const gltf = useLoader(GLTFLoader, `${ASSET_ROOT}/${model.file}`, withDecoders(gl));
  const object = useMemo(() => cheapCopy(gltf), [gltf]);
  return (
    <primitive
      object={object}
      position={[building.x, 0, building.z]}
      rotation-y={(building.rotation * Math.PI) / 180}
      scale={building.scale}
    />
  );
}

/** Lambert materials replacing the model's PBR ones, made once per model and shared by every copy. */
const cheapMaterials = new WeakMap<GLTF, true>();

/**
 * A copy of the model with cheap materials. glTF loads physically based
 * materials, which cost far more shader time on a weak GPU than Lambert, and
 * our lighting has no reflections for them to show anyway.
 */
function cheapCopy(gltf: GLTF): Object3D {
  if (!cheapMaterials.has(gltf)) {
    const replaced = new Map<unknown, MeshLambertMaterial>();
    gltf.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const original = object.material as MeshStandardMaterial;
      let cheap = replaced.get(original);
      if (!cheap) {
        cheap = new MeshLambertMaterial({ map: original.map, color: original.color });
        replaced.set(original, cheap);
      }
      object.material = cheap;
    });
    cheapMaterials.set(gltf, true);
  }
  return gltf.scene.clone();
}

/** One plain building on its own (a model's stand-in while it downloads). */
function PlainBox({ building }: { building: Building }) {
  return (
    <mesh position={[building.x, building.height / 2, building.z]}>
      <boxGeometry args={[building.halfWidth * 2, building.height, building.halfDepth * 2]} />
      <meshLambertMaterial color={building.colour} />
    </mesh>
  );
}

/**
 * Every window of the plain buildings, in one draw call. Unlit material, so a
 * lit window glows at night whatever the lights are doing. The colours only
 * change when night falls, the power goes or it comes back.
 */
export function Windows({ buildings, street }: { buildings: readonly Building[]; street: { current: StreetState } }) {
  const spots = useMemo<WindowSpot[]>(() => buildings.flatMap(windowsOf), [buildings]);
  const mesh = useRef<InstancedMesh>(null);
  const shown = useRef<string | null>(null);
  const sinceCheck = useRef(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const placer = new Object3D();
    spots.forEach((spot, index) => {
      placer.position.set(spot.x, spot.y, spot.z);
      placer.rotation.set(0, spot.rotationY, 0);
      placer.updateMatrix();
      instanced.setMatrixAt(index, placer.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    shown.current = null; // repaint the colours for the new windows
  }, [spots]);

  useFrame((_, frameSeconds) => {
    sinceCheck.current += frameSeconds;
    const instanced = mesh.current;
    if (!instanced || sinceCheck.current < WINDOW_CHECK_SECONDS) return;
    sinceCheck.current = 0;
    const { serverNow, isNight, blackoutEndsAt } = street.current;
    const power = streetPower(isNight, blackoutEndsAt, serverNow?.() ?? 0);
    if (power === shown.current) return;
    shown.current = power;
    const colour = new Color();
    spots.forEach((spot, index) => {
      const tone = power === "day" ? "glass" : isWindowLit(spot, power) ? "lit" : "dark";
      instanced.setColorAt(index, colour.set(WINDOW_COLOURS[tone]));
    });
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  });

  if (spots.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, spots.length]} key={spots.length}>
      <planeGeometry args={[WINDOW_WIDTH, WINDOW_HEIGHT]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
}
