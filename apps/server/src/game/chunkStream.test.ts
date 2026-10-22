import { CHUNK_KEEP_RING, CHUNK_METRES, CHUNK_SEND_RING, type ChunkContent, chunkKey } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { ChunkStream } from "./chunkStream";

/** A district of 21 x 21 chunks, each with one prop at its middle. */
function district(): Map<string, ChunkContent> {
  const chunks = new Map<string, ChunkContent>();
  for (let cx = -10; cx <= 10; cx++) {
    for (let cz = -10; cz <= 10; cz++) {
      const prop = { kind: "generator", x: (cx + 0.5) * CHUNK_METRES, z: (cz + 0.5) * CHUNK_METRES, rotation: 0 as const };
      chunks.set(chunkKey({ cx, cz }), { cx, cz, buildings: [], props: [prop] });
    }
  }
  return chunks;
}

const keys = (message: ReturnType<ChunkStream["update"]>): string[] => (message?.chunks ?? []).map(chunkKey).sort();
const ring = (CHUNK_SEND_RING * 2 + 1) ** 2;

describe("ChunkStream", () => {
  it("sends the square around the player on join, their own chunk first", () => {
    const stream = new ChunkStream(district());
    const first = stream.update({ x: 10, z: 10 });
    expect(first?.centre).toEqual({ cx: 0, cz: 0 });
    expect(first?.chunks).toHaveLength(ring);
    expect(first?.chunks[0]).toMatchObject({ cx: 0, cz: 0 });
  });

  it("sends nothing while the player stays in the same chunk", () => {
    const stream = new ChunkStream(district());
    stream.update({ x: 10, z: 10 });
    expect(stream.update({ x: 50, z: 60 })).toBeNull();
  });

  it("sends only the new edge when the player walks into the next chunk", () => {
    const stream = new ChunkStream(district());
    stream.update({ x: 10, z: 10 });
    const next = stream.update({ x: 10, z: -10 }); // one chunk north
    expect(next?.centre).toEqual({ cx: 0, cz: -1 });
    const expected = [-2, -1, 0, 1, 2].map((cx) => chunkKey({ cx, cz: -1 - CHUNK_SEND_RING })).sort();
    expect(keys(next)).toEqual(expected);
  });

  it("sends a chunk again on the way back once it was dropped, but not before", () => {
    const stream = new ChunkStream(district());
    stream.update({ x: 10, z: 10 });
    // Walk north until the first square's south edge falls out of the keep ring.
    let cz = 0;
    while (cz > -(CHUNK_SEND_RING + CHUNK_KEEP_RING)) {
      cz--;
      stream.update({ x: 10, z: cz * CHUNK_METRES + 10 });
    }
    // Back one chunk: everything it needs is still kept (the keep ring is wider than the send ring,
    // so pacing over a chunk edge sends nothing twice).
    expect(keys(stream.update({ x: 10, z: (cz + 1) * CHUNK_METRES + 10 }))).toEqual([]);
    // Back two: that edge was dropped, so it comes again.
    const back = stream.update({ x: 10, z: (cz + 2) * CHUNK_METRES + 10 });
    expect(keys(back)).toEqual([-2, -1, 0, 1, 2].map((cx) => chunkKey({ cx, cz: cz + 2 + CHUNK_SEND_RING })).sort());
  });

  it("does not send empty chunks", () => {
    const stream = new ChunkStream(new Map());
    expect(stream.update({ x: 0, z: 0 })?.chunks).toEqual([]);
  });
});
