import { describe, expect, it } from 'vitest';
import {
  BASE_STICKERS,
  buyBlock,
  CATALOG_ITEMS,
  catalogItem,
  DEFAULT_ITEM_IDS,
  filterOwnedCosmetics,
  formatBrl,
  GEM_PACKAGES,
  LOADOUT_SLOTS,
  missingItems,
  paintRequirements,
  presetLimit,
  PRESET_SLOTS_ITEM,
  stickerLimit,
  STICKER_SLOTS_ITEM,
} from './catalog.js';

describe('catálogo: raridades e preços', () => {
  it('ids únicos e no formato slot:chave', () => {
    expect(new Set(CATALOG_ITEMS.map((item) => item.id)).size).toBe(CATALOG_ITEMS.length);
    for (const item of CATALOG_ITEMS) expect(item.id).toBe(`${item.slot}:${item.key}`);
  });

  it('item básico não tem preço; todo o resto é vendido em alguma moeda', () => {
    for (const item of CATALOG_ITEMS) {
      if (item.isDefault) {
        expect([item.priceCoins, item.priceGems], item.id).toEqual([null, null]);
        expect(item.rarity, item.id).toBe('common');
      } else {
        expect(item.priceCoins !== null || item.priceGems !== null, item.id).toBe(true);
      }
    }
  });

  it('cada raridade aceita só as moedas da regra', () => {
    for (const item of CATALOG_ITEMS.filter((entry) => !entry.isDefault)) {
      if (item.rarity === 'common' || item.rarity === 'rare') {
        expect(item.priceCoins, item.id).not.toBeNull();
        expect(item.priceGems, item.id).toBeNull();
      } else if (item.rarity === 'epic') {
        expect(item.priceCoins, item.id).not.toBeNull();
        expect(item.priceGems, item.id).not.toBeNull();
      } else {
        expect(item.priceCoins, item.id).toBeNull();
        expect(item.priceGems, item.id).not.toBeNull();
      }
    }
  });

  it('todo slot do visual tem pelo menos um item básico para o kart inicial', () => {
    for (const slot of LOADOUT_SLOTS) {
      expect(
        CATALOG_ITEMS.some((item) => item.slot === slot && item.isDefault),
        slot,
      ).toBe(true);
    }
    expect(DEFAULT_ITEM_IDS).toContain('finish:gloss');
    expect(DEFAULT_ITEM_IDS).toContain('pattern:solid');
  });

  it('pacotes de gemas: quanto maior, melhor o preço por gema', () => {
    const rates = GEM_PACKAGES.map((entry) => entry.amountCents / entry.gems);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeLessThan(rates[i - 1]!);
    expect(formatBrl(2490)).toBe('R$ 24,90');
  });
});

describe('compra', () => {
  const epic = catalogItem('visor:dourada')!;
  const legendary = catalogItem('helmetModel:aero')!;
  const gated = catalogItem('livery:verde')!;

  it('épico aceita moedas ou gemas; lendário só gemas', () => {
    expect(buyBlock(epic.id, 'coins', 1, epic.priceCoins!, [])).toBeNull();
    expect(buyBlock(epic.id, 'gems', 1, epic.priceGems!, [])).toBeNull();
    expect(buyBlock(legendary.id, 'coins', 99, 999_999, [])).toBe('currency');
    expect(buyBlock(legendary.id, 'gems', 1, legendary.priceGems!, [])).toBeNull();
  });

  it('recusa sem saldo, sem nível (nas moedas), repetido ou inexistente', () => {
    expect(buyBlock(epic.id, 'coins', 1, epic.priceCoins! - 1, [])).toBe('balance');
    expect(buyBlock(gated.id, 'coins', gated.unlockLevel - 1, 999_999, [])).toBe('level');
    expect(buyBlock(epic.id, 'gems', 1, 999, new Set([epic.id]))).toBe('owned');
    expect(buyBlock('livery:nao-existe', 'coins', 99, 999_999, [])).toBe('unknown');
    expect(buyBlock('livery:azul', 'coins', 99, 999_999, [])).toBe('currency');
  });
});

describe('posse', () => {
  const owned = new Set(DEFAULT_ITEM_IDS);

  it('tira do visual o que o jogador não possui e o que não existe', () => {
    const wanted = { livery: 'vermelho', visor: 'dourada', rim: 'inventado' };
    expect(filterOwnedCosmetics(wanted, owned)).toEqual({ livery: 'vermelho' });
  });

  it('a pintura livre exige acabamentos, padrão e adesivos usados', () => {
    const paint = {
      zones: {
        fairing: { color: '#f00', finish: 'chrome' },
        seat: { color: '#000', finish: 'gloss' },
      },
      pattern: { type: 'stripes' },
      wheels: { color: null, finish: 'metallic' },
      stickers: [{ shape: 'flame' }, { shape: 'number' }],
    };
    expect(paintRequirements(paint).sort()).toEqual(
      [
        'finish:chrome',
        'finish:gloss',
        'pattern:stripes',
        'sticker:flame',
        'sticker:number',
      ].sort(),
    );
    expect(missingItems({}, paint, owned).sort()).toEqual(
      ['finish:chrome', 'pattern:stripes', 'sticker:flame'].sort(),
    );
    expect(paintRequirements(null)).toEqual([]);
  });

  it('acabamento do aro só conta com cor livre no aro', () => {
    const wheels = (color: string | null) =>
      paintRequirements({ wheels: { color, finish: 'metallic' } });
    expect(wheels(null)).toEqual([]);
    expect(wheels('#fff')).toEqual(['finish:metallic']);
  });

  it('com pintura livre, a pintura pronta por baixo não é exigida', () => {
    const paint = { pattern: { type: 'solid' } };
    expect(missingItems({ livery: 'verde' }, paint, owned)).toEqual([]);
    expect(missingItems({ livery: 'verde' }, null, owned)).toEqual(['livery:verde']);
  });

  it('espaços extras aumentam os limites', () => {
    expect(presetLimit(owned)).toBe(3);
    expect(presetLimit([PRESET_SLOTS_ITEM])).toBe(6);
    expect(stickerLimit(owned)).toBe(BASE_STICKERS);
    const five = { stickers: Array.from({ length: 5 }, () => ({ shape: 'number' })) };
    expect(paintRequirements(five)).toContain(STICKER_SLOTS_ITEM);
  });
});
