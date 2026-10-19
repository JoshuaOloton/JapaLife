import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * Ground and road surfaces, painted on canvases when the scene loads, like the
 * signboards: nothing is downloaded. A fixed seed means every visit paints the
 * same Yaba.
 */

const LATERITE = "#94583f";
const LATERITE_MOTTLE = ["#7f4c37", "#a2654b", "#875440", "#9a6a55"];
const GRASS = ["#5f7336", "#6c7d3e", "#55682f"];
const ASPHALT = "#3f3f43";

/** Small, seeded random numbers (mulberry32), so the painting is the same every time. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Red laterite earth over the whole ground, with worn patches of grass. One
 * 512-pixel texture for the district (about 0.35 m a pixel at Yaba's size):
 * the grain comes from specks, the patches from soft blobs.
 */
export function paintGround(size = 512): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const random = seededRandom(0x1a905);
  if (context) {
    context.fillStyle = LATERITE;
    context.fillRect(0, 0, size, size);

    for (let index = 0; index < 22; index++) {
      const x = random() * size;
      const y = random() * size;
      const radius = 8 + random() * 30;
      const colour = GRASS[Math.floor(random() * GRASS.length)] ?? GRASS[0]!;
      for (let tuft = 0; tuft < 14; tuft++) {
        const tx = x + (random() - 0.5) * radius * 1.6;
        const ty = y + (random() - 0.5) * radius * 1.6;
        const r = radius * (0.25 + random() * 0.45);
        const blob = context.createRadialGradient(tx, ty, 0, tx, ty, r);
        blob.addColorStop(0, `${colour}cc`);
        blob.addColorStop(1, `${colour}00`);
        context.fillStyle = blob;
        context.fillRect(tx - r, ty - r, r * 2, r * 2);
      }
    }

    // Soft, faint mottling: a pixel here is about a third of a metre, so sharp
    // specks would blow up into polka dots right under the player's feet.
    for (let index = 0; index < 900; index++) {
      const x = random() * size;
      const y = random() * size;
      const r = 2 + random() * 7;
      const colour = LATERITE_MOTTLE[Math.floor(random() * LATERITE_MOTTLE.length)] ?? LATERITE;
      const blob = context.createRadialGradient(x, y, 0, x, y, r);
      blob.addColorStop(0, `${colour}55`);
      blob.addColorStop(1, `${colour}00`);
      context.fillStyle = blob;
      context.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  return toTexture(canvas, false);
}

/**
 * A strip of tarred road, across its width from edge to edge: worn, broken
 * edges where the tar crumbles into the laterite, faded patches and cracks.
 * It repeats along the road's length.
 */
export function paintRoad(): CanvasTexture {
  const width = 128;
  const height = 128;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const random = seededRandom(0x7a2);
  if (context) {
    context.fillStyle = ASPHALT;
    context.fillRect(0, 0, width, height);

    // Grain and lighter, sun-faded patches.
    for (let index = 0; index < width * height * 0.25; index++) {
      const shade = 52 + Math.floor(random() * 26);
      context.fillStyle = `rgb(${shade},${shade},${shade + 3})`;
      context.fillRect(Math.floor(random() * width), Math.floor(random() * height), 1, 1);
    }
    for (let index = 0; index < 5; index++) {
      context.fillStyle = "rgba(120,118,112,0.06)";
      context.beginPath();
      context.ellipse(random() * width, random() * height, 6 + random() * 16, 4 + random() * 10, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }

    // Ragged edges: the tar breaks up into earth. The wear wanders slowly along
    // the road, with the odd bite taken out, instead of spiking every pixel.
    for (const side of [0, 1]) {
      let wear = 3;
      for (let y = 0; y < height; y++) {
        wear = Math.min(6, Math.max(1, wear + (random() - 0.5) * 1.2));
        const bite = random() < 0.03 ? 2 + random() * 3 : 0;
        const pixels = Math.round(wear + bite);
        context.fillStyle = "#7f5340";
        context.fillRect(side === 0 ? 0 : width - pixels, y, pixels, 1);
      }
    }

    // Thin cracks.
    context.strokeStyle = "rgba(25,25,28,0.55)";
    context.lineWidth = 1;
    for (let index = 0; index < 4; index++) {
      let x = 20 + random() * (width - 40);
      let y = random() * height;
      context.beginPath();
      context.moveTo(x, y);
      for (let step = 0; step < 6; step++) {
        x += (random() - 0.5) * 10;
        y += 3 + random() * 6;
        context.lineTo(x, y);
      }
      context.stroke();
    }
  }
  return toTexture(canvas, true);
}

function toTexture(canvas: HTMLCanvasElement, repeat: boolean): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  if (repeat) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  // Seen at a low angle, so mipmaps without anisotropy blur the far road; a little anisotropy is cheap.
  texture.anisotropy = 2;
  return texture;
}
