import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONTENT_DIR } from "./content/loadContent";

const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const entry = fileURLToPath(new URL("./index.ts", import.meta.url));

describe("server startup with bad content", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "japalife-startup-"));
    cpSync(DEFAULT_CONTENT_DIR, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses to start, exits with code 1 and lists every problem without a stack trace", () => {
    const file = path.join(dir, "economy/ngn.json");
    const json = JSON.parse(readFileSync(file, "utf8"));
    json.startingBalanceKobo = 100.5;
    json.rent.periodDays = 0;
    writeFileSync(file, JSON.stringify(json));
    writeFileSync(path.join(dir, "economy/jobs.json"), "{ not json");

    const run = spawnSync(tsx, [entry], {
      env: { ...process.env, CONTENT_DIR: dir, SERVER_PORT: "2598" },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("japalife server cannot start: 3 problem(s) in content/");
    expect(run.stderr).toContain("economy/ngn.json at startingBalanceKobo");
    expect(run.stderr).toContain("economy/ngn.json at rent.periodDays");
    expect(run.stderr).toContain("economy/jobs.json:");
    expect(run.stderr).not.toMatch(/^\s+at /m); // no stack frames
    expect(run.stdout).not.toContain("listening");
  });
});
