import { seededRandom } from "@japalife/shared";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * Ground and road surfaces, painted on canvases when the scene loads, like the
 * signboards: nothing is downloaded. A fixed seed means every visit paints the
 * same Yaba.
 */

/**
 * Lagos is on the coast: its bare ground is greyish-tan sand packed hard by
 * feet, not the red laterite of inland Nigeria (changed 2026-10-21). A mid
 * tone, because the midday light washes pale sand out to white.
 */
const SAND = "#a6957a";
const SAND_MOTTLE = ["#978769", "#b3a385", "#8c7d65", "#a99b84", "#857661"];
/** Where the road's tar breaks up into the ground. */
const ROAD_EDGE = "#8a7b63";
const GRASS = ["#5f7336", "#6c7d3e", "#55682f"];
const ASPHALT = "#3f3f43";

/** Metres of ground one painted tile covers: about a third of a metre a pixel, as Yaba had at 120 m. */
export const GROUND_TILE_METRES = 180;

/**
 * Packed sandy earth with worn patches of grass, as a 512-pixel tile that
 * repeats over the whole district (`GROUND_TILE_METRES` each): the grain comes
 * from soft specks, the patches from soft blobs. Every blob that crosses an
 * edge is painted again on the opposite edge, so the tiles meet without a seam.
 */
export function paintGround(size = 512): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const random = seededRandom(0x1a905);
  if (context) {
    context.fillStyle = SAND;
    context.fillRect(0, 0, size, size);
    /** A soft round blob, wrapped round the tile's edges. */
    const blob = (x: number, y: number, r: number, inner: string, outer: string): void => {
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          const cx = x + dx;
          const cy = y + dy;
          if (cx + r < 0 || cy + r < 0 || cx - r > size || cy - r > size) continue;
          const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, r);
          gradient.addColorStop(0, inner);
          gradient.addColorStop(1, outer);
          context.fillStyle = gradient;
          context.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
      }
    };

    for (let index = 0; index < 22; index++) {
      const x = random() * size;
      const y = random() * size;
      const radius = 8 + random() * 30;
      const colour = GRASS[Math.floor(random() * GRASS.length)] ?? GRASS[0]!;
      for (let tuft = 0; tuft < 14; tuft++) {
        const tx = x + (random() - 0.5) * radius * 1.6;
        const ty = y + (random() - 0.5) * radius * 1.6;
        const r = radius * (0.25 + random() * 0.45);
        blob(tx, ty, r, `${colour}cc`, `${colour}00`);
      }
    }

    // Soft, faint mottling: a pixel here is about a third of a metre, so sharp
    // specks would blow up into polka dots right under the player's feet.
    for (let index = 0; index < 900; index++) {
      const x = random() * size;
      const y = random() * size;
      const r = 2 + random() * 7;
      const colour = SAND_MOTTLE[Math.floor(random() * SAND_MOTTLE.length)] ?? SAND;
      blob(x, y, r, `${colour}55`, `${colour}00`);
    }
  }
  return toTexture(canvas, true);
}

/**
 * A strip of tarred road, across its width from edge to edge: worn, broken
 * edges where the tar crumbles into the earth, faded patches and cracks.
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
        context.fillStyle = ROAD_EDGE;
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

export interface SignStyle {
  background: string;
  text?: string;
  /** Canvas size in pixels; keep the board's aspect ratio. */
  width?: number;
  height?: number;
  /** Lines the text may wrap onto before it shrinks instead. */
  maxLines?: number;
}

/**
 * Text on a painted board: place signs, billboards, shop signs, speech bubbles.
 * Painted once on a small canvas, so no font file is downloaded and a board
 * costs one tiny texture. Long text wraps, then shrinks until it fits.
 */
export function paintSign(label: string, { background, text = "#ffffff", width = 256, height = 64, maxLines = 1 }: SignStyle): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = text;
    context.lineWidth = 4;
    context.strokeRect(2, 2, width - 4, height - 4);
    context.fillStyle = text;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const fits = (line: string): boolean => context.measureText(line).width <= width - 20;
    let size = Math.floor(height / (maxLines + 0.9)) + 2;
    let lines: string[];
    do {
      size -= 2;
      context.font = `bold ${size}px system-ui, sans-serif`;
      lines = wrapText(label, fits, maxLines);
    } while (!lines.every(fits) && size > 12);
    const lineHeight = size * 1.15;
    lines.forEach((line, index) => {
      context.fillText(line, width / 2, height / 2 + 2 + (index - (lines.length - 1) / 2) * lineHeight);
    });
  }
  return toTexture(canvas, false);
}

/** Splits text into at most `maxLines` lines at spaces, filling each line while `fits` allows. */
export function wrapText(label: string, fits: (line: string) => boolean, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of label.split(" ")) {
    const tried = current ? `${current} ${word}` : word;
    if (current && !fits(tried) && lines.length < maxLines - 1) {
      lines.push(current);
      current = word;
    } else {
      current = tried;
    }
  }
  lines.push(current);
  return lines;
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
