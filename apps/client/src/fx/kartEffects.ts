import type { Object3D } from 'three';
import { AdditiveBlending, Group, Vector3 } from 'three';
import type { KartState } from '@kart/shared';
import { KART_PARTS, speedOf } from '@kart/shared';
import { ParticleSystem } from './particles';
import { SkidMark } from './skidMarks';

/** Gerador simples para variar as partículas (visual, não precisa ser determinístico). */
const jitter = (amount: number): number => (Math.random() - 0.5) * 2 * amount;

/**
 * Efeitos de um kart, todos derivados do estado da simulação: fumaça de pneu
 * e marcas de derrapagem no drift, poeira na grama, pedriscos na brita,
 * fagulhas ao raspar na zebra ou bater, e o ar quente do escapamento.
 * Nenhum efeito de turbo: o jogo não tem turbo.
 */
export class KartEffects {
  readonly group = new Group();
  private readonly soft: ParticleSystem;
  private readonly sparks: ParticleSystem;
  private readonly skids: readonly SkidMark[];
  private readonly wheels: Object3D[];
  private readonly exhaust: Object3D | undefined;
  private readonly point = new Vector3();
  private smokeDebt = 0;
  private dustDebt = 0;
  private sparkDebt = 0;
  private heatDebt = 0;

  /**
   * @param pool partículas divididas por todos os karts da corrida (2 draw calls no total)
   * @param withSkidMarks marcas no asfalto; ligadas só no kart do jogador para poupar draw calls
   */
  constructor(
    private readonly kart: Object3D,
    pool: EffectsPool,
    withSkidMarks: boolean,
  ) {
    this.soft = pool.soft;
    this.sparks = pool.sparks;
    this.skids = withSkidMarks ? [new SkidMark(), new SkidMark()] : [];
    this.group.name = 'kart_effects';
    for (const skid of this.skids) this.group.add(skid.mesh);
    this.wheels = [KART_PARTS.wheelRearLeft, KART_PARTS.wheelRearRight]
      .map((name) => kart.getObjectByName(name))
      .filter((node): node is Object3D => node !== undefined);
    this.exhaust = kart.getObjectByName(KART_PARTS.exhaust);
  }

