import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

let loader: GLTFLoader | undefined;
const cache = new Map<string, Promise<GLTF>>();

/**
 * Carrega (uma vez por URL) um GLB comprimido com Meshopt e texturas WebP.
 * Para peças avulsas — bota, luva, árvores — que não passam pelo ModelProvider.
 */
export function loadGlb(url: string): Promise<GLTF> {
  let pending = cache.get(url);
  if (!pending) {
    loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    pending = loader.loadAsync(url);
    cache.set(url, pending);
    pending.catch(() => cache.delete(url));
  }
  return pending;
}
