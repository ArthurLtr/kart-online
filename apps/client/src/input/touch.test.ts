import { describe, expect, it } from 'vitest';
import { dragSteer, STEER_DEADZONE, STEER_RADIUS, touchPedals } from './touch';

describe('direção por arrasto', () => {
  it('centro e zona morta não viram', () => {
    expect(dragSteer(0)).toBe(0);
    expect(dragSteer(STEER_RADIUS * STEER_DEADZONE)).toBe(0);
    expect(dragSteer(-STEER_RADIUS * STEER_DEADZONE * 0.5)).toBe(0);
  });

  it('dedo para a direita vira à direita (negativo na simulação) e vice-versa', () => {
    expect(dragSteer(STEER_RADIUS)).toBe(-1);
    expect(dragSteer(-STEER_RADIUS)).toBe(1);
    expect(dragSteer(STEER_RADIUS / 2)).toBeLessThan(0);
    expect(dragSteer(-STEER_RADIUS / 2)).toBeGreaterThan(0);
  });

  it('passa do raio: fica no máximo', () => {
    expect(dragSteer(STEER_RADIUS * 3)).toBe(-1);
    expect(dragSteer(-STEER_RADIUS * 3)).toBe(1);
  });

  it('sem salto ao sair da zona morta', () => {
    const justOut = dragSteer(STEER_RADIUS * (STEER_DEADZONE + 0.01));
    expect(Math.abs(justOut)).toBeLessThan(0.02);
  });

  it('valor inválido não vira', () => {
    expect(dragSteer(Number.NaN)).toBe(0);
    expect(dragSteer(10, 0)).toBe(0);
  });
});

describe('pedais no toque', () => {
  it('aceleração automática: acelera sozinho e o freio corta', () => {
    expect(touchPedals({ throttle: false, brake: false }, true)).toEqual({ throttle: 1, brake: 0 });
    expect(touchPedals({ throttle: false, brake: true }, true)).toEqual({ throttle: 0, brake: 1 });
  });

  it('acelerador manual: só acelera segurando', () => {
    expect(touchPedals({ throttle: false, brake: false }, false)).toEqual({
      throttle: 0,
      brake: 0,
    });
    expect(touchPedals({ throttle: true, brake: false }, false)).toEqual({ throttle: 1, brake: 0 });
    expect(touchPedals({ throttle: true, brake: true }, false)).toEqual({ throttle: 1, brake: 1 });
  });
});
