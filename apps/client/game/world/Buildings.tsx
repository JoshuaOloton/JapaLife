"use client";

import type { Building, ModelInfo, Point } from "@japalife/shared";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  type BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSET_ROOT, withDecoders } from "../character/loaders";
import { ModelBoundary } from "../ModelBoundary";
import { WARM_UP_WHILE_HIDDEN } from "../ShaderWarmUp";
import { Boxes, type FadeSet, type Slab } from "./Boxes";
import { type FadeRule, type Point3, stepFades } from "./occlusion";
import type { StreetState } from "./street";
import {
  INSTANCE_FADE_ATTRIBUTE,
  INSTANCE_LIT_ATTRIBUTE,
  WINDOW_GLOW_COLOUR,
  addBuildingEffects,
  addDitherFade,
  flagWindowGlass,
} from "./windowGlass";
import {
  type StreetPower,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
  type WindowSpot,
  hash01,
  isWindowLit,
  modelWindowsLit,
  streetPower,
  windowsOf,
} from "./windows";

/**
 * Yaba's buildings. A building with a `model` draws that model, rotated and
 * scaled as its config says, with its window glass glowing at night
 * (`windowGlass.ts`); far off (past `MODEL_REACH`, in the haze) and while the
 * model downloads it is its plain box instead. A building without one is a
 * painted cement box with a zinc roof and windows that light up at night.
 *
 * Every building of one model is ONE instanced draw call, refilled with the
 * buildings near the player as they walk; each copy still fades and lights on
 * its own, through per-copy instance attributes.
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
/** How strongly a model's lit glass glows (times `WINDOW_GLOW_COLOUR`), on top of its painted colour. */
const MODEL_GLOW = { value: new Color(WINDOW_GLOW_COLOUR).multiplyScalar(0.9) };
/**
 * A building hiding the player loses 70% of its pixels, quickly but not in a
 * blink. Only buildings within 35 m can hide them (the camera is at most about
 * 25 m back).
 */
const FADE_RULE: FadeRule = { faded: 0.7, perSecond: 4, range: 35 };
/** The point of the player the camera must see; reused every frame. */
const CHEST: Point3 = { x: 0, y: 1.2, z: 0 };

/**
 * Keeps the given buildings' fades up to date every frame, for meshes that
 * draw them (the plain buildings' boxes and windows, through `FadeSet`).
 */
export function useOcclusionFade(buildings: readonly Building[], predicted: { current: Point }): FadeSet {
  const camera = useThree((three) => three.camera);
  const set = useMemo<FadeSet>(() => ({ amounts: new Float32Array(buildings.length), version: 0 }), [buildings]);
  useFrame((_, frameSeconds) => {
    CHEST.x = predicted.current.x;
    CHEST.z = predicted.current.z;
    if (stepFades(buildings, set.amounts, camera.position, CHEST, Math.min(frameSeconds, 0.25), FADE_RULE)) set.version++;
  });
  return set;
}

/** The boxes for plain buildings: walls and roofs, drawn by the world's single `Boxes` call. */
export function plainBuildingSlabs(buildings: readonly Building[]): Slab[] {
  return buildings.flatMap((building) => [
    { ...building, height: building.height - ROOF_THICKNESS },
    {
      x: building.x,
      z: building.z,
      halfWidth: building.halfWidth + ROOF_OVERHANG,
      halfDepth: building.halfDepth + ROOF_OVERHANG,
      height: ROOF_THICKNESS,
      y: building.height - ROOF_THICKNESS,
      // From the id, not the list position, so a roof keeps its colour as the drawn area changes.
      colour: ZINC_COLOURS[Math.floor(hash01(building.id) * ZINC_COLOURS.length)] ?? ZINC_COLOURS[0],
    },
  ]);
}

const NOTHING: readonly Building[] = [];

/**
 * Buildings that have a model: every model kind gets one instanced mesh, holding the
 * `near` buildings of that kind. Each shows plain boxes while its model downloads.
 */
export function ModelBuildings({
  kinds,
  near,
  models,
  street,
  predicted,
}: {
  /**
   * Every building model in the whole district, with how many buildings use it
   * (from the district header): each kind's mesh exists, downloads and warms up
   * from the start, sized once, before any chunk with that kind arrives.
   */
  kinds: Readonly<Record<string, number>>;
  /** The ones to draw as models now. */
  near: readonly Building[];
  models: Readonly<Record<string, ModelInfo>>;
  street: { current: StreetState };
  /** Where the player is, so a building hiding them from the camera can turn see-through. */
  predicted: { current: Point };
}) {
  const nearByKind = useMemo(() => groupByModel(near), [near]);
  return (
    <>
      {Object.entries(kinds).map(([id, count]) => {
        const model = models[id];
        if (!model) return null;
        const shown = nearByKind.get(id) ?? NOTHING;
        const standIn = <StandIn buildings={shown} capacity={count} />;
        return (
          <ModelBoundary key={id} fallback={standIn}>
            <Suspense fallback={standIn}>
              <BuildingKind model={model} capacity={count} buildings={shown} street={street} predicted={predicted} />
            </Suspense>
          </ModelBoundary>
        );
      })}
    </>
  );
}

