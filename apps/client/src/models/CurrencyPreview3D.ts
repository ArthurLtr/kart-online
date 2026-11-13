import type { Group, Material } from 'three';
import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CurrencyKind } from './currencyModels';
import { GEM_PARTS, loadCurrencyModel } from './currencyModels';

/**
 * Moeda ou gema girando num canvas transparente, para modais e cartões.
 * Cada instância tem renderer próprio e pequeno; chame `dispose()` ao fechar
 * para devolver o contexto WebGL.
 */
export class CurrencyPreview3D {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 20);
  private model: Group | undefined;
  private rim: Mesh | undefined;
  private core: Mesh | undefined;
  private disposed = false;
  private readonly started = performance.now();

  constructor(
    private readonly kind: CurrencyKind,
    size = 140,
  ) {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(size, size);
    this.canvas = this.renderer.domElement;
    this.canvas.classList.add('moeda-3d');
    this.canvas.setAttribute('aria-hidden', 'true');

    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    const key = new DirectionalLight('#fff4e0', 2.2);
    key.position.set(2, 3, 4);
    const fill = new DirectionalLight(kind === 'gem' ? '#7fe9ff' : '#ffd27a', 1.2);
    fill.position.set(-3, -1, 2);
    this.scene.add(new AmbientLight('#ffffff', 0.35), key, fill);
    this.camera.position.set(0, 0, 2.6);

    void loadCurrencyModel(kind).then((model) => {
      if (this.disposed) return disposeTree(model);
      this.model = model;
      this.rim = model.getObjectByName(GEM_PARTS.rim) as Mesh | undefined;
      this.core = model.getObjectByName(GEM_PARTS.core) as Mesh | undefined;
      this.scene.add(model);
    });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    const t = (performance.now() - this.started) / 1000;
    const model = this.model;
    if (model) {
      if (this.kind === 'coin') {
        model.rotation.y = t * 1.6;
        model.position.y = Math.sin(t * 2.5) * 0.04;
      } else {
        model.position.y = Math.sin(t * 2.5) * 0.05;
        // Aro e miolo giram em ritmos diferentes; o miolo só balança para não furar o aro.
        if (this.rim) this.rim.rotation.y = t * 0.9;
        if (this.core) {
          this.core.rotation.y = t * 0.9 + Math.sin(t * 1.7) * 0.22;
          this.core.rotation.z = Math.sin(t * 1.3) * 0.06;
          const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3));
          for (const material of materials(this.core)) {
            if (material instanceof MeshStandardMaterial) material.emissiveIntensity = pulse;
          }
        }
        if (!this.rim && !this.core) model.rotation.y = t * 0.9;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    if (this.model) disposeTree(this.model);
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

const materials = (mesh: Mesh): Material[] =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material];

/** Libera geometrias e materiais da instância (as texturas compartilhadas ficam no cache). */
function disposeTree(root: Group): void {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    for (const material of materials(node)) material.dispose();
  });
}
