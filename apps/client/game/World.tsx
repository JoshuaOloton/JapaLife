"use client";

import {
  type Building,
  type DistrictHeader,
  type DistrictLayout,
  type Interactable,
  type Point,
  type Road,
  seededRandom,
} from "@japalife/shared";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, type InstancedMesh, Object3D } from "three";
import { headerLayout } from "./connection";
import type { DiagnosticLayer } from "./diagnostics";
import { PLACE_COLOURS } from "./placeColours";
import type { RouteStore } from "./routeStore";
import { ChunkIndex, DRAW_REACH, areaBox, areaCell, splitByDetail, useCapacity } from "./world/area";
import { Boxes, type Slab } from "./world/Boxes";
import { ModelBuildings, Windows, plainBuildingSlabs, windowCount } from "./world/Buildings";
import { layOutGutters } from "./world/gutters";
import { Npcs } from "./world/Npcs";
import { Pedestrians } from "./world/Pedestrians";
import type { QualityGovernor } from "./world/quality";
import { Traffic } from "./world/Traffic";
import { GROUND_TILE_METRES, paintGround, paintRoad, paintSign } from "./world/paint";
import { Props } from "./world/Props";
import { propSlabs } from "./world/propShapes";
import { roadHeight, roadSurface } from "./world/roads";
import { RouteRibbon } from "./world/RouteRibbon";
import type { StreetState } from "./world/street";

/**
 * Draws the district from the layout the server sent: sandy ground, tarred
 * roads with potholes and open gutters, the buildings, and a sign over each
 * place the player can use.
 *
 * Draw calls are what weak phones choke on, so every plain box (walls, roofs,
 * gutters, the district edge) goes into ONE instanced draw call, every window
 * into another, every road into one mesh. And only the part of the district
 * around the player is drawn (`world/area.ts`): the instanced meshes are
 * refilled from the chunks nearby each time the player crosses into another
 * area cell.
 */

const EDGE_WALL_COLOUR = "#9b9488";
const EDGE_WALL_HEIGHT = 1.2;
const EDGE_WALL_THICKNESS = 0.6;
/** A pothole lies this far above its own road, so it never flickers into it. */
const POTHOLE_ABOVE_ROAD = 0.012;
const POTHOLES_PER_100_METRES = 6;
const SIGN_HEIGHT = 3.4;

const GUTTER_LIP = { colour: "#a7a196", thickness: 0.14, height: 0.2 };
const GUTTER_CHANNEL = { colour: "#2a3229", height: 0.03 };
const GUTTER_SLAB = { colour: "#b5afa4", height: 0.22 };

const SIGN_COLOURS = PLACE_COLOURS;

