import { describe, expect, it } from 'vitest';
import {
  KART_PARTS,
  KART_WHEEL_PARTS,
  MAX_KARTS,
  NET_TICK_HZ,
  RACE_LAPS,
  SIM_DT,
  SIM_HZ,
} from './index.js';

describe('constantes da corrida', () => {
  it('corrida tem 9 karts e 3 voltas', () => {
    expect(MAX_KARTS).toBe(9);
    expect(RACE_LAPS).toBe(3);
  });

  it('simulação roda a um múltiplo inteiro do tick de rede', () => {
    expect(SIM_HZ % NET_TICK_HZ).toBe(0);
    expect(SIM_DT).toBeCloseTo(1 / 60, 10);
  });

  it('o kart tem quatro rodas com nomes únicos', () => {
    expect(new Set(KART_WHEEL_PARTS).size).toBe(4);
    expect(KART_WHEEL_PARTS).not.toContain(KART_PARTS.body);
  });
});
