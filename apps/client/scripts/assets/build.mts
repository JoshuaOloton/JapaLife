/**
 * The asset pipeline (`pnpm assets`). Turns the raw third-party packs in
 * `assets/vendor/` (git-ignored, hundreds of MB) into the small files the game
 * downloads, in `apps/client/public/assets/` (committed):
 *
 * - characters/body-<id>.glb: a rigged body with only the data the game draws.
 *   Base-colour textures only, shrunk and converted to KTX2 (stays compressed
 *   in GPU memory); mesh simplified, then compressed with Draco.
 * - characters/body-<id>-regions.png: which body region every texture pixel
 *   belongs to, so clothes can be painted on (see regionMask.mts).
 * - characters/hair-<id>.glb: hair meshes skinned to the same skeleton.
 * - characters/animations.glb: the clips the game uses, on the shared rig.
 *
 * It also writes game/character/clipInfo.generated.json with each movement
 * clip's natural speed, so the game can play it at the speed the player moves.
 *
 * Needs `toktx` (KTX-Software) on the PATH. Usage: `pnpm assets`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import {
  type Animation,
  type Document,
  type JSONDocument,
  type Material,
  NodeIO,
  type Primitive,
  type Texture,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRTextureBasisu } from "@gltf-transform/extensions";
import { dedup, prune, resample } from "@gltf-transform/functions";
import { encodeGreyscalePng } from "./png.mts";
import { bakeRegionMask } from "./regionMask.mts";

const clientDir = join(import.meta.dirname, "..", "..");
const vendorDir = join(clientDir, "..", "..", "assets", "vendor");
const outDir = join(clientDir, "public", "assets");
const clipInfoFile = join(clientDir, "game", "character", "clipInfo.generated.json");
const gltfTransform = join(clientDir, "node_modules", ".bin", "gltf-transform");

const UBC = join(vendorDir, "ubc");
const BODY_DIR = join(UBC, "Base Characters", "Godot - UE");
const HAIR_DIR = join(UBC, "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)");
const UAL1 = join(vendorDir, "ual1", "Unreal-Godot", "UAL1_Standard.glb");
const UAL1_ROOT_MOTION = join(vendorDir, "ual1", "Unreal-Godot", "UAL1_Standard_RM.glb");
const UAL2 = join(vendorDir, "ual2", "Unreal-Godot", "UAL2_Standard.glb");

const BODIES = [
  { id: "male", file: join(BODY_DIR, "Superhero_Male_FullBody.gltf"), bodyMaterial: "MI_Superhero_Male" },
  { id: "female", file: join(BODY_DIR, "Superhero_Female_FullBody.gltf"), bodyMaterial: "MI_Superhero_Female" },
] as const;

const HAIRS = [
  { id: "buzzed", file: join(HAIR_DIR, "Hair_Buzzed.gltf") },
  { id: "buzzed-female", file: join(HAIR_DIR, "Hair_BuzzedFemale.gltf") },
] as const;

/** Game clip id -> source file and clip name. Movement clips are measured for their speed. */
const CLIPS = [
  { id: "idle", file: UAL1, name: "Idle_Loop" },
  { id: "walk", file: UAL1, name: "Walk_Loop", measureSpeed: true },
  { id: "run", file: UAL1, name: "Jog_Fwd_Loop", measureSpeed: true },
  { id: "interact", file: UAL1, name: "Interact" },
  { id: "work_phone", file: UAL2, name: "Idle_TalkingPhone_Loop" },
] as const;

/** Texture edge length by material. The camera is ~14 m away; the body fills ~200 px on a phone. */
function textureSize(material: Material): number {
  const name = material.getName();
  if (name.startsWith("MI_Superhero")) return 512;
  if (name === "MI_Eyes") return 64;
  return 128; // hair and eyebrows: mostly flat colour
}

