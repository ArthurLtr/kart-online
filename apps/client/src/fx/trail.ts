import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from 'three';

const POINTS = 26;
const SPACING = 0.45;
const HALF_WIDTH = 0.42;
/** Abaixo desta velocidade (m/s) a trilha some. */
const MIN_SPEED = 9;

interface TrailPoint {
  x: number;
  y: number;
  z: number;
  /** Vetor para a esquerda do kart naquele ponto. */
  lx: number;
  lz: number;
  strength: number;
}

/** Aparência da trilha: cor na frente, cor na ponta, largura, intensidade e tremulação. */
export interface TrailStyle {
  color: string;
  tail?: string;
  width?: number;
  strength?: number;
  flicker?: number;
}

/**
 * Trilha luminosa atrás do kart (cosmético "trilha"). É só uma fita desenhada
 * pelo cliente a partir da posição do kart: não existe na simulação.
 */
export class Trail {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly points: TrailPoint[] = [];
  private readonly positions = new Float32Array(POINTS * 2 * 3);
  private readonly colors = new Float32Array(POINTS * 2 * 3);
  private readonly color: Color;
  private readonly tail: Color;
  private readonly width: number;
  private readonly strength: number;
  private readonly flicker: number;

  constructor(style: string | TrailStyle) {
    const look = typeof style === 'string' ? { color: style } : style;
    this.color = new Color(look.color);
    this.tail = new Color(look.tail ?? look.color);
    this.width = look.width ?? 1;
    this.strength = look.strength ?? 1;
    this.flicker = look.flicker ?? 0;
    const geometry = new BufferGeometry();
    const position = new BufferAttribute(this.positions, 3);
    const color = new BufferAttribute(this.colors, 3);
    position.setUsage(DynamicDrawUsage);
    color.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', color);
    const index: number[] = [];
    for (let i = 0; i < POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    this.mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  clear(): void {
    this.points.length = 0;
    this.mesh.visible = false;
  }

  /** Chame a cada quadro com a posição do eixo traseiro do kart. */
  update(x: number, y: number, z: number, heading: number, speed: number): void {
    const head: TrailPoint = {
      x,
      y: y + 0.06,
      z,
      lx: Math.cos(heading),
      lz: -Math.sin(heading),
      strength: Math.min(1, Math.max(0, (speed - MIN_SPEED) / 10)),
    };
    const last = this.points[0];
    if (!last || Math.hypot(last.x - x, last.z - z) >= SPACING) {
      this.points.unshift(head);
      if (this.points.length > POINTS - 1) this.points.pop();
    }
    const chain = [head, ...this.points];
    this.mesh.visible = chain.length > 2 && chain.some((point) => point.strength > 0);
    if (!this.mesh.visible) return;

    const mix = new Color();
    for (let i = 0; i < POINTS; i++) {
      const point = chain[Math.min(i, chain.length - 1)] as TrailPoint;
      const along = i / (POINTS - 1);
      // Fogo e eletricidade tremulam: cada ponto pisca um pouco a cada quadro.
      const shimmer = this.flicker > 0 ? 1 - this.flicker * Math.random() * 0.7 : 1;
      // Some do meio para a ponta e afina.
      const fade = (1 - along) ** 1.6 * point.strength * 0.55 * this.strength * shimmer;
      const half = HALF_WIDTH * this.width * (1 - along * 0.5);
      mix.copy(this.color).lerp(this.tail, along);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        const o = (i * 2 + side) * 3;
        this.positions[o] = point.x + point.lx * half * sign;
        this.positions[o + 1] = point.y;
        this.positions[o + 2] = point.z + point.lz * half * sign;
        this.colors[o] = mix.r * fade;
        this.colors[o + 1] = mix.g * fade;
        this.colors[o + 2] = mix.b * fade;
      }
    }
    (this.mesh.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
