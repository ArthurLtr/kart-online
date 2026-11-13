import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from 'three';

const SEGMENTS = 420;
const WIDTH = 0.17;
const LIFETIME = 14; // segundos até sumir
const MIN_STEP = 0.22; // m entre segmentos

/**
 * Marca de derrapagem de uma roda: uma fita no asfalto que some com o tempo.
 * Buffer circular de tamanho fixo, um draw call, sem alocação durante o jogo.
 */
export class SkidMark {
  readonly mesh: Mesh;
  private readonly positions = new Float32Array(SEGMENTS * 4 * 3);
  private readonly colors = new Float32Array(SEGMENTS * 4 * 4);
  private readonly birth = new Float32Array(SEGMENTS).fill(-1e6);
  private readonly strength = new Float32Array(SEGMENTS);
  private readonly geometry = new BufferGeometry();
  private next = 0;
  private drawing = false;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private lastLeftX = 0;
  private lastLeftZ = 0;

  constructor() {
    const indices: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const v = i * 4;
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    const position = new BufferAttribute(this.positions, 3);
    const color = new BufferAttribute(this.colors, 4);
    position.setUsage(DynamicDrawUsage);
    color.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', position);
    this.geometry.setAttribute('color', color);
    this.geometry.setIndex(indices);
    this.mesh = new Mesh(
      this.geometry,
      new MeshBasicMaterial({
        vertexColors: true,
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * @param intensity 0 = roda aderindo (interrompe a marca); até 1 = marca mais escura
   * @param x,y,z ponto de contato da roda com o chão
   */
  update(time: number, intensity: number, x: number, y: number, z: number): void {
    if (intensity <= 0.02) {
      this.drawing = false;
    } else {
      const dx = x - this.lastX;
      const dz = z - this.lastZ;
      const length = Math.hypot(dx, dz);
      if (!this.drawing || length > 3) {
        // Começa uma marca nova (ou o kart foi reposicionado).
        this.drawing = true;
        this.lastX = x;
        this.lastY = y;
        this.lastZ = z;
        this.lastLeftX = 0;
        this.lastLeftZ = 0;
      } else if (length >= MIN_STEP) {
        // Lateral da fita, perpendicular ao deslocamento.
        const leftX = (-dz / length) * (WIDTH / 2);
        const leftZ = (dx / length) * (WIDTH / 2);
        const startLeftX = this.lastLeftX || leftX;
        const startLeftZ = this.lastLeftZ || leftZ;
        const p = this.next * 12;
        const lift = 0.025;
        this.positions.set(
          [
            this.lastX + startLeftX,
            this.lastY + lift,
            this.lastZ + startLeftZ,
            this.lastX - startLeftX,
            this.lastY + lift,
            this.lastZ - startLeftZ,
            x + leftX,
            y + lift,
            z + leftZ,
            x - leftX,
            y + lift,
            z - leftZ,
          ],
          p,
        );
        this.birth[this.next] = time;
        this.strength[this.next] = Math.min(1, intensity);
        this.next = (this.next + 1) % SEGMENTS;
        this.lastX = x;
        this.lastY = y;
        this.lastZ = z;
        this.lastLeftX = leftX;
        this.lastLeftZ = leftZ;
        this.geometry.getAttribute('position').needsUpdate = true;
      }
    }

    // As marcas clareiam com a idade até sumir.
    for (let i = 0; i < SEGMENTS; i++) {
      const age = time - (this.birth[i] as number);
      const alpha = age < LIFETIME ? (this.strength[i] as number) * 0.6 * (1 - age / LIFETIME) : 0;
      const c = i * 16;
      for (let v = 0; v < 4; v++) {
        this.colors[c + v * 4] = 0.03;
        this.colors[c + v * 4 + 1] = 0.03;
        this.colors[c + v * 4 + 2] = 0.03;
        this.colors[c + v * 4 + 3] = alpha;
      }
    }
    this.geometry.getAttribute('color').needsUpdate = true;
  }

  clear(): void {
    this.birth.fill(-1e6);
    this.drawing = false;
  }
}
