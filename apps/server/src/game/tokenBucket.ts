/**
 * A token bucket: allows short bursts but caps the long-run rate. Each action
 * takes one token; tokens refill steadily up to `capacity`. Used to stop a
 * client flooding the server with intents.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    nowMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = nowMs;
  }

  tryTake(nowMs: number): boolean {
    const elapsedSeconds = Math.max(0, nowMs - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefill = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
