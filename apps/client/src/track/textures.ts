import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/** Gerador pseudoaleatório determinístico (mesma cena a cada carregamento). */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

export function canvasTexture(width: number, height: number, draw: Draw): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D indisponível');
  draw(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  seed: number,
  count: number,
  color: (random: () => number) => string,
  maxSize = 2,
): void {
  const random = createRandom(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = color(random);
    const s = 1 + random() * (maxSize - 1);
    ctx.fillRect(random() * size, random() * size, s, s);
  }
}

/** Asfalto: base cinza-escura com agregados claros e escuros. Cobre 4 × 4 m. */
export function asphaltTexture(): CanvasTexture {
  return canvasTexture(512, 512, (ctx, size) => {
    ctx.fillStyle = '#34353a';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 11, size * size * 0.4, (r) => {
      const v = 34 + Math.floor(r() * 46);
      return `rgb(${v},${v},${v + 3})`;
    });
  });
}

export function grassTexture(): CanvasTexture {
  return canvasTexture(256, 256, (ctx, size) => {
    ctx.fillStyle = '#4f7a36';
    ctx.fillRect(0, 0, size, size);
    speckle(
      ctx,
      size,
      23,
      size * size * 0.5,
      (r) =>
        `rgb(${50 + Math.floor(r() * 50)},${95 + Math.floor(r() * 60)},${35 + Math.floor(r() * 30)})`,
      3,
    );
  });
}

export function gravelTexture(): CanvasTexture {
  return canvasTexture(256, 256, (ctx, size) => {
    ctx.fillStyle = '#b9a98c';
    ctx.fillRect(0, 0, size, size);
    speckle(
      ctx,
      size,
      37,
      size * size * 0.6,
      (r) => {
        const v = 130 + Math.floor(r() * 90);
        return `rgb(${v},${v - 12},${v - 40})`;
      },
      4,
    );
  });
}

export function sandTexture(): CanvasTexture {
  return canvasTexture(128, 128, (ctx, size) => {
    ctx.fillStyle = '#e2cfa3';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 41, size * size * 0.3, (r) => {
      const v = 200 + Math.floor(r() * 40);
      return `rgb(${v},${v - 18},${v - 60})`;
    });
  });
}

/** Xadrez 2 × 2 para a linha de chegada. */
export function checkerTexture(): CanvasTexture {
  const texture = canvasTexture(64, 64, (ctx, size) => {
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, size / 2, size / 2);
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
  });
  texture.anisotropy = 16;
  return texture;
}

/** Borracha depositada no traçado: faixa escura, mais forte no meio, com riscos. */
export function rubberAlphaTexture(): CanvasTexture {
  return canvasTexture(128, 256, (ctx, width, height) => {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, '#000');
    gradient.addColorStop(0.5, '#bbb');
    gradient.addColorStop(1, '#000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    const random = createRandom(53);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.15 + random() * 0.35})`;
      ctx.fillRect(random() * width, 0, 1 + random() * 3, height);
    }
  });
}

/** Silhueta de torcedor (cabeça e tronco) em branco, tingida por instância. */
export function crowdTexture(): CanvasTexture {
  return canvasTexture(64, 96, (ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#d9b89a';
    ctx.beginPath();
    ctx.arc(width / 2, 22, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(8, 38, width - 16, height - 34, 14);
    ctx.fill();
  });
}

/** Placa de publicidade com marca fictícia do jogo. */
export function signTexture(text: string, background: string, foreground: string): CanvasTexture {
  return canvasTexture(1024, 256, (ctx, width, height) => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = foreground;
    ctx.fillRect(0, height - 26, width, 12);
    ctx.font = 'italic 900 120px system-ui, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2 - 8, width - 80);
  });
}
