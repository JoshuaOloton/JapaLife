import { PLAYER_RADIUS, POSITION_UPDATE_HZ, obstacleGrid } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { fitCamera } from "./camera";
import { RUN_PUSH, WALK_FRACTION } from "./gait";
import { MoveInput, quantiseDirection } from "./input";
import { MoveSender } from "./moveSender";
import { MOVING_TOLERANCE, SNAP_DISTANCE, reconcile } from "./reconcile";
import { SnapshotBuffer } from "./snapshots";

const bounds = { halfWidth: 50, halfDepth: 50 };

describe("SnapshotBuffer (interpolating the server's position)", () => {
  it("blends between the two updates either side of the moment drawn", () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 0, x: 0, z: 0 });
    buffer.push({ t: 100, x: 10, z: -4 });
    expect(buffer.sample(25)).toEqual({ x: 2.5, z: -1 });
  });

  it("holds the newest position instead of guessing past it", () => {
    const buffer = new SnapshotBuffer();
    buffer.push({ t: 0, x: 0, z: 0 });
    buffer.push({ t: 100, x: 10, z: 0 });
    expect(buffer.sample(500)).toEqual({ x: 10, z: 0 });
    expect(buffer.sample(-50)).toEqual({ x: 0, z: 0 });
  });

  it("ignores out-of-order updates and is empty until the first one", () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.sample(0)).toBeUndefined();
    buffer.push({ t: 100, x: 1, z: 0 });
    buffer.push({ t: 50, x: 99, z: 0 });
    expect(buffer.latest).toEqual({ t: 100, x: 1, z: 0 });
  });
});

describe("reconcile (prediction versus the server)", () => {
  const base = { moving: false, deltaSeconds: 1 / 60, obstacles: obstacleGrid([]), bounds };

  it("leaves a walking prediction alone while it is within the leash", () => {
    const predicted = { x: MOVING_TOLERANCE - 0.1, z: 0 };
    expect(reconcile({ ...base, moving: true, predicted, server: { x: 0, z: 0 } })).toEqual(predicted);
  });

  it("pulls a walking prediction back only to the edge of the leash", () => {
    let predicted = { x: MOVING_TOLERANCE + 2, z: 0 };
    for (let i = 0; i < 300; i++) predicted = reconcile({ ...base, moving: true, predicted, server: { x: 0, z: 0 } });
    expect(predicted.x).toBeCloseTo(MOVING_TOLERANCE, 3);
  });

  it("glides onto the server's spot when standing still", () => {
    let predicted = { x: 1, z: 1 };
    const first = reconcile({ ...base, predicted, server: { x: 0, z: 0 } });
    expect(first.x).toBeLessThan(1);
    expect(first.x).toBeGreaterThan(0.5); // a glide, not a jump
    for (let i = 0; i < 300; i++) predicted = reconcile({ ...base, predicted, server: { x: 0, z: 0 } });
    expect(predicted.x).toBeCloseTo(0, 3);
  });

  it("snaps when the two are far apart", () => {
    const server = { x: SNAP_DISTANCE + 1, z: 0 };
    expect(reconcile({ ...base, predicted: { x: 0, z: 0 }, server })).toEqual(server);
  });

  it("never pulls the player through a wall while correcting", () => {
    const wall = { x: 0, z: 0, halfWidth: 0.5, halfDepth: 5 };
    const result = reconcile({ ...base, obstacles: obstacleGrid([wall]), predicted: { x: -2, z: 0 }, server: { x: 2, z: 0 }, deltaSeconds: 1 });
    expect(result.x).toBeLessThanOrEqual(-(0.5 + PLAYER_RADIUS));
  });
});

describe("fitCamera", () => {
  it("leaves a landscape screen at the normal 50 degree view", () => {
    expect(fitCamera(16 / 9)).toEqual({ fov: expect.closeTo(50, 5), distanceScale: 1 });
  });

  it("widens, then pulls back, on a portrait phone so the street still fits", () => {
    const { fov, distanceScale } = fitCamera(375 / 740);
    expect(fov).toBeCloseTo(75, 5);
    expect(distanceScale).toBeGreaterThan(1.3);
  });
});

