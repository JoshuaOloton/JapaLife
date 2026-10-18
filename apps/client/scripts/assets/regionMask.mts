/**
 * Bakes a body's region mask: an image the size of its texture where every
 * pixel says which body region (torso, thigh...) that part of the skin belongs
 * to. The game paints clothes by colouring regions, so this is what turns a
 * bare body into one wearing a shirt and trousers.
 *
 * Each vertex takes the region of the bone that moves it most. Each triangle is
 * then drawn into the image at its texture (UV) coordinates, every pixel taking
 * the region of the triangle's nearest corner. Finally the regions are grown a
 * few pixels into the empty space around them, so texture filtering at UV seams
 * never reads "nothing".
 */
import type { Primitive, Skin } from "@gltf-transform/core";
import { REGION_MASK_STEP, regionForBone, regionIndex } from "@japalife/shared/bodyRegions";

const EMPTY = 255;
const GROW_PIXELS = 4;

export function bakeRegionMask(primitive: Primitive, skin: Skin, size: number): Uint8Array {
  const uv = primitive.getAttribute("TEXCOORD_0");
  const joints = primitive.getAttribute("JOINTS_0");
  const weights = primitive.getAttribute("WEIGHTS_0");
  const indices = primitive.getIndices();
  if (!uv || !joints || !weights || !indices) throw new Error("body primitive needs UVs, skin weights and indices");

  const jointNames = skin.listJoints().map((joint) => joint.getName());
  const vertexRegion = new Uint8Array(uv.getCount());
  const jointsOf = [0, 0, 0, 0];
  const weightsOf = [0, 0, 0, 0];
  for (let v = 0; v < vertexRegion.length; v++) {
    joints.getElement(v, jointsOf);
    weights.getElement(v, weightsOf);
    let strongest = 0;
    for (let k = 1; k < 4; k++) if ((weightsOf[k] ?? 0) > (weightsOf[strongest] ?? 0)) strongest = k;
    const bone = jointNames[jointsOf[strongest] ?? 0] ?? "";
    vertexRegion[v] = regionIndex(regionForBone(bone));
  }

  const mask = new Uint8Array(size * size).fill(EMPTY);
  const a = [0, 0];
  const b = [0, 0];
  const c = [0, 0];
  for (let i = 0; i < indices.getCount(); i += 3) {
    const ia = indices.getScalar(i);
    const ib = indices.getScalar(i + 1);
    const ic = indices.getScalar(i + 2);
    uv.getElement(ia, a);
    uv.getElement(ib, b);
    uv.getElement(ic, c);
    fillTriangle(mask, size, a, b, c, [vertexRegion[ia] ?? 0, vertexRegion[ib] ?? 0, vertexRegion[ic] ?? 0]);
  }

  grow(mask, size, GROW_PIXELS);
  for (let p = 0; p < mask.length; p++) {
    mask[p] = mask[p] === EMPTY ? 0 : (mask[p] ?? 0) * REGION_MASK_STEP;
  }
  return mask;
}

/** Fills the pixels whose centres lie inside the triangle, each with the region of the closest corner. */
function fillTriangle(
  mask: Uint8Array,
  size: number,
  a: number[],
  b: number[],
  c: number[],
  regions: [number, number, number],
): void {
  // glTF UVs have (0, 0) at the image's top-left, so v maps straight to the row.
  const ax = (a[0] ?? 0) * size, ay = (a[1] ?? 0) * size;
  const bx = (b[0] ?? 0) * size, by = (b[1] ?? 0) * size;
  const cx = (c[0] ?? 0) * size, cy = (c[1] ?? 0) * size;
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  if (area === 0) return;

  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Barycentric weights: how much each corner "owns" this point.
      const wa = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / area;
      const wb = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / area;
      const wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < 0) continue;
      const nearest = wa >= wb && wa >= wc ? 0 : wb >= wc ? 1 : 2;
      mask[y * size + x] = regions[nearest];
    }
  }
}

/** Spreads filled pixels into empty neighbours, one ring per pass. */
function grow(mask: Uint8Array, size: number, passes: number): void {
  for (let pass = 0; pass < passes; pass++) {
    const before = mask.slice();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (before[y * size + x] !== EMPTY) continue;
        const neighbour =
          (x > 0 ? before[y * size + x - 1] : EMPTY) !== EMPTY ? before[y * size + x - 1]
          : (x < size - 1 ? before[y * size + x + 1] : EMPTY) !== EMPTY ? before[y * size + x + 1]
          : (y > 0 ? before[(y - 1) * size + x] : EMPTY) !== EMPTY ? before[(y - 1) * size + x]
          : (y < size - 1 ? before[(y + 1) * size + x] : EMPTY) !== EMPTY ? before[(y + 1) * size + x]
          : EMPTY;
        mask[y * size + x] = neighbour ?? EMPTY;
      }
    }
  }
}
