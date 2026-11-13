import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, parseHex } from './color';
import {
  MAX_STICKERS,
  newSticker,
  patternMix,
  PATTERNS,
  sanitizePaint,
  solidPaint,
  stickerFaces,
  stickerUv,
} from './paint';
import { bodyZone, floodZones, rasterizeZones, ZONE, zonesByComponent } from './zoneMap';

describe('cores', () => {
  it('hex → HSV → hex devolve a mesma cor', () => {
    for (const hex of ['#000000', '#ffffff', '#d3222a', '#2b48c9', '#dcff2e', '#7a4a2b'])
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });

  it('aceita hex curto e sem #, recusa o resto', () => {
    expect(parseHex('F80')).toBe('#ff8800');
    expect(parseHex(' #A1b2C3 ')).toBe('#a1b2c3');
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('vermelho')).toBeNull();
  });
});

describe('pintura livre', () => {
  it('campo inválido vira o padrão, sem derrubar o resto', () => {
    const paint = sanitizePaint({
      zones: { fairing: { color: '#FF0000', finish: 'chrome' }, seat: { color: 'url(x)' } },
      pattern: { type: 'laser', color: '#00ff00', size: 9 },
    });
    expect(paint?.zones.fairing).toEqual({ color: '#ff0000', finish: 'chrome' });
    expect(paint?.zones.seat).toEqual(solidPaint().zones.seat);
    expect(paint?.pattern).toEqual({ type: 'solid', color: '#00ff00', size: 1 });
    expect(sanitizePaint('x')).toBeNull();
  });

  it('o padrão sólido não mistura nada e os outros ficam entre 0 e 1', () => {
    for (const { id } of PATTERNS) {
      let seen = 0;
      for (let z = -0.4; z < 1.5; z += 0.07) {
        for (let x = -0.4; x < 0.4; x += 0.03) {
          const mix = patternMix(id, 0.5, x, 0.3, z);
          expect(mix).toBeGreaterThanOrEqual(0);
          expect(mix).toBeLessThanOrEqual(1);
          seen = Math.max(seen, mix);
        }
      }
      expect(seen > 0).toBe(id !== 'solid');
    }
  });

  it('as faixas são simétricas dos dois lados do kart', () => {
    for (let x = 0; x < 0.4; x += 0.005)
      expect(patternMix('stripes', 0.5, x, 0.3, 0.5)).toBe(
        patternMix('stripes', 0.5, -x, 0.3, 0.5),
      );
  });
});

describe('mapa de zonas', () => {
  it('separa peças soltas e classifica o corpo pelo tamanho', () => {
    // Dois triângulos sem vértice em comum: uma chapa baixa e comprida e um bloco alto.
    const positions = [-0.3, 0.13, 0.1, 0.3, 0.13, 0.1, 0, 0.18, 1.1];
    positions.push(-0.35, 0.1, -0.2, 0.35, 0.1, -0.2, 0, 0.5, 0.1);
    const zones = zonesByComponent(positions, [0, 1, 2, 3, 4, 5], bodyZone);
    expect([...zones]).toEqual([ZONE.floor, ZONE.seat]);
  });

  it('vértices duplicados na mesma posição contam como a mesma peça', () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];
    const seen: number[] = [];
    zonesByComponent(positions, [0, 1, 2, 3, 4, 5], (min, max) => {
      seen.push(max[0] - min[0]);
      return 1;
    });
    expect(seen).toEqual([1]);
  });

  it('pinta a ilha de UV, guarda a posição e espalha só pelos pixels pintáveis', () => {
    const size = 16;
    const map = rasterizeZones(
      [
        {
          positions: [0, 0, 0, 0, 0, 2, 0, 0, 0],
          uvs: [0, 0, 0.5, 0, 0, 0.5],
          indices: [0, 1, 2],
          zones: [ZONE.fairing],
        },
      ],
      size,
    );
    expect(map.zone[1 * size + 1]).toBe(ZONE.fairing);
    expect(map.zone[12 * size + 12]).toBe(ZONE.none);
    // z cresce junto com u: perto de u=0,5 vale quase 2.
    expect(map.position[(0 * size + 7) * 3 + 2]).toBeGreaterThan(1.5);

    const wall = 13; // coluna não pintável: a zona não atravessa
    floodZones(map, (pixel) => pixel % size !== wall);
    expect(map.zone[12 * size + 12]).toBe(ZONE.fairing);
    expect(map.zone[12 * size + wall]).toBe(ZONE.none);
    expect(map.zone[12 * size + 15]).toBe(ZONE.none);
  });
});

