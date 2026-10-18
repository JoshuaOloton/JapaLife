import type { WebGLRenderer } from "three";
import { DRACO_GLTF_CONFIG, DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

/** Models produced by the asset pipeline (`pnpm assets`), served from `public/assets`. */
export const ASSET_ROOT = "/assets";

/*
 * Model files are compressed: geometry with Draco, textures as KTX2. Decoding
 * needs two small WebAssembly decoders. three.js points at its own copies with
 * `new URL(..., import.meta.url)`, so the bundler serves them from our origin
 * under hashed names and nothing is fetched from a third-party CDN. Only the
 * decoders actually used are downloaded, and only when the first model loads.
 */

// One of each for the whole game: each owns a pool of decoding workers.
let draco: DRACOLoader | undefined;
let ktx2: KTX2Loader | undefined;

/** Pass to `useLoader(GLTFLoader, url, ...)` so every model shares the same decoders. */
export function withDecoders(renderer: WebGLRenderer): (loader: GLTFLoader) => void {
  return (loader) => {
    // The glTF-only build of the Draco decoder: about a third smaller than the full one.
    draco ??= new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
    // Picks the compressed GPU format this phone supports (ETC2, ASTC...).
    ktx2 ??= new KTX2Loader().detectSupport(renderer);
    loader.setDRACOLoader(draco);
    loader.setKTX2Loader(ktx2);
  };
}
