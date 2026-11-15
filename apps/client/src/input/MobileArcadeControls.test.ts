import { describe, expect, it } from 'vitest';
import { MOBILE_STEER_ATTACK_RATE, MOBILE_STEER_RELEASE_RATE } from '../settings';
import { arrowAt, rampSteer } from './MobileArcadeControls';

const rect = (left: number, width: number): DOMRectReadOnly =>
  ({
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 80,
    height: 80,
    x: left,
    y: 0,
  }) as DOMRectReadOnly;

/** Roda a rampa em passos de 1/60 s até `seconds`. */
function run(from: number, target: number, seconds: number): number {
  let value = from;
  const dt = 1 / 60;
  for (let t = 0; t < seconds - 1e-9; t += dt) value = rampSteer(value, target, dt);
  return value;
}

describe('rampa da direção das setas', () => {
  it('chega ao esterço total entre 110 e 140 ms', () => {
    const full = 1 / MOBILE_STEER_ATTACK_RATE;
    expect(full).toBeGreaterThanOrEqual(0.11);
    expect(full).toBeLessThanOrEqual(0.14);
    expect(run(0, 1, 0.06)).toBeGreaterThan(0.3);
    expect(run(0, 1, 0.06)).toBeLessThan(1);
    expect(run(0, 1, 0.15)).toBe(1);
    expect(run(0, -1, 0.15)).toBe(-1);
  });

  it('volta ao centro em cerca de 80 ms', () => {
    expect(1 / MOBILE_STEER_RELEASE_RATE).toBeCloseTo(0.08, 3);
    expect(run(1, 0, 0.04)).toBeGreaterThan(0);
    expect(run(1, 0, 0.1)).toBe(0);
  });

  it('trocar de lado passa pelo centro no retorno e segue no ataque', () => {
    const halfway = run(1, -1, 0.05);
    expect(halfway).toBeGreaterThan(0);
    expect(run(1, -1, 0.3)).toBe(-1);
  });

  it('nunca passa de ±1 e ignora passo inválido', () => {
    expect(rampSteer(0.99, 1, 1)).toBe(1);
    expect(rampSteer(0.5, 1, 0)).toBe(0.5);
    expect(rampSteer(0.5, 1, Number.NaN)).toBe(0.5);
  });
});

describe('deslizar entre as setas', () => {
  const left = rect(20, 80);
  const right = rect(120, 80);

  it('em cima de cada seta vale ela (esquerda é +1 na simulação)', () => {
    expect(arrowAt(60, left, right)).toBe(1);
    expect(arrowAt(160, left, right)).toBe(-1);
  });

  it('no vão entre as duas vale a mais próxima, sem zona morta', () => {
    expect(arrowAt(105, left, right)).toBe(1);
    expect(arrowAt(115, left, right)).toBe(-1);
  });

  it('dedo escorregou para fora do grupo: continua a seta do lado', () => {
    expect(arrowAt(-30, left, right)).toBe(1);
    expect(arrowAt(400, left, right)).toBe(-1);
  });
});
