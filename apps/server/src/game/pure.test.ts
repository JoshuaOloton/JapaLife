import { describe, expect, it } from "vitest";
import { CapacityQueue } from "./capacityQueue";
import { ManualClock, MultiplierClock, calendarDay, createGameClock } from "./clock";
import { KeyedMutex } from "./keyedMutex";
import { TokenBucket } from "./tokenBucket";

describe("GAME_CLOCK", () => {
  it("runs at real speed when unset", () => {
    let real = 1_000_000;
    const clock = new MultiplierClock(1, () => real);
    real += 5000;
    expect(clock.now().getTime()).toBe(1_005_000);
  });

  it("speeds game time up by the multiplier", () => {
    let real = 0;
    const clock = new MultiplierClock(60, () => real);
    real += 60_000; // one real minute
    expect(clock.now().getTime()).toBe(3_600_000); // one game hour
  });

  it("is refused in production", () => {
    expect(() => createGameClock({ NODE_ENV: "production", GAME_CLOCK: "60" })).toThrow(/dev-only/);
  });

  it("is allowed outside production and rejects nonsense values", () => {
    expect(() => createGameClock({ NODE_ENV: "development", GAME_CLOCK: "60" })).not.toThrow();
    for (const bad of ["0", "-5", "abc", "1e9"]) {
      expect(() => createGameClock({ GAME_CLOCK: bad }), bad).toThrow(/GAME_CLOCK/);
    }
  });

  it("is plain real time in production when GAME_CLOCK is not set", () => {
    expect(() => createGameClock({ NODE_ENV: "production" })).not.toThrow();
  });
});

describe("calendarDay", () => {
  it("rolls over at midnight Lagos time (UTC+1), not UTC", () => {
    // 23:30 UTC is 00:30 the next day in Lagos.
    expect(calendarDay(new Date("2026-10-15T23:30:00Z"), "Africa/Lagos")).toBe("2026-10-16");
    expect(calendarDay(new Date("2026-10-15T22:59:00Z"), "Africa/Lagos")).toBe("2026-10-15");
  });
});

describe("TokenBucket", () => {
  it("allows a burst, then limits to the refill rate", () => {
    const bucket = new TokenBucket(3, 1, 0);
    expect([0, 0, 0, 0].map((t) => bucket.tryTake(t))).toEqual([true, true, true, false]);
    expect(bucket.tryTake(1000)).toBe(true); // one token refilled
    expect(bucket.tryTake(1000)).toBe(false);
  });

  it("never holds more than its capacity", () => {
    const bucket = new TokenBucket(2, 10, 0);
    const taken = [60_000, 60_000, 60_000].map((t) => bucket.tryTake(t));
    expect(taken).toEqual([true, true, false]);
  });
});

describe("KeyedMutex", () => {
  it("runs work for the same key one at a time, in order", async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const slow = mutex.run("p1", async () => {
      log.push("a:start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      log.push("a:end");
    });
    const fast = mutex.run("p1", async () => {
      log.push("b:start");
      log.push("b:end");
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("does not block other keys, and a failure does not wedge the queue", async () => {
    const mutex = new KeyedMutex();
    const failed = mutex.run("p1", async () => {
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    await expect(mutex.run("p1", async () => "next")).resolves.toBe("next");
    await expect(mutex.run("p2", async () => "other")).resolves.toBe("other");
  });
});

describe("CapacityQueue (stub)", () => {
  it("keeps arrival order and reports places", () => {
    const queue = new CapacityQueue();
    expect(queue.enqueue("a")).toBe(1);
    expect(queue.enqueue("b")).toBe(2);
    expect(queue.enqueue("a")).toBe(1); // no queue-jumping or duplicates
    queue.leave("a");
    expect(queue.positionOf("b")).toBe(1);
    expect(queue.next()).toBe("b");
    expect(queue.length).toBe(0);
  });
});

describe("ManualClock", () => {
  it("moves only when told", () => {
    const clock = new ManualClock(new Date("2026-10-15T08:00:00Z"));
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe("2026-10-15T08:01:00.000Z");
  });
});
