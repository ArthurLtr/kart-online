import { CanvasTexture, SRGBColorSpace } from 'three';
import type { SuitDesign } from '../../cosmetics/catalog';

export interface SuitTextures {
  torso: CanvasTexture;
  arm: CanvasTexture;
  leg: CanvasTexture;
}

/** Canvas onde x = U (0,5 é a frente) e a altura v (0 a 1) cresce para cima. */
function paint(
  width: number,
  height: number,
  draw: (
    ctx: CanvasRenderingContext2D,
    band: (v0: number, v1: number, u0?: number, u1?: number) => void,
  ) => void,
): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D indisponível');
  const band = (v0: number, v1: number, u0 = 0, u1 = 1): void => {
    ctx.fillRect(u0 * width, (1 - v1) * height, (u1 - u0) * width, (v1 - v0) * height);
  };
  draw(ctx, band);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const cache = new Map<string, SuitTextures>();

/**
 * Texturas do macacão seguindo o corte das imagens de referência: gola alta,
 * pala nos ombros, cinto, faixas laterais e zíper. Marcas são fictícias.
 */
export function suitTextures(design: SuitDesign): SuitTextures {
  const cached = cache.get(design.id);
  if (cached) return cached;

  // Tronco: v = 0 no quadril, ~0,66 nas axilas, ~0,8 na base do pescoço, 1 no topo do pescoço.
  const torso = paint(512, 512, (ctx, band) => {
    ctx.fillStyle = design.base;
    band(0, 1);
    ctx.fillStyle = design.accent; // faixas laterais sob os braços
    band(0.2, 0.66, 0.2, 0.3);
    band(0.2, 0.66, 0.7, 0.8);
    ctx.fillStyle = design.yoke; // pala dos ombros e alto do peito
    band(0.66, 0.8);
    ctx.fillStyle = design.belt;
    band(0.15, 0.2);
    ctx.fillStyle = design.collar;
    band(0.8, 0.9);
    ctx.fillStyle = '#b9b9b6'; // balaclava entre a gola e o capacete
    band(0.9, 1);
    ctx.fillStyle = design.belt; // zíper frontal
    band(0.2, 0.86, 0.497, 0.503);

    ctx.fillStyle = design.labelColor;
    ctx.font = 'italic 900 34px system-ui, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(design.label, 0.5 * 512, (1 - 0.73) * 512, 150);
    ctx.fillStyle = design.accent;
    ctx.font = 'italic 900 26px system-ui, "Segoe UI", Arial, sans-serif';
    ctx.fillText('KART ONLINE', 0.5 * 512, (1 - 0.52) * 512, 170);
  });

  // Braço: v = 0 no ombro, 1 no punho (as faixas dão a volta, independem do giro).
  const arm = paint(64, 256, (ctx, band) => {
    ctx.fillStyle = design.sleeve;
    band(0, 1);
    ctx.fillStyle = design.yoke;
    band(0, 0.16);
    ctx.fillStyle = design.accent;
    band(0.16, 0.2);
    ctx.fillStyle = design.base;
    band(0.9, 1);
  });

  // Perna: v = 0 no quadril, 1 no tornozelo; faixa do lado de fora (u = 0,75).
  const leg = paint(256, 256, (ctx, band) => {
    ctx.fillStyle = design.base;
    band(0, 1);
    ctx.fillStyle = design.accent;
    band(0, 0.95, 0.71, 0.79);
    ctx.fillStyle = design.yoke;
    band(0, 0.95, 0.795, 0.815);
  });

  const textures = { torso, arm, leg };
  cache.set(design.id, textures);
  return textures;
}