export function World({
  district,
  header,
  hide = NOTHING_HIDDEN,
  routes,
  street,
  predicted,
  quality,
}: {
  /** The route picked on the map, drawn on the street (only the strip re-renders when it changes). */
  routes?: RouteStore;
  /** Layers left out to find what costs frame time (`diagnostics.ts`, developer-only). */
  hide?: ReadonlySet<DiagnosticLayer>;
  /** The district as far as the loaded chunks go. */
  district: DistrictLayout;
  /** What came on join: what the whole district uses, for things that must not restart as chunks change. */
  header: DistrictHeader;
  street: { current: StreetState };
  /** Where the player is, so far-away NPCs can stop animating and traffic can stop for them. */
  predicted: { current: Point };
  /** Halves the traffic and people when the phone struggles. */
  quality: QualityGovernor;
}) {
  const groundWidth = district.halfWidth * 2 + 60;
  const groundDepth = district.halfDepth * 2 + 60;
  const ground = useMemo(() => {
    const tile = paintGround();
    tile.repeat.set(groundWidth / GROUND_TILE_METRES, groundDepth / GROUND_TILE_METRES);
    return tile;
  }, [groundWidth, groundDepth]);
  useLayoutEffect(() => () => ground.dispose(), [ground]);

  // The loaded chunks' things, bucketed; the drawn part is refilled from them as the player walks.
  const index = useMemo(() => worldIndex(district, hide.has("props")), [district, hide]);
  const slabCapacity = useCapacity(index.slabCount);
  const windowCapacity = useCapacity(index.windowCount);
  // The traffic and walkers run on the header alone, so they never restart as chunks come and go.
  const wholeDistrict = useMemo(() => headerLayout(header), [header]);
  const [centre, setCentre] = useState(() => areaCell(district.spawn));
  const near = useMemo(() => {
    const drawArea = areaBox(centre, DRAW_REACH);
    const noBuildings = hide.has("buildings");
    const plain = noBuildings ? [] : index.plainBuildings.within(drawArea);
    const { models, boxes } = noBuildings ? { models: [], boxes: [] } : splitByDetail(index.modelBuildings, centre);
    return {
      plain,
      models,
      slabs: [...index.slabs.within(drawArea), ...plainBuildingSlabs(plain), ...plainBuildingSlabs(boxes)],
    };
  }, [index, centre, hide]);

  return (
    <group>
      <AreaWatcher predicted={predicted} onMove={setCentre} />
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[groundWidth, groundDepth]} />
        <meshLambertMaterial map={ground} />
      </mesh>
      <Roads roads={district.roads} />
      <Potholes roads={district.roads} />
      {routes && <RouteRibbon routes={routes} />}
      <Boxes slabs={near.slabs} capacity={slabCapacity} />
      <Windows buildings={near.plain} capacity={windowCapacity} street={street} />
      <ModelBuildings
        kinds={header.buildingModels}
        near={near.models}
        models={district.models}
        street={street}
        predicted={predicted}
      />
      {!hide.has("props") && <Props layout={district} centre={centre} />}
      {!hide.has("npcs") && <Npcs layout={district} predicted={predicted} />}
      {!hide.has("traffic") && <Traffic layout={wholeDistrict} predicted={predicted} street={street} quality={quality} />}
      {!hide.has("people") && (
        <Pedestrians layout={wholeDistrict} predicted={predicted} street={street} quality={quality} />
      )}
      {district.interactables.map((place) => (
        <Sign key={place.id} place={place} radius={district.interactRadius} />
      ))}
    </group>
  );
}

const NOTHING_HIDDEN: ReadonlySet<DiagnosticLayer> = new Set();

/** Tells the world when the player crosses into another area cell, so it refills what is drawn (a few times a minute, not every frame). */
function AreaWatcher({ predicted, onMove }: { predicted: { current: Point }; onMove: (centre: Point) => void }) {
  const shown = useRef<Point | null>(null);
  useFrame(() => {
    const cell = areaCell(predicted.current);
    if (shown.current && shown.current.x === cell.x && shown.current.z === cell.z) return;
    shown.current = cell;
    onMove(cell);
  });
  return null;
}

/** The loaded district's things bucketed into chunks, and how many there are (to size the instanced meshes). */
function worldIndex(district: DistrictLayout, withoutProps = false) {
  const t = EDGE_WALL_THICKNESS / 2;
  const { halfWidth: w, halfDepth: d } = district;
  const wall = (x: number, z: number, halfWidth: number, halfDepth: number): Slab => ({
    x, z, halfWidth, halfDepth, height: EDGE_WALL_HEIGHT, colour: EDGE_WALL_COLOUR,
  });
  const slabs = [
    // A low wall just outside the walkable area, so the edge the server enforces is visible.
    wall(0, -d - t, w + 2 * t, t),
    wall(0, d + t, w + 2 * t, t),
    wall(-w - t, 0, t, d),
    wall(w + t, 0, t, d),
    ...gutterSlabs(district.roads, district),
    ...(withoutProps ? [] : propSlabs(district)),
  ];
  const hasModel = (building: Building): boolean => Boolean(building.model && district.models[building.model]);
  const plain = district.buildings.filter((building) => !hasModel(building));
  const models = district.buildings.filter(hasModel);
  return {
    slabs: new ChunkIndex(slabs),
    plainBuildings: new ChunkIndex(plain),
    modelBuildings: new ChunkIndex(models),
    // Every plain building, plus every model building drawn as its box when far off: walls and roof each.
    slabCount: slabs.length + 2 * district.buildings.length,
    windowCount: windowCount(plain),
  };
}

/** Every road in one draw call (`roads.ts`). */
function Roads({ roads }: { roads: readonly Road[] }) {
  const geometry = useMemo(() => {
    const { positions, uvs, indices } = roadSurface(roads);
    const surface = new BufferGeometry();
    surface.setAttribute("position", new BufferAttribute(positions, 3));
    surface.setAttribute("uv", new BufferAttribute(uvs, 2));
    surface.setIndex(new BufferAttribute(indices, 1));
    surface.computeVertexNormals();
    return surface;
  }, [roads]);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  const texture = useMemo(paintRoad, []);
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial map={texture} />
    </mesh>
  );
}

