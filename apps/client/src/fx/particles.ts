import type { Blending } from 'three';
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

const vertexShader = /* glsl */ `
  attribute vec3 aCenter;
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  varying vec2 vUv;

  void main() {
    vColor = aColor;
    vUv = uv;
    // Billboard: o quadrado é montado já no espaço da câmera.
    vec4 view = viewMatrix * vec4(aCenter, 1.0);
    view.xy += position.xy * aSize;
    gl_Position = projectionMatrix * view;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec4 vColor;
  varying vec2 vUv;

  void main() {
    float falloff = 1.0 - smoothstep(0.0, 0.5, length(vUv - 0.5));
    gl_FragColor = vec4(vColor.rgb, vColor.a * falloff);
  }
`;

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Segundos de vida. */
  life: number;
  /** Diâmetro no início e no fim, m. */
  size: number;
  endSize: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  /** Aceleração vertical, m/s² (negativa cai, positiva sobe). */
  gravity: number;
  /** Fração da velocidade perdida por segundo. */
  drag: number;
}

/**
 * Sistema de partículas instanciado com pool fixo: um draw call, sem alocação
 * durante o jogo. Quando o pool enche, as mais antigas são reaproveitadas.
 */
export class ParticleSystem {
  readonly mesh: Mesh;
  private readonly centers: Float32Array;
  private readonly sizes: Float32Array;
  private readonly colors: Float32Array;
  private readonly data: Float32Array; // por partícula: vx, vy, vz, idade, vida, size0, size1, alpha, gravidade, arrasto
  private readonly geometry: InstancedBufferGeometry;
  private next = 0;

  constructor(
    private readonly capacity: number,
    blending: Blending = NormalBlending,
  ) {
    this.centers = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.colors = new Float32Array(capacity * 4);
    this.data = new Float32Array(capacity * 10);

    const quad = new PlaneGeometry(1, 1);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.geometry.setAttribute('aCenter', new InstancedBufferAttribute(this.centers, 3));
    this.geometry.setAttribute('aSize', new InstancedBufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aColor', new InstancedBufferAttribute(this.colors, 4));
    this.geometry.instanceCount = capacity;

    this.mesh = new Mesh(
      this.geometry,
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        blending,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  spawn(particle: ParticleSpawn): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.centers.set([particle.x, particle.y, particle.z], i * 3);
    this.colors.set([particle.r, particle.g, particle.b, particle.alpha], i * 4);
    this.sizes[i] = particle.size;
    this.data.set(
      [
        particle.vx,
        particle.vy,
        particle.vz,
        0,
        particle.life,
        particle.size,
        particle.endSize,
        particle.alpha,
        particle.gravity,
        particle.drag,
      ],
      i * 10,
    );
  }

  update(dt: number): void {
    const { centers, sizes, colors, data } = this;
    for (let i = 0; i < this.capacity; i++) {
      const d = i * 10;
      const life = data[d + 4] as number;
      if (life <= 0) continue;
      const age = (data[d + 3] as number) + dt;
      if (age >= life) {
        data[d + 4] = 0;
        sizes[i] = 0;
        colors[i * 4 + 3] = 0;
        continue;
      }
      data[d + 3] = age;
      const keep = Math.max(0, 1 - (data[d + 9] as number) * dt);
      data[d] = (data[d] as number) * keep;
      data[d + 1] = ((data[d + 1] as number) + (data[d + 8] as number) * dt) * keep;
      data[d + 2] = (data[d + 2] as number) * keep;
      const c = i * 3;
      centers[c] = (centers[c] as number) + (data[d] as number) * dt;
      centers[c + 1] = (centers[c + 1] as number) + (data[d + 1] as number) * dt;
      centers[c + 2] = (centers[c + 2] as number) + (data[d + 2] as number) * dt;
      const t = age / life;
      sizes[i] = (data[d + 5] as number) + ((data[d + 6] as number) - (data[d + 5] as number)) * t;
      colors[i * 4 + 3] = (data[d + 7] as number) * (1 - t) * Math.min(1, t * 8);
    }
    this.geometry.getAttribute('aCenter').needsUpdate = true;
    this.geometry.getAttribute('aSize').needsUpdate = true;
    this.geometry.getAttribute('aColor').needsUpdate = true;
  }

  clear(): void {
    this.data.fill(0);
    this.sizes.fill(0);
  }
}
