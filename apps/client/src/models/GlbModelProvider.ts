import type { Group, WebGLRenderer } from 'three';
import { Mesh } from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ModelId } from '@kart/shared';
import type { ModelProvider } from './ModelProvider';

/** GLBs gerados por `pnpm assets` a partir da pasta referencias/. */
const GLB_URLS: Partial<Record<ModelId, string>> = {
  kart: '/assets/models/kart.glb',
};

export class GlbModelProvider implements ModelProvider {
  readonly name = 'glb';
  private readonly loader: GLTFLoader;
  private readonly draco: DRACOLoader;
  private readonly ktx2: KTX2Loader;
  private readonly cache = new Map<ModelId, Promise<GLTF>>();

  constructor(renderer: WebGLRenderer) {
    this.draco = new DRACOLoader().setDecoderPath('/libs/draco/');
    this.ktx2 = new KTX2Loader().setTranscoderPath('/libs/basis/').detectSupport(renderer);
    this.loader = new GLTFLoader()
      .setDRACOLoader(this.draco)
      .setKTX2Loader(this.ktx2)
      .setMeshoptDecoder(MeshoptDecoder);
  }

  async load(id: ModelId): Promise<Group> {
    const url = GLB_URLS[id];
    if (!url) throw new Error(`sem GLB para "${id}"`);

    let pending = this.cache.get(id);
    if (!pending) {
      pending = this.loader.loadAsync(url);
      this.cache.set(id, pending);
      pending.catch(() => this.cache.delete(id));
    }
    const gltf = await pending;

    // Clona a hierarquia; geometrias e materiais ficam compartilhados entre instâncias.
    const group = gltf.scene.clone(true);
    group.name = id;
    group.traverse((node) => {
      if (node instanceof Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    return group;
  }

  dispose(): void {
    this.cache.clear();
    this.draco.dispose();
    this.ktx2.dispose();
  }
}
