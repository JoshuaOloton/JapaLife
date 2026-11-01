"use client";

import { type Box, seededRandom, waterPieces } from "@japalife/shared";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { WATER_Y } from "./waterShapes";

/** Metres of water one repeat of the ripple texture covers. */
const RIPPLE_METRES = 6;
/** How fast the ripples drift, in texture repeats a second (slow: a canal, not a river). */
const DRIFT = { x: 0.012, z: 0.02 } as const;
const TEXTURE_PIXELS = 128;

/**
 * Every canal and pond as one flat mesh with a slowly drifting ripple
 * texture: one draw call, mounted from the start (so its shader compiles at
 * load), and the drift only moves the texture's offset, a uniform, never the
 * shader.
 */
export function Water({ water, roads }: { water: readonly Box[]; roads: readonly Box[] }) {
  const geometry = useMemo(() => waterGeometry(waterPieces(water, roads)), [water, roads]);
  useLayoutEffect(() => () => geometry.dispose(), [geometry]);
  const texture = useMemo(paintRipples, []);
  useLayoutEffect(() => () => texture.dispose(), [texture]);

  useFrame((_, frameSeconds) => {
    const seconds = Math.min(frameSeconds, 0.25);
    texture.offset.x = (texture.offset.x + DRIFT.x * seconds) % 1;
    texture.offset.y = (texture.offset.y + DRIFT.z * seconds) % 1;
  });

  if (water.length === 0) return null;
  return (
    <mesh geometry={geometry}>
      <meshLambertMaterial map={texture} />
    </mesh>
  );
}

/** One upward-facing quad per piece, with texture coordinates in world metres so the ripples line up across pieces. */
export function waterGeometry(pieces: readonly Box[]): BufferGeometry {
  const positions = new Float32Array(pieces.length * 4 * 3);
  const uvs = new Float32Array(pieces.length * 4 * 2);
  const indices = new Uint32Array(pieces.length * 6);
  pieces.forEach((piece, index) => {
    const corners = [
      [piece.x - piece.halfWidth, piece.z - piece.halfDepth],
      [piece.x + piece.halfWidth, piece.z - piece.halfDepth],
      [piece.x + piece.halfWidth, piece.z + piece.halfDepth],
      [piece.x - piece.halfWidth, piece.z + piece.halfDepth],
    ] as const;
    corners.forEach(([x, z], corner) => {
      positions.set([x, WATER_Y, z], (index * 4 + corner) * 3);
      uvs.set([x / RIPPLE_METRES, -z / RIPPLE_METRES], (index * 4 + corner) * 2);
    });
    const first = index * 4;
    // Counter-clockwise seen from above, so the face points up.
    indices.set([first, first + 3, first + 2, first, first + 2, first + 1], index * 6);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** Clear blue water with light, wavy streaks, painted to wrap round seamlessly. */
function paintRipples(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_PIXELS;
  canvas.height = TEXTURE_PIXELS;
  const context = canvas.getContext("2d");
  if (context) {
    const size = TEXTURE_PIXELS;
    context.fillStyle = "#3b8fc7";
    context.fillRect(0, 0, size, size);
    const random = seededRandom(0x3a7e5);
    // Soft darker and lighter patches, so the surface is not one flat colour.
    for (let index = 0; index < 14; index++) {
      const x = random() * size;
      const y = random() * size;
      const radius = 10 + random() * 22;
      context.fillStyle = random() < 0.5 ? "rgba(30, 105, 160, 0.35)" : "rgba(110, 185, 225, 0.3)";
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          context.beginPath();
          context.ellipse(x + dx, y + dy, radius * 1.6, radius, 0, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
    // Ripple streaks: short light curves, each drawn again across the edges so the tile wraps.
    context.lineCap = "round";
    for (let index = 0; index < 26; index++) {
      const x = random() * size;
      const y = random() * size;
      const length = 8 + random() * 16;
      context.strokeStyle = `rgba(225, 245, 255, ${0.35 + random() * 0.35})`;
      context.lineWidth = 1 + random() * 1.5;
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          context.beginPath();
          context.moveTo(x + dx, y + dy);
          context.quadraticCurveTo(x + dx + length / 2, y + dy - 2.5, x + dx + length, y + dy);
          context.stroke();
        }
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
