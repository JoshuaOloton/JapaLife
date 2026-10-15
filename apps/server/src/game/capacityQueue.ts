/**
 * STUB. The "queue and show your place in line" behaviour from CLAUDE.md: when
 * every district instance is full, players wait here in arrival order. It is not
 * wired to room matchmaking yet (Phase 5); Colyseus already refuses joins beyond
 * `maxClients`, so nothing over capacity is ever accepted in the meantime.
 */
export class CapacityQueue {
  private readonly waiting: string[] = [];

  /** Adds a player to the back of the line. Joining twice keeps the original place. */
  enqueue(playerId: string): number {
    if (!this.waiting.includes(playerId)) this.waiting.push(playerId);
    return this.positionOf(playerId) ?? this.waiting.length;
  }

  /** 1-based place in line, or undefined if not waiting. */
  positionOf(playerId: string): number | undefined {
    const index = this.waiting.indexOf(playerId);
    return index === -1 ? undefined : index + 1;
  }

  leave(playerId: string): void {
    const index = this.waiting.indexOf(playerId);
    if (index !== -1) this.waiting.splice(index, 1);
  }

  /** Takes the player at the front of the line, when a seat opens up. */
  next(): string | undefined {
    return this.waiting.shift();
  }

  get length(): number {
    return this.waiting.length;
  }
}