describe('rodas, adesivos e número', () => {
  const bounds = { min: [-0.5, 0, -0.2], max: [0.5, 0.6, 1.4] } as const;

  it('pintura nova não tem adesivos, número nem cor livre nas rodas', () => {
    const paint = solidPaint();
    expect(paint.stickers).toEqual([]);
    expect(paint.number).toBe('');
    expect(paint.wheels).toEqual({ color: null, finish: 'gloss', stripe: null });
  });

  it('limpa adesivos inválidos, limita a quantidade e os valores', () => {
    const many = Array.from({ length: MAX_STICKERS + 4 }, () => ({ shape: 'star', size: 9 }));
    const paint = sanitizePaint({
      stickers: [{ shape: 'nada' }, ...many],
      number: 'a12b345',
      wheels: { color: '#FF0000', finish: 'chrome', stripe: 'verde' },
    })!;
    expect(paint.stickers).toHaveLength(MAX_STICKERS);
    expect(paint.stickers[0]!.size).toBe(1);
    expect(paint.number).toBe('123');
    expect(paint.wheels).toEqual({ color: '#ff0000', finish: 'chrome', stripe: null });
  });

  it('o centro do adesivo cai no meio da máscara e fora dele não pinta', () => {
    const sticker = { ...newSticker('star'), x: 0.5, y: 0.5 };
    const centre = stickerUv(sticker, bounds, 0, 0.3, 0.6)!;
    expect(centre[0]).toBeCloseTo(0.5);
    expect(centre[1]).toBeCloseTo(0.5);
    expect(stickerUv(sticker, bounds, 0.45, 0.3, 0.6)).toBeNull();
  });

  it('visto de cima, o adesivo é lido de frente: +x à direita e a traseira no alto', () => {
    const sticker = { ...newSticker('star'), x: 0.5, y: 0.5 };
    const [u, v] = stickerUv(sticker, bounds, 0.05, 0.3, 0.55)!;
    expect(u).toBeGreaterThan(0.5);
    expect(v).toBeGreaterThan(0.5);
  });

  it('só pinta as faces voltadas para a superfície do adesivo', () => {
    const top = newSticker('star', 'top');
    expect(stickerFaces(top, 0, 1, 0)).toBe(true);
    expect(stickerFaces(top, 0, -1, 0)).toBe(false);
    const left = newSticker('star', 'left');
    expect(stickerFaces(left, 127, 0, 0)).toBe(true);
    expect(stickerFaces(left, -127, 0, 0)).toBe(false);
    expect(stickerFaces(left, -127, 0, 0, 1)).toBe(true);
  });

  it('adesivo lateral só pinta o seu lado; espelhado, pinta os dois sem inverter a leitura', () => {
    const sticker = { ...newSticker('number', 'left'), x: 0.5, y: 0.5 };
    expect(stickerUv(sticker, bounds, 0.3, 0.3, 0.6)).not.toBeNull();
    expect(stickerUv(sticker, bounds, -0.3, 0.3, 0.6)).toBeNull();
    // Do lado esquerdo o bico fica à esquerda de quem olha; do direito, à direita.
    expect(stickerUv(sticker, bounds, 0.3, 0.3, 0.65)![0]).toBeLessThan(0.5);
    expect(stickerUv(sticker, bounds, -0.3, 0.3, 0.65, 1)![0]).toBeGreaterThan(0.5);
  });

  it('o giro roda o desenho em torno do centro', () => {
    const sticker = { ...newSticker('arrow', 'front'), x: 0.5, y: 0.5, rotation: 90 };
    const [u, v] = stickerUv(sticker, bounds, 0, 0.35, 0)!;
    expect(u).toBeGreaterThan(0.5);
    expect(v).toBeCloseTo(0.5);
  });
});
