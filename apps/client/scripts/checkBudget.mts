/**
 * Fails when the client's download is over the CLAUDE.md budget (initial load
 * under 15 MB). Run after `next build` (`pnpm budget` does both).
 *
 * It counts everything the build can send to a browser: every static chunk
 * (including the lazily loaded game chunk), the prerendered HTML and `public/`.
 * That is an upper bound on the first visit, so passing here means the real
 * first load passes too. It also holds the characters to their own budget.
 * City assets served from the CDN later will not be part of the build; each
 * district's models are held to their budget by the server's content check.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const BUDGET_BYTES = 15_000_000;
/**
 * Every character file (bodies, animations, region masks, hair, garment pieces),
 * which every district loads (Slice 11 budget). Districts' own models are
 * checked against theirs by the server's content check.
 */
const CHARACTERS_BUDGET_BYTES = 1_500_000;
const clientDir = join(import.meta.dirname, "..");

const roots = [
  { dir: join(clientDir, ".next", "static"), include: () => true },
  { dir: join(clientDir, ".next", "server", "app"), include: (file: string) => file.endsWith(".html") },
  { dir: join(clientDir, "public"), include: () => true },
];

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile());
}

if (!existsSync(join(clientDir, ".next", "static"))) {
  console.error("No build found. Run `pnpm --filter @japalife/client build` first, or use `pnpm budget`.");
  process.exit(1);
}

const files = roots.flatMap(({ dir, include }) =>
  filesUnder(dir)
    .filter(include)
    .map((path) => {
      const bytes = readFileSync(path);
      return { path: relative(clientDir, path), raw: bytes.length, gzip: gzipSync(bytes).length };
    }),
);

const raw = files.reduce((sum, file) => sum + file.raw, 0);
const gzip = files.reduce((sum, file) => sum + file.gzip, 0);
const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(2)} MB`;

console.log(`client download, upper bound: ${mb(raw)} raw, ${mb(gzip)} gzipped, ${files.length} files`);
console.log("largest files:");
for (const file of [...files].sort((a, b) => b.raw - a.raw).slice(0, 5)) {
  console.log(`  ${mb(file.raw).padStart(9)} raw ${mb(file.gzip).padStart(9)} gzip  ${file.path}`);
}

const characters = filesUnder(join(clientDir, "public", "assets", "characters")).reduce((sum, path) => sum + statSync(path).size, 0);
console.log(`characters: ${mb(characters)} (budget ${mb(CHARACTERS_BUDGET_BYTES)})`);

let over = false;
if (raw > BUDGET_BYTES) {
  console.error(`over budget: ${mb(raw)} is more than ${mb(BUDGET_BYTES)}`);
  over = true;
}
if (characters > CHARACTERS_BUDGET_BYTES) {
  console.error(`characters over budget: ${mb(characters)} is more than ${mb(CHARACTERS_BUDGET_BYTES)}`);
  over = true;
}
if (over) process.exit(1);
console.log(`within budget (${mb(BUDGET_BYTES)})`);
