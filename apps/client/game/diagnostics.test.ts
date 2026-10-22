import { Group, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { describeDiagnostics, readDiagnostics } from "./diagnostics";
import { skipWhileHidden } from "./world/skipWhileHidden";

describe("readDiagnostics", () => {
  it("reads the switches only alongside ?fps", () => {
    expect(readDiagnostics("?dpr=1&hide=people").dpr).toBeUndefined();
    const on = readDiagnostics("?fps&dpr=1&hide=people,traffic,ghosts");
    expect(on.dpr).toBe(1);
    expect([...on.hide]).toEqual(["people", "traffic"]); // unknown layers are ignored
    expect(describeDiagnostics(on)).toBe(" · dpr=1 hide=people,traffic");
    expect(describeDiagnostics(readDiagnostics("?fps"))).toBe("");
  });

  it("ignores a pixel ratio out of sensible range", () => {
    expect(readDiagnostics("?fps&dpr=40").dpr).toBeUndefined();
  });
});

describe("skipWhileHidden", () => {
  it("leaves a hidden person's bones alone, and brings them up to date when shown", () => {
    const person = new Group();
    const bone = new Object3D();
    person.add(bone);
    skipWhileHidden(person);
    person.visible = false;
    person.position.set(5, 0, 0);
    person.updateMatrixWorld();
    expect(bone.matrixWorld.elements[12]).toBe(0); // skipped
    person.visible = true;
    person.updateMatrixWorld();
    expect(bone.matrixWorld.elements[12]).toBe(5);
  });
});
