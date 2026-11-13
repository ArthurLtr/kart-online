import RAPIER from '@dimforge/rapier2d-compat';
import type { Track } from '../track/track.js';
import { TUNING as T } from './tuning.js';

/**
 * Colisão com o Rapier (motor de física em WASM).
 *
 * A dinâmica do kart continua sendo a nossa (step.ts): o Rapier cuida da
 * geometria — a forma do kart, as paredes da pista, quem encosta em quem, em
 * que ponto, com que normal e com quanta sobreposição. A simulação é plana:
 * o plano XZ do jogo vira o plano XY do Rapier 2D.
 *
 * Tudo aqui é determinístico: o mesmo binário WASM roda no cliente e no
 * servidor, as consultas não guardam estado entre ticks e a ordem de
 * resolução é fixa.
 */

let ready = false;
let starting: Promise<void> | null = null;

/**
 * Carrega o WASM do Rapier. Chame (e espere) uma vez antes de criar o ambiente
 * de uma pista ou resolver colisões: no servidor ao subir, no cliente antes da
 * primeira tela, nos testes pelo arquivo de setup.
 */
export function initPhysics(): Promise<void> {
  starting ??= RAPIER.init().then(() => {
    ready = true;
  });
  return starting;
}

export const physicsReady = (): boolean => ready;

function requireReady(): void {
  if (!ready) throw new Error('Física não iniciada: chame e espere initPhysics() antes.');
}

/** Pose de um corpo no plano: posição do centro da forma e ângulo do Rapier. */
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

/** Onde fica a forma de colisão de um kart (o pivô do estado é o eixo traseiro). */
export function kartPose(kart: { x: number; z: number; heading: number }): Pose {
  const fx = Math.sin(kart.heading);
  const fz = Math.cos(kart.heading);
  return {
    x: kart.x + fx * T.bodyCenter,
    y: kart.z + fz * T.bodyCenter,
    // O eixo X local da forma aponta para a frente do kart.
    angle: Math.PI / 2 - kart.heading,
  };
}

let shape: RAPIER.Shape | null = null;

/** Retângulo de cantos arredondados com o contorno do kart visto de cima. */
export function kartShape(): RAPIER.Shape {
  requireReady();
  shape ??= new RAPIER.RoundCuboid(
    T.bodyHalfLength - T.bodyCorner,
    T.bodyHalfWidth - T.bodyCorner,
    T.bodyCorner,
  );
  return shape;
}

/** Um contato: normal unitária (no plano XZ), sobreposição e ponto, em metros. */
export interface Contact {
  /** Direção em que o segundo corpo (ou o kart, numa parede) deve ser afastado. */
  nx: number;
  nz: number;
  /** Sobreposição, > 0. */
  depth: number;
  /** Ponto do contato. */
  px: number;
  pz: number;
}

const scratch: Contact = { nx: 0, nz: 0, depth: 0, px: 0, pz: 0 };

/**
 * Contato entre dois karts, ou `null` se não se tocam. A normal aponta de `a`
 * para `b`. O objeto devolvido é reutilizado: copie o que precisar guardar.
 */
export function kartContact(a: Pose, b: Pose): Contact | null {
  const hit = kartShape().contactShape(a, a.angle, kartShape(), b, b.angle, 0);
  if (!hit || hit.distance >= 0) return null;
  const length = Math.hypot(hit.normal1.x, hit.normal1.y);
  if (length < 1e-9) return null;
  scratch.nx = hit.normal1.x / length;
  scratch.nz = hit.normal1.y / length;
  scratch.depth = -hit.distance;
  scratch.px = (hit.point1.x + hit.point2.x) / 2;
  scratch.pz = (hit.point1.y + hit.point2.y) / 2;
  return scratch;
}

/** Guard-rails de uma pista como colisores estáticos num mundo do Rapier. */
export class TrackWalls {
  private readonly world: RAPIER.World;

  constructor(track: Track) {
    requireReady();
    this.world = new RAPIER.World({ x: 0, y: 0 });
    const count = track.samples.length;
    for (const side of [-1, 1] as const) {
      const offsets = side === 1 ? track.barrierRight : track.barrierLeft;
      const point = (index: number): { x: number; y: number } => {
        const sample = track.samples[index]!;
        const offset = (offsets[index] as number) * side;
        return { x: sample.x + sample.rx * offset, y: sample.z + sample.rz * offset };
      };
      let previous = point(0);
      for (let i = 1; i <= count; i++) {
        const next = point(i % count);
        if (Math.hypot(next.x - previous.x, next.y - previous.y) > 1e-4) {
          this.world.createCollider(RAPIER.ColliderDesc.segment(previous, next));
        }
        previous = next;
      }
    }
    // Um passo (sem corpos dinâmicos) só para montar a estrutura de consulta.
    this.world.step();
  }

  /**
   * Parede em que o kart mais afunda, ou `null`. A normal aponta da parede para
   * o kart. `inwardX/Z` é a direção do centro da pista: contato que empurraria
   * para fora (kart que já passou do trilho) é ignorado. O objeto devolvido é
   * reutilizado.
   */
  deepest(pose: Pose, inwardX: number, inwardZ: number): Contact | null {
    const body = kartShape();
    let found = false;
    scratch.depth = 0;
    this.world.intersectionsWithShape(pose, pose.angle, body, (collider) => {
      const hit = collider.contactShape(body, pose, pose.angle, 0);
      if (!hit || hit.distance >= 0) return true;
      let nx = hit.normal1.x;
      let nz = hit.normal1.y;
      const length = Math.hypot(nx, nz);
      if (length < 1e-9) return true;
      nx /= length;
      nz /= length;
      // Um segmento não tem lado de dentro: a normal vale se aponta para a pista.
      if (nx * inwardX + nz * inwardZ <= 0.05) return true;
      if (-hit.distance > scratch.depth) {
        found = true;
        scratch.nx = nx;
        scratch.nz = nz;
        scratch.depth = -hit.distance;
        scratch.px = hit.point1.x;
        scratch.pz = hit.point1.y;
      }
      return true;
    });
    return found ? scratch : null;
  }

  free(): void {
    this.world.free();
  }
}

const wallsByTrack = new WeakMap<Track, TrackWalls>();

/** Paredes de uma pista (criadas uma vez por pista). */
export function trackWalls(track: Track): TrackWalls {
  let walls = wallsByTrack.get(track);
  if (!walls) {
    walls = new TrackWalls(track);
    wallsByTrack.set(track, walls);
  }
  return walls;
}