/** Body region masks: one pixel per texel of a 256-pixel texture is plenty for clothing edges. */
const REGION_MASK_SIZE = 256;

/** Halve the body's triangles (about 12.5k -> 6k); invisible at game camera distance. */
const BODY_SIMPLIFY_RATIO = "0.5";

/** Vertex data the game uses. The packs also carry extra UV sets and vertex colours. */
const KEEP_ATTRIBUTES = new Set(["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"]);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const PLACEHOLDER_PNG = encodeGreyscalePng(new Uint8Array([0]), 1, 1);
const work = mkdtempSync(join(tmpdir(), "japalife-assets-"));

async function main(): Promise<void> {
  if (!existsSync(vendorDir)) fail(`no ${relative(process.cwd(), vendorDir)}: download the packs listed in CLAUDE.md first`);
  try {
    execFileSync("toktx", ["--version"], { stdio: "ignore" });
  } catch {
    fail("toktx not found: install KTX-Software (see CLAUDE.md)");
  }

  for (const body of BODIES) await buildBody(body.id, body.file, body.bodyMaterial);
  for (const hair of HAIRS) await buildHair(hair.id, hair.file);
  await buildAnimations();
  rmSync(work, { recursive: true, force: true });
  report();
}

async function buildBody(id: string, file: string, bodyMaterial: string): Promise<void> {
  const document = await readGltf(file);
  await cleanForGame(document);

  const bodyPrimitive = findPrimitive(document, bodyMaterial);
  const skin = document.getRoot().listSkins()[0];
  if (!skin) fail(`${file}: no skin`);
  const mask = bakeRegionMask(bodyPrimitive, skin, REGION_MASK_SIZE);
  writeOutput(`characters/body-${id}-regions.png`, encodeGreyscalePng(mask, REGION_MASK_SIZE, REGION_MASK_SIZE));

  await compressTextures(document);
  await finish(document, `characters/body-${id}.glb`, { simplify: true });
}

async function buildHair(id: string, file: string): Promise<void> {
  const document = await readGltf(file);
  await cleanForGame(document);
  await compressTextures(document);
  await finish(document, `characters/hair-${id}.glb`, { simplify: false });
}

/**
 * One file with every clip the game plays, on the skeleton they share.
 *
 * Only bone ROTATIONS are kept. The clips were recorded on a mannequin with
 * different proportions; its bone positions would stretch our bodies to its
 * shape. The pelvis keeps its movement (the bob of a walk), stored as an
 * offset from the mannequin's rest height, so the game adds it to each body's
 * own pelvis height. Scale tracks are dropped (always 1), which also lets the
 * game reshape bodies by scaling bones.
 */
async function buildAnimations(): Promise<void> {
  const target = await io.read(UAL1);
  const sources = new Map<string, Document>([[UAL1, target]]);
  for (const clip of CLIPS) {
    if (!sources.has(clip.file)) sources.set(clip.file, await io.read(clip.file));
  }

  const originals = target.getRoot().listAnimations();
  for (const clip of CLIPS) {
    const source = sources.get(clip.file);
    const animation = source?.getRoot().listAnimations().find((candidate) => candidate.getName() === clip.name);
    if (!source || !animation) fail(`${clip.file}: no clip ${clip.name}`);
    copyClip(target, source, animation, clip.id);
  }
  for (const animation of originals) disposeAnimation(animation);

  // Keep the skeleton (the clips target its bones by name), drop the mannequin mesh.
  for (const node of target.getRoot().listNodes()) {
    node.setMesh(null);
    node.setSkin(null);
  }
  await target.transform(resample(), prune({ keepLeaves: true }), dedup());
  const path = join(work, "animations.glb");
  await io.write(path, target);
  writeOutput("characters/animations.glb", readFileSync(path));

  await writeClipInfo();
}

