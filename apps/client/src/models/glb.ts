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

/** Arquivos opcionais que já falharam nesta sessão: não pede de novo a cada troca. */
const missing = new Set<string>();

/**
 * GLB que pode ainda não existir (ex.: modelo próprio de um cosmético da
 * temporada, exportado do Blender aos poucos). Sem o arquivo, devolve `null`
 * sem erro, e quem chamou usa a malha padrão.
 */
export async function loadOptionalGlb(url: string): Promise<GLTF | null> {
  if (missing.has(url)) return null;
  try {
    return await loadGlb(url);
  } catch {
    missing.add(url);
    return null;
  }
}
