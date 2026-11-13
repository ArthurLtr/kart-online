import { TUNING as T } from './tuning.js';
import type { KartState } from './types.js';

interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** Eixo da cápsula de colisão: do centro do eixo traseiro para a frente. */
function capsuleOf(k: KartState): Segment {
  const fx = Math.sin(k.heading);
  const fz = Math.cos(k.heading);
  // O pivô do kart fica no eixo traseiro; o centro da cápsula fica ~0,55 m à frente.
  const cx = k.x + fx * 0.55;
  const cz = k.z + fz * 0.55;
  return {
    ax: cx - fx * T.capsuleHalfLength,
    az: cz - fz * T.capsuleHalfLength,
    bx: cx + fx * T.capsuleHalfLength,
    bz: cz + fz * T.capsuleHalfLength,
  };
}

/** Pontos mais próximos entre dois segmentos no plano. */
function closestPoints(p: Segment, q: Segment): { px: number; pz: number; qx: number; qz: number } {
  const d1x = p.bx - p.ax;
  const d1z = p.bz - p.az;
  const d2x = q.bx - q.ax;
  const d2z = q.bz - q.az;
  const rx = p.ax - q.ax;
  const rz = p.az - q.az;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  const c = d1x * rx + d1z * rz;
  const b = d1x * d2x + d1z * d2z;
  const denominator = a * e - b * b;
  let s = denominator > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denominator)) : 0.5;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = Math.min(1, Math.max(0, -c / a));
  } else if (t > 1) {
    t = 1;
    s = Math.min(1, Math.max(0, (b - c) / a));
  }
  return {
    px: p.ax + d1x * s,
    pz: p.az + d1z * s,
    qx: q.ax + d2x * t,
    qz: q.az + d2z * t,
  };
}

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

/**
 * Colisão kart-kart com cápsulas: separa os karts sobrepostos e troca
 * velocidade ao longo da normal do contato, com elasticidade baixa e impulso
 * limitado (um toque não arremessa ninguém). Devolve um novo array; os
 * estados recebidos não são alterados. A ordem de resolução é fixa (i < j),
 * então o resultado é determinístico.
 */
export function resolveKartCollisions(karts: readonly KartState[]): KartState[] {
  const result = karts.map((kart) => ({ ...kart }));
  const reach = T.capsuleRadius * 2;
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i] as KartState;
      const b = result[j] as KartState;
      if (Math.hypot(a.x - b.x, a.z - b.z) > reach + T.capsuleHalfLength * 2 + 1.2) continue;

      const points = closestPoints(capsuleOf(a), capsuleOf(b));
      let nx = points.qx - points.px;
      let nz = points.qz - points.pz;
      const distance = Math.hypot(nx, nz);
      if (distance >= reach) continue;
      if (distance < 1e-6) {
        // Exatamente sobrepostos: separa numa direção fixa.
        nx = 1;
        nz = 0;
      } else {
        nx /= distance;
        nz /= distance;
      }

      // Cada um recua metade da sobreposição.
      const push = (reach - distance) / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;

      const va = worldVelocity(a);
      const vb = worldVelocity(b);
      const closing = (va.x - vb.x) * nx + (va.z - vb.z) * nz;
      if (closing <= 0) continue; // já estão se afastando
      // Massas iguais: cada um recebe metade da troca, limitada.
      const change = Math.min(T.kartMaxImpulseSpeed, (closing * (1 + T.kartRestitution)) / 2);
      setWorldVelocity(a, va.x - nx * change, va.z - nz * change);
      setWorldVelocity(b, vb.x + nx * change, vb.z + nz * change);
      a.impact = Math.max(a.impact, closing);
      b.impact = Math.max(b.impact, closing);
    }
  }
  return result;
}
