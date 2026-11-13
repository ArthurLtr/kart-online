import { describe, expect, it } from 'vitest';
import { MAX_PRESETS, sanitizePresets } from './accounts.js';
import { MAX_PAINT_CHARS, sanitizeCustomPaint } from './protocol.js';

describe('pintura livre vinda da rede', () => {
  it('mantém uma pintura comum como veio', () => {
    const paint = {
      zones: { fairing: { color: '#ff0000', finish: 'gloss' } },
      stickers: [{ shape: 'star', x: 0.5, mirror: true }],
      number: '27',
    };
    expect(sanitizeCustomPaint(paint)).toEqual(paint);
  });

  it('recusa o que não é objeto', () => {
    expect(sanitizeCustomPaint(null)).toBeNull();
    expect(sanitizeCustomPaint('azul')).toBeNull();
    expect(sanitizeCustomPaint([1, 2])).toBeNull();
  });

  it('descarta textos longos, números inválidos, chaves estranhas e níveis demais', () => {
    const clean = sanitizeCustomPaint({
      ok: 1,
      long: 'x'.repeat(33),
      nan: Number.NaN,
      'chave com espaço': 1,
      a: { b: { c: { d: { e: 1 } } } },
    });
    expect(clean).toEqual({ ok: 1, a: { b: { c: {} } } });
  });

  it('recusa pintura maior que o limite', () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 16; i++) {
      big[`k${i}`] = Array.from({ length: 16 }, () => 'x'.repeat(32));
    }
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_PAINT_CHARS);
    expect(sanitizeCustomPaint(big)).toBeNull();
  });
});

describe('presets', () => {
  it('limita a quantidade e limpa o nome', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      name: `<b>Visual ${i}</b>`,
      loadout: {},
    }));
    const presets = sanitizePresets(many);
    expect(presets).toHaveLength(MAX_PRESETS);
    expect(presets[0]).toEqual({ name: 'bVisual 0b', loadout: {}, paint: null });
  });

  it('ignora entradas que não são objeto', () => {
    expect(sanitizePresets('x')).toEqual([]);
    expect(sanitizePresets([1, null])).toEqual([]);
  });
});
