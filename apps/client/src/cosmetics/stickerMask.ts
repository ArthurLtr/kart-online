import type { StickerShape } from './paint';

/** Lado, em pixels, da máscara de um adesivo. */
export const STICKER_MASK_SIZE = 256;

const cache = new Map<string, Uint8ClampedArray>();

type Point = readonly [number, number];

/** Contornos em coordenadas de 0 a 1 (y para baixo). */
const OUTLINES: Partial<Record<StickerShape, readonly Point[]>> = {
  bolt: [
    [0.6, 0.04],
    [0.2, 0.56],
    [0.46, 0.56],
    [0.36, 0.96],
    [0.8, 0.4],
    [0.53, 0.4],
  ],
  arrow: [
    [0.04, 0.38],
    [0.56, 0.38],
    [0.56, 0.16],
    [0.96, 0.5],
    [0.56, 0.84],
    [0.56, 0.62],
    [0.04, 0.62],
  ],
  band: [
    [0, 0.38],
    [1, 0.38],
    [1, 0.62],
    [0, 0.62],
  ],
};

function star(): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? 0.48 : 0.2;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([0.5 + Math.cos(angle) * radius, 0.52 + Math.sin(angle) * radius]);
  }
  return points;
}

function draw(context: CanvasRenderingContext2D, shape: StickerShape, text: string): void {
  const size = STICKER_MASK_SIZE;
  const polygon = (points: readonly Point[]): void => {
    context.beginPath();
    points.forEach(([x, y], index) =>
      index === 0 ? context.moveTo(x * size, y * size) : context.lineTo(x * size, y * size),
    );
    context.closePath();
    context.fill();
  };
  switch (shape) {
    case 'number': {
      context.font = `italic 700 ${size * 0.82}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      // Três dígitos cabem na mesma largura de dois.
      context.fillText(text, size / 2, size * 0.54, size * 0.94);
      break;
    }
    case 'circle':
      context.beginPath();
      context.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
      context.fill();
      break;
    case 'checker': {
      const cell = size / 4;
      for (let row = 0; row < 4; row++)
        for (let column = 0; column < 4; column++)
          if ((row + column) % 2 === 0) context.fillRect(column * cell, row * cell, cell, cell);
      break;
    }
    case 'flame': {
      const s = size;
      context.beginPath();
      context.moveTo(0.5 * s, 0.03 * s);
      context.bezierCurveTo(0.56 * s, 0.3 * s, 0.86 * s, 0.42 * s, 0.82 * s, 0.68 * s);
      context.bezierCurveTo(0.8 * s, 0.86 * s, 0.66 * s, 0.97 * s, 0.5 * s, 0.97 * s);
      context.bezierCurveTo(0.32 * s, 0.97 * s, 0.18 * s, 0.86 * s, 0.18 * s, 0.68 * s);
      context.bezierCurveTo(0.18 * s, 0.54 * s, 0.26 * s, 0.46 * s, 0.32 * s, 0.36 * s);
      context.bezierCurveTo(0.36 * s, 0.46 * s, 0.4 * s, 0.5 * s, 0.44 * s, 0.5 * s);
      context.bezierCurveTo(0.4 * s, 0.34 * s, 0.42 * s, 0.16 * s, 0.5 * s, 0.03 * s);
      context.fill();
      break;
    }
    case 'star':
      polygon(star());
      break;
    default:
      polygon(OUTLINES[shape] ?? []);
  }
}

/**
 * Máscara RGBA de um adesivo (a forma está no canal alfa), com v = 0 na primeira linha.
 * @param text número do piloto, usado só pela forma `number`
 */
export function stickerMask(shape: StickerShape, text = ''): Uint8ClampedArray {
  const key = shape === 'number' ? `number:${text}` : shape;
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = STICKER_MASK_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas 2D indisponível');
  context.fillStyle = '#fff';
  draw(context, shape, text);
  const data = context.getImageData(0, 0, STICKER_MASK_SIZE, STICKER_MASK_SIZE).data;
  cache.set(key, data);
  return data;
}
