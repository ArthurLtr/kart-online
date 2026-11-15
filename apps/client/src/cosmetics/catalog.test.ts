import { describe, expect, it } from 'vitest';
import { MAX_KARTS } from '@kart/shared';
import { catalogItem, SEASON_1_CATALOG } from '@kart/shared';
import {
  byRarity,
  CATALOG,
  DEFAULT_LOADOUT,
  findDesign,
  helmetMesh,
  isSeason1,
  sampleLoadout,
  SLOT_LABELS,
} from './catalog';
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

describe('Temporada 1 no cliente', () => {
  it('todo item da temporada tem visual no slot certo, com selo', () => {
    for (const entry of SEASON_1_CATALOG) {
      const slot = entry.slot as keyof typeof CATALOG;
      const design = (CATALOG[slot] as readonly { id: string; season?: number }[]).find(
        (item) => item.id === entry.id,
      );
      expect(design, entry.id).toBeDefined();
      expect(design?.season, entry.id).toBe(1);
      expect(isSeason1(slot, entry.id)).toBe(true);
    }
    expect(isSeason1('livery', 'azul')).toBe(false);
  });

  it('capacetes da temporada vêm completos e com malha de reserva', () => {
    for (const id of [
      'helm_classic_red',
      'helm_carbon_aero',
      'helm_cyber_shark',
      'helm_dragon_gold',
    ]) {
      const helmet = findDesign('helmetModel', id);
      expect(helmet.look, id).toBeDefined();
      expect(helmet.glb).toBe(`/assets/cosmetics/s1/${id}.glb`);
      expect(['integral', 'aero']).toContain(helmetMesh(id));
    }
    expect(helmetMesh('nao_existe')).toBe('integral');
  });

  it('ordem crescente de raridade em cada aba', () => {
    const order = ['common', 'rare', 'epic', 'legendary', 'exclusive'];
    for (const slot of ['livery', 'rim', 'helmetModel', 'suit', 'trail'] as const) {
      const items = CATALOG[slot] as readonly { id: string }[];
      const ranks = byRarity(slot, items).map((item) =>
        order.indexOf(catalogItem(`${slot}:${item.id}`)?.rarity ?? 'common'),
      );
      expect(ranks, slot).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('conta nova começa com o kit da temporada', () => {
    expect(DEFAULT_LOADOUT).toMatchObject({
      helmetModel: 'helm_classic_red',
      rim: 'wheel_slick_5spoke',
      livery: 'kart_rookie_red',
      suit: 'suit_classic_red',
      trail: 'trail_white_smoke',
    });
  });
});
