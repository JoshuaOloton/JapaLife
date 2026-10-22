import {
  CHUNK_KEEP_RING,
  CHUNK_SEND_RING,
  type ChunkContent,
  type ChunkCoord,
  type ChunksMessage,
  type Point,
  chunkKey,
  chunkOf,
  chunksAround,
  withinRing,
} from "@japalife/shared";

/**
 * Which chunks of the district one player has been sent, and which to send
 * next (area of interest). Called with the server's position of the player
 * every tick: when they cross into another chunk, it answers with the chunks
 * around them they do not have yet. Both sides forget chunks that fall more
 * than `CHUNK_KEEP_RING` from the latest centre, by the same rule, so a
 * chunk the client dropped is sent again on the way back.
 */
export class ChunkStream {
  private centre: ChunkCoord | undefined;
  private readonly sent = new Set<string>();

  constructor(private readonly chunks: ReadonlyMap<string, ChunkContent>) {}

  /** The chunks to send now, or null if the player is still in the same chunk. */
  update(position: Point): ChunksMessage | null {
    const centre = chunkOf(position);
    if (this.centre && this.centre.cx === centre.cx && this.centre.cz === centre.cz) return null;
    this.centre = centre;

    for (const key of this.sent) {
      const [cx, cz] = key.split(",").map(Number) as [number, number];
      if (!withinRing({ cx, cz }, centre, CHUNK_KEEP_RING)) this.sent.delete(key);
    }
    const fresh: ChunkContent[] = [];
    for (const coord of chunksAround(centre, CHUNK_SEND_RING)) {
      const key = chunkKey(coord);
      if (this.sent.has(key)) continue;
      this.sent.add(key);
      // Empty chunks are not sent, but count as sent: there is nothing to wait for.
      const chunk = this.chunks.get(key);
      if (chunk) fresh.push(chunk);
    }
    return { centre, chunks: fresh };
  }
}
