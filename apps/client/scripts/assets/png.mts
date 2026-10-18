/**
 * A minimal PNG writer for 8-bit greyscale images (the region masks), so the
 * pipeline needs no image library. PNG is a signature plus chunks; the pixels
 * are rows, each prefixed with a filter byte (0 = none), deflated with zlib.
 */
import { crc32, deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GREYSCALE = 0;

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

export function encodeGreyscalePng(pixels: Uint8Array, width: number, height: number): Buffer {
  if (pixels.length !== width * height) throw new Error(`expected ${width * height} pixels, got ${pixels.length}`);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = GREYSCALE;
  // Bytes 10-12: compression, filter and interlace methods, all 0.

  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0; // filter: none
    rows.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
