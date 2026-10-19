"use client";

import type { DistrictLayout, Interactable, Point, Road } from "@japalife/shared";
import { useLayoutEffect, useMemo, useRef } from "react";
import { type InstancedMesh, Object3D } from "three";
import { Boxes, type Slab } from "./world/Boxes";
import { ModelBuildings, Windows, plainBuildingSlabs } from "./world/Buildings";
import { layOutGutters } from "./world/gutters";
import { Npcs } from "./world/Npcs";
import { paintGround, paintRoad, paintSign, seededRandom } from "./world/paint";
import { Props } from "./world/Props";
import { propSlabs } from "./world/propShapes";
import type { StreetState } from "./world/street";

/**
 * Draws the district from the layout the server sent: laterite ground, tarred
 * roads with potholes and open gutters, the buildings, and a sign over each
 * place the player can use.
 *
 * Draw calls are what weak phones choke on, so every plain box (walls, roofs,
 * gutters, the district edge) goes into ONE instanced draw call, and every
 * window into another.
 */

const EDGE_WALL_COLOUR = "#9b9488";
const EDGE_WALL_HEIGHT = 1.2;
const EDGE_WALL_THICKNESS = 0.6;
/** Roads sit a hair above the ground so the two never flicker (z-fighting); each road a hair above the last. */
const ROAD_HEIGHT = 0.02;
const ROAD_STACK = 0.004;
const POTHOLE_HEIGHT = 0.04;
const POTHOLES_PER_100_METRES = 6;
const SIGN_HEIGHT = 3.4;

const GUTTER_LIP = { colour: "#a7a196", thickness: 0.14, height: 0.2 };
const GUTTER_CHANNEL = { colour: "#2a3229", height: 0.03 };
const GUTTER_SLAB = { colour: "#b5afa4", height: 0.22 };

const SIGN_COLOURS: Record<Interactable["kind"], string> = {
  home: "#7a4b2a",
  job_site: "#2f5d8a",
  food_vendor: "#b5432f",
  bus_stop: "#2f7a55",
  fuel_station: "#8a2f6a",
};

export function World({
  district,
  street,
  predicted,
}: {
  district: DistrictLayout;
  street: { current: StreetState };
  /** Where the player is, so far-away NPCs can stop animating. */
  predicted: { current: Point };
}) {
  const groundWidth = district.halfWidth * 2 + 60;
  const groundDepth = district.halfDepth * 2 + 60;
  const ground = useMemo(() => paintGround(), []);
  useLayoutEffect(() => () => ground.dispose(), [ground]);

  const plainBuildings = useMemo(
    () => district.buildings.filter((building) => !building.model || !district.models[building.model]),
    [district],
  );

  const slabs = useMemo<Slab[]>(() => {
    const t = EDGE_WALL_THICKNESS / 2;
    const { halfWidth: w, halfDepth: d } = district;
    const wall = (x: number, z: number, halfWidth: number, halfDepth: number): Slab => ({
      x, z, halfWidth, halfDepth, height: EDGE_WALL_HEIGHT, colour: EDGE_WALL_COLOUR,
    });
    return [
      // A low wall just outside the walkable area, so the edge the server enforces is visible.
      wall(0, -d - t, w + 2 * t, t),
      wall(0, d + t, w + 2 * t, t),
      wall(-w - t, 0, t, d),
      wall(w + t, 0, t, d),
      ...plainBuildingSlabs(plainBuildings),
      ...gutterSlabs(district.roads, district),
      ...propSlabs(district),
    ];
  }, [district, plainBuildings]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[groundWidth, groundDepth]} />
        <meshLambertMaterial map={ground} />
      </mesh>
      {district.roads.map((road, index) => (
        <RoadStrip key={index} road={road} height={ROAD_HEIGHT + index * ROAD_STACK} />
      ))}
      <Potholes roads={district.roads} />
      <Boxes slabs={slabs} />
      <Windows buildings={plainBuildings} street={street} />
      <ModelBuildings buildings={district.buildings} models={district.models} />
      <Props layout={district} />
      <Npcs npcs={district.npcs} predicted={predicted} />
      {district.interactables.map((place) => (
        <Sign key={place.id} place={place} radius={district.interactRadius} />
      ))}
    </group>
  );
}

/**
 * A tarred road. The painted strip runs across the road's width and repeats
 * along its length, so a road along x is the same strip turned a quarter.
 */
function RoadStrip({ road, height }: { road: Road; height: number }) {
  const alongX = road.halfWidth >= road.halfDepth;
  const across = (alongX ? road.halfDepth : road.halfWidth) * 2;
  const length = (alongX ? road.halfWidth : road.halfDepth) * 2;
  const texture = useMemo(() => {
    const painted = paintRoad();
    painted.repeat.set(1, length / across);
    return painted;
  }, [across, length]);
  useLayoutEffect(() => () => texture.dispose(), [texture]);

  return (
    <group position={[road.x, height, road.z]} rotation-y={alongX ? Math.PI / 2 : 0}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[across, length]} />
        <meshLambertMaterial map={texture} />
      </mesh>
    </group>
  );
}

/** Dark, roughly oval potholes scattered along the roads, in one draw call. */
function Potholes({ roads }: { roads: readonly Road[] }) {
  const holes = useMemo(() => {
    const random = seededRandom(0x9071);
    return roads.flatMap((road) => {
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
      placer.position.set(hole.x, POTHOLE_HEIGHT, hole.z);
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
