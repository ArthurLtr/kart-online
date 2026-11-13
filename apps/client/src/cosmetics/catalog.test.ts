import { describe, expect, it } from 'vitest';
import { MAX_KARTS } from '@kart/shared';
import { CATALOG, DEFAULT_LOADOUT, findDesign, sampleLoadout, SLOT_LABELS } from './catalog';
import type { Loadout } from './catalog';

const slots = Object.keys(CATALOG) as (keyof Loadout)[];

describe('catálogo de cosméticos de teste', () => {
  it('todo slot tem rótulo, itens e ids únicos', () => {
    for (const slot of slots) {
      expect(SLOT_LABELS[slot]).toBeTruthy();
      const ids = CATALOG[slot].map((item) => item.id);
      expect(ids.length).toBeGreaterThanOrEqual(2);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('o loadout padrão só usa itens que existem', () => {
    for (const slot of slots) {
      expect(CATALOG[slot].some((item) => item.id === DEFAULT_LOADOUT[slot])).toBe(true);
    }
  });

  it('um id desconhecido cai no primeiro item do slot', () => {
    expect(findDesign('suit', 'nao-existe')).toBe(CATALOG.suit[0]);
  });

  it('os karts do grid recebem loadouts válidos e variados', () => {
    const loadouts = Array.from({ length: MAX_KARTS }, (_, i) => sampleLoadout(i));
    for (const loadout of loadouts) {
      for (const slot of slots) {
        expect(CATALOG[slot].some((item) => item.id === loadout[slot])).toBe(true);
      }
    }
    expect(new Set(loadouts.map((l) => l.livery)).size).toBeGreaterThan(2);
    expect(new Set(loadouts.map((l) => l.suit)).size).toBeGreaterThan(2);
  });
});
