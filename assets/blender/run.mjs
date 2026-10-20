/**
 * `pnpm blender [names...]`: builds our own models by running the Python scripts
 * in assets/blender/ inside Blender with no window (`--background`) and factory
 * settings (`--factory-startup`), so nobody's Blender preferences change the
 * result. Each script writes a GLB, a .blend to look at in the Blender window,
 * and a preview PNG to assets/built/ (git-ignored); `pnpm assets` then
 * compresses the GLBs into the game like any other pack.
 *
 * With no names it builds every script. Blender comes from $BLENDER, or the
 * usual macOS install.
 */
import { execFileSync } from "node:child_process";
import console from "node:console";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(root, "assets", "built");
const blender = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";

if (!existsSync(blender)) {
  console.error(`Blender not found at ${blender}. Install Blender or set BLENDER to its executable.`);
  process.exit(1);
}

const all = readdirSync(here)
  .filter((name) => name.endsWith(".py"))
  .map((name) => name.slice(0, -3))
  .sort();
const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !all.includes(name));
if (unknown.length > 0) {
  console.error(`No script for: ${unknown.join(", ")}. Scripts: ${all.join(", ")}`);
  process.exit(1);
}

for (const name of wanted.length > 0 ? wanted : all) {
  const script = join(here, `${name}.py`);
  const output = execFileSync(
    blender,
    ["--background", "--factory-startup", "--python-exit-code", "1", "--python", script, "--", "--out", out],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  // Blender prints a lot; keep only our scripts' own lines.
  for (const line of output.split("\n")) if (line.startsWith("built ")) console.log(line);
}
console.log(`outputs in ${relative(process.cwd(), out) || "."}`);