  /**
   * @param time segundos desde o início da cena
   * @param throttle 0 a 1, para o calor do escapamento
   */
  update(dt: number, time: number, state: KartState, throttle: number): void {
    const speed = speedOf(state);
    const onTarmac = state.surface === 'asphalt' || state.surface === 'curb';
    const sliding = Math.min(1, Math.max(state.rearSlide * 0.8, state.wheelSlip));
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    // Velocidade do kart no mundo: as partículas herdam parte dela.
    const wx = state.vx * fx + state.vy * fz;
    const wz = state.vx * fz - state.vy * fx;

    // --- rodas traseiras: marcas, fumaça, poeira e pedriscos -----------------
    const smoke = onTarmac && speed > 3 ? Math.max(0, sliding - 0.3) / 0.7 : 0;
    this.smokeDebt += smoke * 55 * dt;
    const dust = !onTarmac && speed > 2 ? Math.min(1, speed / 14) : 0;
    this.dustDebt += dust * 45 * dt;

    this.wheels.forEach((wheel, i) => {
      wheel.getWorldPosition(this.point);
      const groundY = state.y;
      const { x, z } = this.point;
      this.skids[i]?.update(
        time,
        onTarmac && speed > 2 ? Math.max(0, sliding - 0.2) : 0,
        x,
        groundY,
        z,
      );

      const smokeCount = Math.floor(this.smokeDebt / 2);
      for (let n = 0; n < smokeCount; n++) {
        this.soft.spawn({
          x: x + jitter(0.1),
          y: groundY + 0.12,
          z: z + jitter(0.1),
          vx: wx * 0.25 + jitter(0.6),
          vy: 0.7 + Math.random() * 0.7,
          vz: wz * 0.25 + jitter(0.6),
          life: 0.9 + Math.random() * 0.6,
          size: 0.35,
          endSize: 1.7,
          r: 0.86,
          g: 0.86,
          b: 0.88,
          alpha: 0.2 * smoke,
          gravity: 0.5,
          drag: 1.2,
        });
      }

      const dustCount = Math.floor(this.dustDebt / 2);
      const gravel = state.surface === 'gravel';
      for (let n = 0; n < dustCount; n++) {
        // Nuvem de poeira: bege na brita, mais escura e esverdeada na grama.
        this.soft.spawn({
          x: x + jitter(0.15),
          y: groundY + 0.1,
          z: z + jitter(0.15),
          vx: wx * 0.3 + jitter(1),
          vy: 0.6 + Math.random(),
          vz: wz * 0.3 + jitter(1),
          life: 0.8 + Math.random() * 0.7,
          size: 0.3,
          endSize: gravel ? 1.9 : 1.3,
          r: gravel ? 0.78 : 0.5,
          g: gravel ? 0.71 : 0.47,
          b: gravel ? 0.58 : 0.33,
          alpha: (gravel ? 0.42 : 0.3) * dust,
          gravity: 0.2,
          drag: 1.4,
        });
        if (gravel || n % 3 === 0) {
          // Pedriscos (ou torrões de grama): pequenos, pesados, jogados para trás.
          this.soft.spawn({
            x,
            y: groundY + 0.08,
            z,
            vx: -wx * 0.25 + jitter(2.2),
            vy: 1.8 + Math.random() * 2.6,
            vz: -wz * 0.25 + jitter(2.2),
            life: 0.5 + Math.random() * 0.4,
            size: gravel ? 0.07 : 0.09,
            endSize: gravel ? 0.06 : 0.07,
            r: gravel ? 0.62 : 0.26,
            g: gravel ? 0.56 : 0.36,
            b: gravel ? 0.45 : 0.16,
            alpha: 1,
            gravity: -9.8,
            drag: 0.3,
          });
        }
      }
    });
    this.smokeDebt %= 2;
    this.dustDebt %= 2;

    // --- fagulhas: assoalho raspando na zebra em velocidade, ou pancada --------
    const scraping = state.surface === 'curb' && speed > 14 ? Math.min(1, (speed - 14) / 12) : 0;
    this.sparkDebt += scraping * 26 * dt + (state.impact > 2 ? Math.min(24, state.impact * 3) : 0);
    const sparkCount = Math.floor(this.sparkDebt);
    this.sparkDebt -= sparkCount;
    for (let n = 0; n < sparkCount; n++) {
      this.sparks.spawn({
        x: state.x + fx * 0.6 + jitter(0.35),
        y: state.y + 0.05,
        z: state.z + fz * 0.6 + jitter(0.35),
        vx: -wx * 0.35 + jitter(2.5),
        vy: 0.8 + Math.random() * 2.2,
        vz: -wz * 0.35 + jitter(2.5),
        life: 0.25 + Math.random() * 0.3,
        size: 0.07,
        endSize: 0.02,
        r: 2.4, // HDR: acima de 1 entra no bloom
        g: 1.4,
        b: 0.4,
        alpha: 1,
        gravity: -9.8,
        drag: 0.4,
      });
    }

    // --- ar quente do escapamento ---------------------------------------------
    // Aproximação: névoa clara quase transparente saindo da ponteira (não é refração de verdade).
    if (this.exhaust) {
      this.heatDebt += (4 + throttle * 22) * dt;
      const heatCount = Math.floor(this.heatDebt);
      this.heatDebt -= heatCount;
      for (let n = 0; n < heatCount; n++) {
        for (const side of [-1, 1]) {
          // Ponteiras: atrás do banco, uma de cada lado (medidas do modelo convertido).
          this.point.set(side * 0.15, 0.6, -0.42);
          this.kart.localToWorld(this.point);
          this.soft.spawn({
            x: this.point.x,
            y: this.point.y,
            z: this.point.z,
            vx: -fx * (1 + throttle * 2) + wx * 0.6 + jitter(0.2),
            vy: 0.5 + Math.random() * 0.4,
            vz: -fz * (1 + throttle * 2) + wz * 0.6 + jitter(0.2),
            life: 0.35 + Math.random() * 0.25,
            size: 0.1,
            endSize: 0.5,
            r: 0.95,
            g: 0.95,
            b: 1,
            alpha: 0.05 + throttle * 0.06,
            gravity: 1.2,
            drag: 2,
          });
        }
      }
    }
  }

  /** Apaga as marcas de derrapagem (ao reiniciar). */
  clear(): void {
    for (const skid of this.skids) skid.clear();
  }
}

/** Partículas compartilhadas por todos os karts: uma nuvem "macia" e uma de fagulhas. */
export class EffectsPool {
  readonly group = new Group();
  readonly soft = new ParticleSystem(1600);
  readonly sparks = new ParticleSystem(240, AdditiveBlending);

  constructor() {
    this.group.name = 'effects_pool';
    this.group.add(this.soft.mesh, this.sparks.mesh);
  }

  update(dt: number): void {
    this.soft.update(dt);
    this.sparks.update(dt);
  }

  /** Chuva de confete para o pódio, em volta de um ponto. */
  confetti(x: number, y: number, z: number, count: number): void {
    const colors = [
      [0.95, 0.2, 0.2],
      [0.2, 0.5, 0.95],
      [1, 0.82, 0.12],
      [0.2, 0.8, 0.4],
      [0.95, 0.95, 0.95],
    ] as const;
    for (let i = 0; i < count; i++) {
      const [r, g, b] = colors[i % colors.length] as readonly [number, number, number];
      this.soft.spawn({
        x: x + jitter(2.6),
        y: y + 3.2 + Math.random() * 1.5,
        z: z + jitter(1.4),
        vx: jitter(0.8),
        vy: -0.4 - Math.random() * 0.6,
        vz: jitter(0.8),
        life: 3.5 + Math.random() * 1.5,
        size: 0.07,
        endSize: 0.07,
        r,
        g,
        b,
        alpha: 1,
        gravity: -0.6,
        drag: 0.6,
      });
    }
  }

  clear(): void {
    this.soft.clear();
    this.sparks.clear();
  }
}
