import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  DEFAULT_KEYS,
  DEFAULT_SETTINGS,
  QUALITY,
  QUALITY_NAMES,
  remapKey,
  sanitizeSettings,
  suggestQuality,
} from './settings';

describe('configurações', () => {
  it('lixo no armazenamento vira o padrão', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ quality: 'insano', volume: 9, keys: { throttle: [] } })).toEqual({
      ...DEFAULT_SETTINGS,
      volume: 1,
    });
  });

  it('presets ficam mais pesados do Baixo ao Ultra', () => {
    for (let i = 1; i < QUALITY_NAMES.length; i++) {
      const lighter = QUALITY[QUALITY_NAMES[i - 1]!];
      const heavier = QUALITY[QUALITY_NAMES[i]!];
      expect(heavier.shadowMap).toBeGreaterThan(lighter.shadowMap);
      expect(heavier.pixelRatio).toBeGreaterThan(lighter.pixelRatio);
      expect(heavier.scenery).toBeGreaterThanOrEqual(lighter.scenery);
    }
  });

  it('remapear tira a tecla da ação que a usava', () => {
    const keys = remapKey(DEFAULT_KEYS, 'drift', 0, 'KeyW');
    expect(keys.drift).toEqual(['KeyW']);
    expect(keys.throttle).toEqual(['ArrowUp']);
  });

  it('nenhuma ação fica sem tecla nem divide tecla com outra', () => {
    let keys = remapKey(DEFAULT_KEYS, 'throttle', 0, 'Space');
    keys = remapKey(keys, 'brake', 1, 'KeyW');
    keys = remapKey(keys, 'left', 0, 'Space');
    const all = ACTIONS.flatMap(({ action }) => keys[action]);
    expect(new Set(all).size).toBe(all.length);
    for (const { action } of ACTIONS) expect(keys[action].length).toBeGreaterThan(0);
  });

  it('sugere preset pela GPU', () => {
    expect(suggestQuality('ANGLE (Google, SwiftShader)', 16)).toBe('baixo');
    expect(suggestQuality('ANGLE (Intel, Intel(R) UHD Graphics 620)', 8)).toBe('baixo');
    expect(suggestQuality('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)', 8)).toBe('medio');
    expect(suggestQuality('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)', 12)).toBe('alto');
    expect(suggestQuality('', 4)).toBe('baixo');
  });
});