function copyClip(target: Document, source: Document, animation: Animation, id: string): void {
  const buffer = target.getRoot().listBuffers()[0];
  const bones = new Map(target.getRoot().listNodes().map((node) => [node.getName(), node]));
  const sourcePelvis = source.getRoot().listNodes().find((node) => node.getName() === "pelvis");
  const restPelvis = sourcePelvis?.getTranslation() ?? [0, 0, 0];
  const copy = target.createAnimation(id);

  for (const channel of animation.listChannels()) {
    const bone = channel.getTargetNode()?.getName() ?? "";
    const path = channel.getTargetPath();
    const sampler = channel.getSampler();
    const keep = bone !== "root" && (path === "rotation" || (path === "translation" && bone === "pelvis"));
    if (!keep || !sampler) continue;

    const times = sampler.getInput()?.getArray();
    const values = sampler.getOutput()?.getArray()?.slice();
    const output = sampler.getOutput();
    const targetBone = bones.get(bone);
    if (!times || !values || !output || !targetBone) fail(`clip ${id}: cannot copy ${bone}.${path}`);
    if (path === "translation") {
      for (let i = 0; i < values.length; i += 3) {
        for (let axis = 0; axis < 3; axis++) values[i + axis] = (values[i + axis] ?? 0) - (restPelvis[axis] ?? 0);
      }
    }

    const newSampler = target
      .createAnimationSampler()
      .setInterpolation(sampler.getInterpolation())
      .setInput(target.createAccessor().setType("SCALAR").setArray(times.slice()).setBuffer(buffer ?? null))
      .setOutput(target.createAccessor().setType(output.getType()).setArray(values).setBuffer(buffer ?? null));
    copy.addSampler(newSampler);
    copy.addChannel(
      target.createAnimationChannel().setTargetNode(targetBone).setTargetPath(path).setSampler(newSampler),
    );
  }
}

/**
 * Each movement clip's natural ground speed, from the root-motion version of
 * the library (where the root bone travels as the character would).
 */
async function writeClipInfo(): Promise<void> {
  const document = await io.read(UAL1_ROOT_MOTION);
  const info: Record<string, { metresPerSecond: number }> = {};
  for (const clip of CLIPS) {
    if (!("measureSpeed" in clip)) continue;
    const animation = document.getRoot().listAnimations().find((candidate) => candidate.getName() === clip.name);
    const channel = animation
      ?.listChannels()
      .find((candidate) => candidate.getTargetNode()?.getName() === "root" && candidate.getTargetPath() === "translation");
    const times = channel?.getSampler()?.getInput()?.getArray();
    const values = channel?.getSampler()?.getOutput()?.getArray();
    if (!times || !values || times.length < 2) fail(`${clip.name}: no root motion to measure`);
    const last = values.length - 3;
    const distance = Math.hypot(
      (values[last] ?? 0) - (values[0] ?? 0),
      (values[last + 1] ?? 0) - (values[1] ?? 0),
      (values[last + 2] ?? 0) - (values[2] ?? 0),
    );
    const seconds = (times[times.length - 1] ?? 0) - (times[0] ?? 0);
    info[clip.id] = { metresPerSecond: Math.round((distance / seconds) * 1000) / 1000 };
  }
  writeFileSync(clipInfoFile, `${JSON.stringify(info, null, 2)}\n`);
}

/**
 * Reads a .gltf with its side files. The free pack references a few normal maps
 * it does not ship; those get a placeholder, since cleanForGame drops normal
 * maps anyway.
 */
async function readGltf(file: string): Promise<Document> {
  const json = JSON.parse(readFileSync(file, "utf8")) as JSONDocument["json"];
  const resources: JSONDocument["resources"] = {};
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!item.uri || item.uri.startsWith("data:")) continue;
    const path = join(dirname(file), decodeURIComponent(item.uri));
    resources[item.uri] = new Uint8Array(existsSync(path) ? readFileSync(path) : PLACEHOLDER_PNG);
  }
  return io.readJSON({ json, resources });
}

