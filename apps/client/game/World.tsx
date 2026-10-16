"use client";

import type { DistrictConfig, Interactable } from "@japalife/shared";
import { useLayoutEffect, useMemo, useRef } from "react";
import { CanvasTexture, Color, type InstancedMesh, Object3D, SRGBColorSpace } from "three";

/**
 * Draws the district from the layout the server sent: ground, roads, buildings,
 * and a sign over each place the player can use. All placeholder geometry.
 *
 * Every building is the same unit box, stretched and coloured per copy, drawn
 * with one InstancedMesh: the GPU gets ONE draw call for all of them instead of
 * one per building, which is what keeps weak phone GPUs at a steady frame rate.
 */

interface Slab {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  height: number;
  colour: string;
}

const GROUND_COLOUR = "#6f8f4f";
const EDGE_WALL_COLOUR = "#9b9488";
const EDGE_WALL_HEIGHT = 1.2;
const EDGE_WALL_THICKNESS = 0.6;
/** Roads sit a hair above the ground so the two never flicker (z-fighting). */
const ROAD_HEIGHT = 0.02;
const SIGN_HEIGHT = 3.4;

const SIGN_COLOURS: Record<Interactable["kind"], string> = {
  home: "#7a4b2a",
  job_site: "#2f5d8a",
  food_vendor: "#b5432f",
  bus_stop: "#2f7a55",
  fuel_station: "#8a2f6a",
};

export function World({ district }: { district: DistrictConfig }) {
  const groundWidth = district.halfWidth * 2 + 60;
  const groundDepth = district.halfDepth * 2 + 60;

  // A low wall just outside the walkable area, so the edge the server enforces is visible.
  const slabs = useMemo<Slab[]>(() => {
    const t = EDGE_WALL_THICKNESS / 2;
    const { halfWidth: w, halfDepth: d } = district;
    const wall = (x: number, z: number, halfWidth: number, halfDepth: number): Slab => ({
      x, z, halfWidth, halfDepth, height: EDGE_WALL_HEIGHT, colour: EDGE_WALL_COLOUR,
    });
    return [
      ...district.buildings,
      wall(0, -d - t, w + 2 * t, t),
      wall(0, d + t, w + 2 * t, t),
      wall(-w - t, 0, t, d),
      wall(w + t, 0, t, d),
    ];
  }, [district]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[groundWidth, groundDepth]} />
        <meshLambertMaterial color={GROUND_COLOUR} />
      </mesh>
      <Boxes slabs={district.roads.map((road) => ({ ...road, height: ROAD_HEIGHT }))} />
      <Boxes slabs={slabs} />
      {district.interactables.map((place) => (
        <Sign key={place.id} place={place} radius={district.interactRadius} />
      ))}
    </group>
  );
}

/** Any number of coloured boxes standing on the ground, in a single draw call. */
function Boxes({ slabs }: { slabs: readonly Slab[] }) {
  const mesh = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const instanced = mesh.current;
    if (!instanced) return;
    const placer = new Object3D();
    const colour = new Color();
    slabs.forEach((slab, index) => {
      placer.position.set(slab.x, slab.height / 2, slab.z);
      placer.scale.set(slab.halfWidth * 2, slab.height, slab.halfDepth * 2);
      placer.updateMatrix();
      instanced.setMatrixAt(index, placer.matrix);
      instanced.setColorAt(index, colour.set(slab.colour));
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    // Bounds are computed from the instances, so the whole group is not culled by mistake.
    instanced.computeBoundingSphere();
  }, [slabs]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, slabs.length]} key={slabs.length}>
      <boxGeometry />
      <meshLambertMaterial />
    </instancedMesh>
  );
}

/**
 * A floating board with the place's name, over a ring on the ground showing
 * where to stand. The text is painted onto a small canvas once, so no font
 * file is downloaded and the board costs one tiny texture.
 */
function Sign({ place, radius }: { place: Interactable; radius: number }) {
  const texture = useMemo(() => paintSign(place.label, SIGN_COLOURS[place.kind]), [place.label, place.kind]);
  useLayoutEffect(() => () => texture.dispose(), [texture]);
  const { x, z } = place.position;

  return (
    <group position={[x, 0, z]}>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
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

function paintSign(label: string, background: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#ffffff";
    context.lineWidth = 4;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    // Shrink long names until they fit the board.
    let size = 34;
    do {
      context.font = `bold ${size}px system-ui, sans-serif`;
      size -= 2;
    } while (context.measureText(label).width > canvas.width - 20 && size > 12);
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