function StandIn({ buildings, capacity }: { buildings: readonly Building[]; capacity: number }) {
  const slabs = useMemo(() => plainBuildingSlabs(buildings), [buildings]);
  return <Boxes slabs={slabs} capacity={capacity * 2} />;
}

function groupByModel(buildings: readonly Building[]): Map<string, Building[]> {
  const byModel = new Map<string, Building[]>();
  for (const building of buildings) {
    if (!building.model) continue;
    const list = byModel.get(building.model) ?? [];
    list.push(building);
    byModel.set(building.model, list);
  }
  return byModel;
}

function BuildingKind({
  model,
  capacity,
  buildings,
  street,
  predicted,
}: {
  model: ModelInfo;
  capacity: number;
  buildings: readonly Building[];
  street: { current: StreetState };
  predicted: { current: Point };
}) {
  const gl = useThree((three) => three.gl);
  const camera = useThree((three) => three.camera);
  const gltf = useLoader(GLTFLoader, `${ASSET_ROOT}/${model.file}`, withDecoders(gl));
  const kind = useMemo(() => instancedKind(gltf, model.windows, capacity), [gltf, model.windows, capacity]);
  useEffect(() => () => kind.dispose(), [kind]);

  const shownPower = useRef<StreetPower | null>(null);
  useLayoutEffect(() => {
    kind.place(buildings);
    shownPower.current = null; // light the newly placed copies on the next check
  }, [kind, buildings]);

  // Dither out a building while it stands between the camera and the player (occlusion fading).
  useFrame((_, frameSeconds) => {
    CHEST.x = predicted.current.x;
    CHEST.z = predicted.current.z;
    const amounts = kind.fade.array as Float32Array;
    if (stepFades(buildings, amounts, camera.position, CHEST, Math.min(frameSeconds, 0.25), FADE_RULE)) kind.fade.needsUpdate = true;
  });

  // Check about once a second whether night fell or the power went; only then touch the glow.
  const sinceCheck = useRef(Number.POSITIVE_INFINITY);
  useFrame((_, frameSeconds) => {
    sinceCheck.current += frameSeconds;
    if (!model.windows || sinceCheck.current < WINDOW_CHECK_SECONDS) return;
    sinceCheck.current = 0;
    const { serverNow, isNight, blackoutEndsAt } = street.current;
    const power = streetPower(isNight, blackoutEndsAt, serverNow?.() ?? 0);
    if (power === shownPower.current) return;
    shownPower.current = power;
    const count = Math.min(buildings.length, capacity);
    for (let index = 0; index < count; index++) {
      kind.lit.setX(index, modelWindowsLit((buildings[index] as Building).id, power) ? 1 : 0);
    }
    kind.lit.needsUpdate = true;
  });

  return <primitive object={kind.group} />;
}

interface InstancedKind {
  group: Group;
  /** Per copy: faded out 0-1. */
  fade: InstancedBufferAttribute;
  /** Per copy: windows lit, 0 or 1. */
  lit: InstancedBufferAttribute;
  /** Puts the copies at these buildings (as many as fit). */
  place(buildings: readonly Building[]): void;
  dispose(): void;
}

/**
 * A model as instanced meshes (one per mesh in the model), with Lambert
 * materials in place of the glTF's physically based ones (far cheaper on a
 * weak GPU, and our lighting has no reflections for them to show), the
 * building effects added, and room for `capacity` copies.
 */