/**
 * Keeps only what our cheap Lambert material draws: base colour, no normal or
 * roughness maps (they cost texture memory and shader time on weak phones).
 */
async function cleanForGame(document: Document): Promise<void> {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        if (!KEEP_ATTRIBUTES.has(semantic)) primitive.setAttribute(semantic, null);
      }
    }
  }
  for (const material of document.getRoot().listMaterials()) {
    material
      .setNormalTexture(null)
      .setMetallicRoughnessTexture(null)
      .setOcclusionTexture(null)
      .setEmissiveTexture(null)
      .setMetallicFactor(0)
      .setRoughnessFactor(1);
  }
  for (const animation of document.getRoot().listAnimations()) disposeAnimation(animation);
  await document.transform(prune({ keepLeaves: true }), dedup());
}

/** Disposing an animation leaves its samplers holding their keyframe data, so free them first. */
function disposeAnimation(animation: Animation): void {
  for (const channel of animation.listChannels()) channel.dispose();
  for (const sampler of animation.listSamplers()) {
    sampler.getInput()?.dispose();
    sampler.getOutput()?.dispose();
    sampler.dispose();
  }
  animation.dispose();
}

async function compressTextures(document: Document): Promise<void> {
  const sizes = new Map<Texture, number>();
  for (const material of document.getRoot().listMaterials()) {
    const texture = material.getBaseColorTexture();
    if (texture) sizes.set(texture, Math.max(sizes.get(texture) ?? 0, textureSize(material)));
  }
  let index = 0;
  for (const [texture, size] of sizes) {
    const image = texture.getImage();
    if (!image) continue;
    const input = join(work, `texture-${index}.png`);
    const output = join(work, `texture-${index++}.ktx2`);
    writeFileSync(input, image);
    // ETC1S: the smallest Basis mode, fine for painted colour. sRGB because it is a colour texture.
    execFileSync("toktx", [
      "--t2", "--encode", "etc1s", "--clevel", "4", "--qlevel", "192",
      "--genmipmap", "--assign_oetf", "srgb", "--resize", `${size}x${size}`,
      output, input,
    ]);
    texture.setImage(readFileSync(output)).setMimeType("image/ktx2");
  }
  document.createExtension(KHRTextureBasisu).setRequired(true);
}

/** Writes the document, then simplifies (optionally) and Draco-compresses it with the gltf-transform CLI. */
async function finish(document: Document, output: string, { simplify }: { simplify: boolean }): Promise<void> {
  const name = output.replaceAll("/", "-");
  let current = join(work, `${name}.raw.glb`);
  await io.write(current, document);
  if (simplify) {
    const next = join(work, `${name}.simplified.glb`);
    execFileSync(gltfTransform, ["simplify", current, next, "--ratio", BODY_SIMPLIFY_RATIO, "--error", "0.001"], {
      stdio: "ignore",
    });
    current = next;
  }
  const compressed = join(work, `${name}.draco.glb`);
  execFileSync(gltfTransform, ["draco", current, compressed], { stdio: "ignore" });
  writeOutput(output, readFileSync(compressed));
}

function findPrimitive(document: Document, materialName: string): Primitive {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMaterial()?.getName() === materialName) return primitive;
    }
  }
  fail(`no primitive with material ${materialName}`);
}

const written: string[] = [];

function writeOutput(path: string, data: Uint8Array): void {
  const target = join(outDir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  written.push(target);
}

function report(): void {
  let total = 0;
  for (const file of written) {
    const bytes = statSync(file).size;
    total += bytes;
    console.log(`${(bytes / 1024).toFixed(0).padStart(6)} KB  ${relative(clientDir, file)}`);
  }
  console.log(`${(total / 1024).toFixed(0).padStart(6)} KB  total`);
}

function fail(message: string): never {
  console.error(`assets: ${message}`);
  process.exit(1);
}

await main();
