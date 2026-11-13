import { describe, expect, it } from 'vitest';
import { COSMETIC_ITEMS } from './accounts.js';
import {
  botMu,
  botSkillFor,
  LEVEL_REWARDS,
  levelView,
  MAX_LEVEL,
  raceXp,
  rewardsBetween,
  totalXp,
  xpForLevel,
  xpToNext,
} from './progression.js';

const race = {
  mode: 'casual' as const,
  position: 1,
  karts: 9,
  humans: 1,
  finished: true,
  abandoned: false,
  penaltyTicks: 0,
  personalBest: false,
};

describe('níveis', () => {
  it('nível 1 começa em 0 XP e cada nível pede um pouco mais', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(300);
    expect(xpForLevel(3)).toBe(300 + 360);
    expect(xpToNext(10)).toBeGreaterThan(xpToNext(9));
  });

  it('levelView acha o nível e o progresso dentro dele', () => {
    expect(levelView(0)).toMatchObject({ level: 1, into: 0, needed: 300, title: 'Novato' });
    expect(levelView(299).level).toBe(1);
    expect(levelView(300)).toMatchObject({ level: 2, into: 0, needed: 360 });
    expect(levelView(700)).toMatchObject({ level: 3, into: 40 });
  });

  it('o XP total de cada nível é coerente com o custo dos níveis', () => {
    for (let level = 1; level < 30; level++) {
      expect(xpForLevel(level + 1) - xpForLevel(level)).toBe(xpToNext(level));
    }
  });

  it('para no nível máximo', () => {
    const view = levelView(xpForLevel(MAX_LEVEL) + 1_000_000);
    expect(view).toMatchObject({ level: MAX_LEVEL, into: 0, needed: 0, title: 'Lenda' });
  });
});

describe('XP da corrida', () => {
  it('vencer rende mais do que chegar em último', () => {
    const win = totalXp(raceXp(race));
    const last = totalXp(raceXp({ ...race, position: 9 }));
    expect(win).toBeGreaterThan(last);
    expect(last).toBeGreaterThan(0);
  });

  it('o Ranqueado rende mais e a sala privada menos', () => {
    const casual = totalXp(raceXp({ ...race, humans: 4 }));
    expect(totalXp(raceXp({ ...race, humans: 4, mode: 'ranked' }))).toBeGreaterThan(casual);
    expect(totalXp(raceXp({ ...race, humans: 4, mode: 'private' }))).toBeLessThan(casual);
  });

  it('sozinho em sala privada não rende nada', () => {
    expect(raceXp({ ...race, mode: 'private', humans: 1 })).toEqual([]);
  });

  it('abandonar rende quase nada, e punição tira o bônus de corrida limpa', () => {
    expect(totalXp(raceXp({ ...race, abandoned: true, finished: false }))).toBe(10);
    const labels = raceXp({ ...race, penaltyTicks: 180 }).map((line) => line.label);
    expect(labels).not.toContain('Corrida limpa');
  });
});

describe('recompensas e bots', () => {
  it('toda recompensa é um item do catálogo que não vem com a conta', () => {
    for (const id of Object.keys(LEVEL_REWARDS)) {
      const item = COSMETIC_ITEMS.find((entry) => entry.id === id);
      expect(item, id).toBeDefined();
      expect(item?.starter).toBe(false);
    }
    const locked = COSMETIC_ITEMS.filter((item) => !item.starter).map((item) => item.id);
    expect(Object.keys(LEVEL_REWARDS).sort()).toEqual(locked.sort());
  });

  it('entrega os itens dos níveis atravessados, em ordem', () => {
    expect(rewardsBetween(1, 2)).toEqual([]);
    expect(rewardsBetween(2, 5)).toEqual(['livery:amarelo', 'trail:azul']);
    expect(rewardsBetween(5, 5)).toEqual([]);
  });

  it('bots acompanham a habilidade do grupo, dentro dos limites', () => {
    expect(botSkillFor(5)).toBe(0.05);
    expect(botSkillFor(50)).toBe(1);
    expect(botSkillFor(25)).toBeCloseTo(0.5, 2);
    expect(botMu(botSkillFor(25))).toBeCloseTo(25, 6);
  });
});