/** Dark, roughly oval potholes scattered along the roads, in one draw call. */
function Potholes({ roads }: { roads: readonly Road[] }) {
  const holes = useMemo(() => {
    const random = seededRandom(0x9071);
    return roads.flatMap((road, roadIndex) => {
      const alongX = road.halfWidth >= road.halfDepth;
      const length = (alongX ? road.halfWidth : road.halfDepth) * 2;
      const across = (alongX ? road.halfDepth : road.halfWidth) * 2;
      const count = Math.round((length / 100) * POTHOLES_PER_100_METRES);
      return Array.from({ length: count }, () => {
        const u = (random() - 0.5) * length;
        const v = (random() - 0.5) * (across - 2);
        return {
          x: road.x + (alongX ? u : v),
          z: road.z + (alongX ? v : u),
          y: roadHeight(roadIndex) + POTHOLE_ABOVE_ROAD,
          sizeX: 0.35 + random() * 0.55,
          sizeZ: 0.3 + random() * 0.4,
          turn: random() * Math.PI,
        };
      });
    });
  }, [roads]);
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const placer = new Object3D();
    holes.forEach((hole, index) => {
      placer.position.set(hole.x, hole.y, hole.z);
      placer.rotation.set(-Math.PI / 2, 0, hole.turn);
      placer.scale.set(hole.sizeX, hole.sizeZ, 1);
      placer.updateMatrix();
      instanced.setMatrixAt(index, placer.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
  }, [holes]);

  if (holes.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, holes.length]} key={holes.length}>
      <circleGeometry args={[1, 10]} />
      {/* Half see-through, so the road's grain shows through and the hole looks worn, not painted on. */}
      <meshLambertMaterial color="#1f1d1c" transparent opacity={0.55} depthWrite={false} />
    </instancedMesh>
  );
}

/** Each gutter is a dark channel between two concrete lips; slabs cover the ends at junctions. */
function gutterSlabs(roads: readonly Road[], bounds: { halfWidth: number; halfDepth: number }): Slab[] {
  const { gutters, slabs } = layOutGutters(roads, bounds);
  const lipOffset = (half: number): number => half - GUTTER_LIP.thickness / 2;
  return [
    ...gutters.flatMap((gutter): Slab[] => {
      const channel = { ...gutter, height: GUTTER_CHANNEL.height, colour: GUTTER_CHANNEL.colour };
      const lip = (side: number): Slab =>
        gutter.along === "x"
          ? { x: gutter.x, z: gutter.z + side * lipOffset(gutter.halfDepth), halfWidth: gutter.halfWidth, halfDepth: GUTTER_LIP.thickness / 2, height: GUTTER_LIP.height, colour: GUTTER_LIP.colour }
          : { x: gutter.x + side * lipOffset(gutter.halfWidth), z: gutter.z, halfWidth: GUTTER_LIP.thickness / 2, halfDepth: gutter.halfDepth, height: GUTTER_LIP.height, colour: GUTTER_LIP.colour };
      return [channel, lip(-1), lip(1)];
    }),
    ...slabs.map((slab) => ({ ...slab, height: GUTTER_SLAB.height, colour: GUTTER_SLAB.colour })),
  ];
}

/**
 * A floating board with the place's name, over a ring on the ground showing
 * where to stand. The text is painted onto a small canvas once, so no font
 * file is downloaded and the board costs one tiny texture.
 */
function Sign({ place, radius }: { place: Interactable; radius: number }) {
  const texture = useMemo(
    () => paintSign(place.label, { background: SIGN_COLOURS[place.kind] }),
    [place.label, place.kind],
  );
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  const { x, z } = place.position;

  return (
    <group position={[x, 0, z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
        <ringGeometry args={[radius - 0.25, radius, 32]} />
        <meshBasicMaterial color={SIGN_COLOURS[place.kind]} transparent opacity={0.6} />
      </mesh>
      {/* The camera always looks north, so a board facing south (+z) is always readable. */}
      <mesh position-y={SIGN_HEIGHT}>
        <planeGeometry args={[4, 1]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
      <mesh position-y={SIGN_HEIGHT / 2}>
        <cylinderGeometry args={[0.06, 0.06, SIGN_HEIGHT - 0.5, 6]} />
        <meshLambertMaterial color="#555555" />
      </mesh>
    </group>
  );
}
