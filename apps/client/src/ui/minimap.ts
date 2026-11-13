import type { Track } from '@kart/shared';

export interface MinimapDot {
  x: number;
  z: number;
  own: boolean;
}

export interface Minimap {
  element: HTMLCanvasElement;
  draw(dots: readonly MinimapDot[]): void;
}

const SIZE = 168;
const MARGIN = 12;

/** Transforma metros da pista em pixels do minimapa, preservando a proporção. */
export function minimapProjection(
  track: Track,
  size = SIZE,
  margin = MARGIN,
): (x: number, z: number) => { u: number; v: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const sample of track.samples) {
    minX = Math.min(minX, sample.x);
    maxX = Math.max(maxX, sample.x);
    minZ = Math.min(minZ, sample.z);
    maxZ = Math.max(maxZ, sample.z);
  }
  const scale = (size - margin * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
  const offsetU = (size - (maxX - minX) * scale) / 2;
  const offsetV = (size - (maxZ - minZ) * scale) / 2;
  // O mar fica em −Z; no mapa ele vai para baixo, como na vista da arquibancada.
  return (x, z) => ({ u: offsetU + (x - minX) * scale, v: offsetV + (maxZ - z) * scale });
}

/** Minimapa: o traçado desenhado uma vez a partir do spline e um ponto por kart. */
export function createMinimap(track: Track): Minimap {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const element = document.createElement('canvas');
  element.className = 'hud-minimapa';
  element.width = element.height = SIZE * ratio;
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', 'Minimapa da pista');
  const project = minimapProjection(track);

  const base = document.createElement('canvas');
  base.width = base.height = SIZE * ratio;
  const pen = base.getContext('2d');
  if (pen) {
    pen.scale(ratio, ratio);
    pen.lineJoin = pen.lineCap = 'round';
    pen.beginPath();
    track.samples.forEach((sample, i) => {
      const { u, v } = project(sample.x, sample.z);
      if (i === 0) pen.moveTo(u, v);
      else pen.lineTo(u, v);
    });
    pen.closePath();
    pen.strokeStyle = 'rgba(8, 10, 14, 0.75)';
    pen.lineWidth = 9;
    pen.stroke();
    pen.strokeStyle = 'rgba(245, 244, 240, 0.9)';
    pen.lineWidth = 4.5;
    pen.stroke();
    // Linha de chegada.
    const start = track.grid[0];
    if (start) {
      const { u, v } = project(start.x, start.z);
      pen.fillStyle = '#dcff2e';
      pen.fillRect(u - 2, v - 6, 4, 12);
    }
  }

  const context = element.getContext('2d');
  return {
    element,
    draw(dots) {
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, element.width, element.height);
      context.drawImage(base, 0, 0);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      // O jogador por último, para ficar por cima dos outros.
      for (const pass of [false, true]) {
        for (const dot of dots) {
          if (dot.own !== pass) continue;
          const { u, v } = project(dot.x, dot.z);
          context.beginPath();
          context.arc(u, v, dot.own ? 5.5 : 3.4, 0, Math.PI * 2);
          context.fillStyle = dot.own ? '#dcff2e' : '#f5f4f0';
          context.fill();
          context.lineWidth = 1.5;
          context.strokeStyle = '#0b0d11';
          context.stroke();
        }
      }
    },
  };
}
