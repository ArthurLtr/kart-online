import { kartContact, kartPose } from './physics.js';
import type { Pose } from './physics.js';
import { TUNING as T } from './tuning.js';
import type { KartState } from './types.js';

function worldVelocity(k: KartState): { x: number; z: number } {
  const sinH = Math.sin(k.heading);
  const cosH = Math.cos(k.heading);
  return { x: k.vx * sinH + k.vy * cosH, z: k.vx * cosH - k.vy * sinH };
}

function setWorldVelocity(k: KartState, x: number, z: number): void {
  const sinH = Math.sin(k.heading);
  const cosH = Math.cos(k.heading);
  k.vx = x * sinH + z * cosH;
  k.vy = x * cosH - z * sinH;
}

/** Distância entre centros a partir da qual dois karts não têm como se tocar. */
const REACH = 2 * Math.hypot(T.bodyHalfLength, T.bodyHalfWidth);

/**
 * Colisão kart-kart. O Rapier dá o contato entre os contornos dos dois karts
 * (ponto, normal, sobreposição); aqui eles são separados e trocam velocidade
 * ao longo da normal, com elasticidade baixa e troca limitada (um toque não
 * arremessa ninguém). Toque fora do centro também gira os karts: bater na
 * traseira de quem está de lado faz ele rodar.
 *
 * Devolve um novo array; os estados recebidos não são alterados. A ordem de
 * resolução é fixa (i < j), então o resultado é determinístico.
 */
export function resolveKartCollisions(karts: readonly KartState[]): KartState[] {
  const result = karts.map((kart) => ({ ...kart }));
  const poses: Pose[] = result.map(kartPose);
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i] as KartState;
      const b = result[j] as KartState;
      const poseA = poses[i] as Pose;
      const poseB = poses[j] as Pose;
      if (Math.hypot(poseA.x - poseB.x, poseA.y - poseB.y) > REACH) continue;

      const contact = kartContact(poseA, poseB);
      if (!contact) continue;
      const { nx, nz, depth, px, pz } = contact;

      // Cada um recua metade da sobreposição.
      const push = depth / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      poseA.x -= nx * push;
      poseA.y -= nz * push;
      poseB.x += nx * push;
      poseB.y += nz * push;

      // Braço de cada kart até o ponto do contato, e a velocidade desse ponto.
      const rax = px - poseA.x;
      const raz = pz - poseA.y;
      const rbx = px - poseB.x;
      const rbz = pz - poseB.y;
      const va = worldVelocity(a);
      const vb = worldVelocity(b);
      const closing =
        (va.x + a.yawRate * raz - vb.x - b.yawRate * rbz) * nx +
        (va.z - a.yawRate * rax - vb.z + b.yawRate * rbx) * nz;
      if (closing <= 0) continue; // já estão se afastando

      // Impulso com massas iguais e a inércia de guinada de cada um.
      const leverA = raz * nx - rax * nz;
      const leverB = rbz * nx - rbx * nz;
      const inverseMass = 2 / T.mass + (leverA * leverA + leverB * leverB) / T.collisionYawInertia;
      const impulse = Math.min(
        (closing * (1 + T.kartRestitution)) / inverseMass,
        T.kartMaxImpulseSpeed * T.mass,
      );
      const change = impulse / T.mass;
      setWorldVelocity(a, va.x - nx * change, va.z - nz * change);
      setWorldVelocity(b, vb.x + nx * change, vb.z + nz * change);
      const spin = (impulse / T.collisionYawInertia) * T.kartSpin;
      a.yawRate -= leverA * spin;
      b.yawRate += leverB * spin;
      a.impact = Math.max(a.impact, closing);
      b.impact = Math.max(b.impact, closing);
    }
  }
  return result;
}