describe("MoveInput", () => {
  const press = (target: EventTarget, code: string): void => {
    target.dispatchEvent(Object.assign(new Event("keydown"), { code, preventDefault: () => undefined }));
  };

  it("walks on the keys, diagonally no faster than straight", () => {
    const input = new MoveInput();
    const target = new EventTarget();
    input.attachKeyboard(target as unknown as Window);
    press(target, "KeyW");
    press(target, "KeyD");
    const { x, z } = input.direction();
    expect(Math.hypot(x, z)).toBeCloseTo(WALK_FRACTION);
    expect(x).toBeGreaterThan(0);
    expect(z).toBeLessThan(0); // W is north, away from the camera
  });

  it("runs while Shift is held", () => {
    const input = new MoveInput();
    const target = new EventTarget();
    input.attachKeyboard(target as unknown as Window);
    press(target, "KeyW");
    press(target, "ShiftLeft");
    expect(input.direction()).toEqual({ x: 0, z: -1 });
    target.dispatchEvent(Object.assign(new Event("keyup"), { code: "ShiftLeft" }));
    expect(Math.hypot(input.direction().x, input.direction().z)).toBeCloseTo(WALK_FRACTION);
  });

  it("does not move on Shift alone", () => {
    const input = new MoveInput();
    const target = new EventTarget();
    input.attachKeyboard(target as unknown as Window);
    press(target, "ShiftRight");
    expect(input.direction()).toEqual({ x: 0, z: 0 });
  });

  it("lets go of every key when the window loses focus", () => {
    const input = new MoveInput();
    const target = new EventTarget();
    input.attachKeyboard(target as unknown as Window);
    press(target, "ArrowLeft");
    target.dispatchEvent(new Event("blur"));
    expect(input.direction()).toEqual({ x: 0, z: 0 });
  });

  it("walks on a partly pushed joystick, never faster than walking pace", () => {
    const input = new MoveInput();
    input.setJoystick({ x: 0.5, z: 0 });
    const half = input.direction().x;
    input.setJoystick({ x: RUN_PUSH - 0.01, z: 0 });
    const almost = input.direction().x;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(almost);
    expect(almost).toBeLessThanOrEqual(WALK_FRACTION);
  });

  it("runs at full speed, and no faster, when the joystick is pushed to the rim", () => {
    const input = new MoveInput();
    input.setJoystick({ x: RUN_PUSH, z: 0 });
    expect(input.direction()).toEqual({ x: 1, z: 0 });
    input.setJoystick({ x: 1, z: 1 });
    expect(Math.hypot(input.direction().x, input.direction().z)).toBeCloseTo(1);
  });
});

describe("MoveSender", () => {
  const recorder = () => {
    const sent: { seq: number; dx: number; dz: number }[] = [];
    return { sent, room: { send: (_type: "move", payload: (typeof sent)[number]) => sent.push(payload) } };
  };

  it("sends only when the direction changes", () => {
    const { sent, room } = recorder();
    const sender = new MoveSender(room);
    sender.update({ x: 1, z: 0 }, 0);
    sender.update({ x: 1, z: 0 }, 1000);
    sender.update({ x: 1.0001, z: 0 }, 2000); // jitter rounds to the same direction
    expect(sent).toHaveLength(1);
  });

  it(`sends at most ${POSITION_UPDATE_HZ} times a second, with increasing seq`, () => {
    const { sent, room } = recorder();
    const sender = new MoveSender(room);
    for (let frame = 0; frame < 60; frame++) {
      sender.update({ x: Math.cos(frame), z: Math.sin(frame) }, (frame * 1000) / 60);
    }
    expect(sent.length).toBeLessThanOrEqual(POSITION_UPDATE_HZ);
    expect(sent.map((m) => m.seq)).toEqual(sent.map((_, i) => i + 1));
  });

  it("stops at once, even inside the rate window", () => {
    const { sent, room } = recorder();
    const sender = new MoveSender(room);
    sender.update({ x: 0, z: -1 }, 0);
    sender.stop(1);
    expect(sent.at(-1)).toMatchObject({ dx: 0, dz: 0 });
  });

  it("never sends a direction the server would reject as too long", () => {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.01) {
      const { x, z } = quantiseDirection({ x: Math.cos(angle), z: Math.sin(angle) });
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});
