import { readFileSync } from "node:fs";
import { vehicleKindsSchema } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { type BuiltVehicleLook, builtVehicleParts } from "./vehicleShapes";

const shipped = vehicleKindsSchema.parse(
  JSON.parse(readFileSync(new URL("../../../../content/traffic/kinds.json", import.meta.url), "utf8")),
).kinds;
const EPSILON = 1e-9;

describe("builtVehicleParts", () => {
  const built = Object.entries(shipped).flatMap(([id, kind]) => ("built" in kind.look ? [[id, kind.look] as const] : []));

  it("ships a keke and an okada", () => {
    expect(built.map(([, look]) => look.built).sort()).toEqual(["keke", "okada"]);
  });

  it("keeps every part inside the kind's declared size, so the traffic's spacing and stopping are right", () => {
    for (const [id, look] of built) {
      for (const part of builtVehicleParts(look as BuiltVehicleLook)) {
        expect(Math.abs(part.dx) + part.halfWidth, id).toBeLessThanOrEqual(look.halfWidth + EPSILON);
        expect(Math.abs(part.dz) + part.halfDepth, id).toBeLessThanOrEqual(look.halfLength + EPSILON);
        expect(part.y + part.height, id).toBeLessThanOrEqual(look.height + EPSILON);
      }
    }
  });

  it("stretches to a bigger declared size", () => {
    const small = builtVehicleParts({ built: "okada", halfLength: 0.95, halfWidth: 0.35, height: 1.6 });
    const big = builtVehicleParts({ built: "okada", halfLength: 1.9, halfWidth: 0.35, height: 1.6 });
    expect(big[0]?.dz).toBeCloseTo((small[0]?.dz ?? 0) * 2, 9);
  });
});
