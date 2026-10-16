import { POSITION_UPDATE_HZ, type Point } from "@japalife/shared";
import { quantiseDirection } from "./input";

interface Sender {
  send(type: "move", payload: { seq: number; dx: number; dz: number }): void;
}

const MIN_INTERVAL_MS = 1000 / POSITION_UPDATE_HZ;

/**
 * Sends `move` intents: the direction the player wants to walk, never a position.
 * The server keeps walking in the last direction it was told, so a message is
 * only needed when the direction changes, and at most `POSITION_UPDATE_HZ`
 * times a second. A change made between sends goes out on the next allowed frame.
 */
export class MoveSender {
  private seq = 0;
  private last: Point = { x: 0, z: 0 };
  private lastSentAt = -Infinity;

  constructor(private readonly room: Sender) {}

  update(direction: Point, now: number): void {
    const next = quantiseDirection(direction);
    if (next.x === this.last.x && next.z === this.last.z) return;
    if (now - this.lastSentAt < MIN_INTERVAL_MS) return;
    this.sendNow(next, now);
  }

  /** Stops the player immediately, ignoring the rate (e.g. the tab is being hidden). */
  stop(now: number): void {
    if (this.last.x === 0 && this.last.z === 0) return;
    this.sendNow({ x: 0, z: 0 }, now);
  }

  private sendNow(direction: Point, now: number): void {
    this.seq += 1;
    this.room.send("move", { seq: this.seq, dx: direction.x, dz: direction.z });
    this.last = direction;
    this.lastSentAt = now;
  }
}
