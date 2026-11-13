/** Ponto de controle do traçado, no plano do chão (X, Z), em metros. */
export interface ControlPoint {
  x: number;
  z: number;
  /** Inclinação lateral (banking) em graus; positivo = curva à direita inclinada. */
  bank?: number;
}

export interface DensePoint {
  x: number;
  z: number;
  bank: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => t * t * (3 - 2 * t);

function knot(a: ControlPoint, b: ControlPoint): number {
  // Parametrização centrípeta (alfa = 0,5): evita laços e ultrapassagens.
  return Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z));
}

function centripetal(
  p0: ControlPoint,
  p1: ControlPoint,
  p2: ControlPoint,
  p3: ControlPoint,
  u: number,
): { x: number; z: number } {
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = lerp(t1, t2, u);
  const mix = (
    a: { x: number; z: number },
    b: { x: number; z: number },
    ta: number,
    tb: number,
  ): { x: number; z: number } => {
    const k = (t - ta) / (tb - ta);
    return { x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k) };
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

/**
 * Amostra densamente um spline Catmull-Rom centrípeto fechado que passa por
 * todos os pontos de controle. `density` = amostras por metro (aproximado).
 */
export function sampleClosedSpline(points: readonly ControlPoint[], density = 4): DensePoint[] {
  const n = points.length;
  if (n < 4) throw new Error('o traçado precisa de pelo menos 4 pontos de controle');
  const at = (i: number): ControlPoint => points[((i % n) + n) % n] as ControlPoint;

  const dense: DensePoint[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const steps = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) * density));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const { x, z } = centripetal(p0, p1, p2, p3, u);
      dense.push({ x, z, bank: lerp(p1.bank ?? 0, p2.bank ?? 0, smooth(u)) });
    }
  }
  return dense;
}

/**
 * Reamostra um polígono fechado em passos iguais de comprimento de arco,
 * começando no vértice mais próximo de `start`.
 */
export function resampleClosed(
  dense: readonly DensePoint[],
  start: { x: number; z: number },
  targetStep = 1,
): { points: DensePoint[]; length: number; step: number } {
  const n = dense.length;
  let first = 0;
  let best = Infinity;
  dense.forEach((p, i) => {
    const d = (p.x - start.x) ** 2 + (p.z - start.z) ** 2;
    if (d < best) {
      best = d;
      first = i;
    }
  });
  const at = (i: number): DensePoint => dense[(first + i) % n] as DensePoint;

  const cumulative = [0];
  for (let i = 0; i < n; i++) {
    const a = at(i);
    const b = at(i + 1);
    cumulative.push((cumulative[i] as number) + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const length = cumulative[n] as number;
  const count = Math.round(length / targetStep);
  const step = length / count;

  const points: DensePoint[] = [];
  let segment = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while ((cumulative[segment + 1] as number) < target) segment++;
    const from = cumulative[segment] as number;
    const to = cumulative[segment + 1] as number;
    const k = to > from ? (target - from) / (to - from) : 0;
    const a = at(segment);
    const b = at(segment + 1);
    points.push({ x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k), bank: lerp(a.bank, b.bank, k) });
  }
  return { points, length, step };
}