function instancedKind(gltf: GLTF, windows: ModelInfo["windows"], capacity: number): InstancedKind {
  const group = new Group();
  const fade = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const lit = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const owned: (Material | BufferGeometry)[] = [];
  const materials = new Map<Material, MeshLambertMaterial>();
  const meshes: { mesh: InstancedMesh; local: Matrix4 }[] = [];

  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const original = object.material as MeshStandardMaterial;
    let material = materials.get(original);
    if (!material) {
      material = new MeshLambertMaterial({ map: original.map, color: original.color });
      addBuildingEffects(material, MODEL_GLOW);
      materials.set(original, material);
      owned.push(material);
    }
    // Our own copy of the geometry, to carry the glass flags and the per-copy attributes.
    const geometry = (object.geometry as BufferGeometry).clone();
    // Without flagged glass the glow reads 0 everywhere, so a model without windows never glows.
    if (windows) flagWindowGlass(geometry, windows);
    geometry.setAttribute(INSTANCE_FADE_ATTRIBUTE, fade);
    geometry.setAttribute(INSTANCE_LIT_ATTRIBUTE, lit);
    owned.push(geometry);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.visible = false;
    // Warmed up at load even if none is near yet, so walking up to the first one never compiles a shader.
    mesh.userData[WARM_UP_WHILE_HIDDEN] = true;
    meshes.push({ mesh, local: object.matrixWorld.clone() });
    group.add(mesh);
  });

  const placement = new Matrix4();
  const turn = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const position = new Vector3();
  const size = new Vector3();
  return {
    group,
    fade,
    lit,
    place(buildings) {
      const shown = Math.min(buildings.length, capacity);
      for (const { mesh, local } of meshes) {
        for (let index = 0; index < shown; index++) {
          const building = buildings[index] as Building;
          turn.setFromAxisAngle(up, (building.rotation * Math.PI) / 180);
          placement.compose(position.set(building.x, 0, building.z), turn, size.setScalar(building.scale));
          mesh.setMatrixAt(index, placement.multiply(local));
        }
        mesh.count = shown;
        mesh.visible = shown > 0;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
      (fade.array as Float32Array).fill(0);
      fade.needsUpdate = true;
    },
    dispose() {
      for (const thing of owned) thing.dispose();
    },
  };
}

/**
 * The windows of the plain buildings given, in one draw call. Unlit material,
 * so a lit window glows at night whatever the lights are doing. The colours
 * change only when night falls, the power goes or comes back, or the drawn
 * area moves. `capacity` is the most windows it will ever hold.
 */
export function Windows({
  buildings,
  capacity,
  street,
  fades,
}: {
  buildings: readonly Building[];
  capacity: number;
  street: { current: StreetState };
  /** How far each of `buildings` is faded out: its windows fade with it. */
  fades: FadeSet;
}) {
  // Each window, and the index of its building in `buildings` (for its fade).
  const { spots, owners } = useMemo(() => {
    const all = buildings.flatMap((building, owner) => windowsOf(building).map((spot) => ({ spot, owner }))).slice(0, capacity);
    return { spots: all.map(({ spot }): WindowSpot => spot), owners: Int32Array.from(all, ({ owner }) => owner) };
  }, [buildings, capacity]);
  const mesh = useMemo(() => {
    const geometry = new PlaneGeometry(WINDOW_WIDTH, WINDOW_HEIGHT);
    const fade = new InstancedBufferAttribute(new Float32Array(Math.max(1, capacity)), 1).setUsage(DynamicDrawUsage);
    geometry.setAttribute(INSTANCE_FADE_ATTRIBUTE, fade);
    const material = new MeshBasicMaterial();
    addDitherFade(material, "windows-dither");
    const instanced = new InstancedMesh(geometry, material, Math.max(1, capacity));
    instanced.count = 0;
    instanced.visible = false;
    instanced.userData[WARM_UP_WHILE_HIDDEN] = true;
    return instanced;
  }, [capacity]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    },
    [mesh],
  );
  const shown = useRef<string | null>(null);
  const sinceCheck = useRef(Number.POSITIVE_INFINITY);
  const seenFade = useRef(-1);

  useLayoutEffect(() => {
    const instanced = mesh;
    const placer = new Object3D();
    spots.forEach((spot, index) => {
      placer.position.set(spot.x, spot.y, spot.z);
      placer.rotation.set(0, spot.rotationY, 0);
      placer.updateMatrix();
      instanced.setMatrixAt(index, placer.matrix);
    });
    instanced.count = spots.length;
    instanced.visible = spots.length > 0;
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    shown.current = null; // repaint the colours for the new windows
    sinceCheck.current = Number.POSITIVE_INFINITY;
    seenFade.current = -1; // and copy the fades again
  }, [mesh, spots]);

  // A fading building's windows fade with it; copied only when a fade changed.
  useFrame(() => {
    if (fades.version === seenFade.current) return;
    seenFade.current = fades.version;
    const attribute = mesh.geometry.getAttribute(INSTANCE_FADE_ATTRIBUTE) as InstancedBufferAttribute;
    const values = attribute.array as Float32Array;
    const count = Math.min(owners.length, values.length);
    for (let index = 0; index < count; index++) values[index] = fades.amounts[owners[index] as number] ?? 0;
    attribute.needsUpdate = true;
  });

  useFrame((_, frameSeconds) => {
    sinceCheck.current += frameSeconds;
    const instanced = mesh;
    if (sinceCheck.current < WINDOW_CHECK_SECONDS) return;
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

  if (capacity === 0) return null;
  return <primitive object={mesh} />;
}

/** How many windows the given plain buildings have, to size the windows mesh once. */
export function windowCount(buildings: readonly Building[]): number {
  return buildings.reduce((sum, building) => sum + windowsOf(building).length, 0);
}
