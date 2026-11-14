// Recorta as 6 insígnias de patente (referencias/.../PATENTES.png) em WebP com
// fundo transparente. Uso: node tools/assets/convert.mjs ranks
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ART_DIR, keyed } from './currency.mjs';

/** Recorte [x, y, largura, altura] de cada insígnia na arte de 1024×572. */
const CUTS = [
  { id: 'bronze', box: [12, 196, 176, 186] },
  { id: 'silver', box: [172, 196, 182, 186] },
  { id: 'gold', box: [344, 186, 172, 196] },
  { id: 'platinum', box: [506, 196, 178, 186] },
  { id: 'diamond', box: [672, 146, 180, 234] },
  { id: 'legend', box: [836, 160, 184, 222] },
];

export async function convertRanks(refs, publicDir) {
  const file = join(refs, ART_DIR, 'PATENTES.png');
  const outDir = join(publicDir, 'ranks');
  if (!existsSync(file)) throw new Error(`Arte ausente: ${file}`);
  mkdirSync(outDir, { recursive: true });
  const { width } = await sharp(file).metadata();
  const scale = width / 1024;
  for (const cut of CUTS) {
    const box = cut.box.map((v) => Math.round(v * scale));
    const png = await dropNeighbours(await keyed(file, box));
    const outFile = join(outDir, `rank_${cut.id}.webp`);
    await sharp(png)
      .trim({ threshold: 1 })
      .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 90, alphaQuality: 92 })
      .toFile(outFile);
    console.log(`rank_${cut.id}.webp  ${(statSync(outFile).size / 1024).toFixed(0)} KB`);
  }
}

/**
 * Apaga pedaços das insígnias vizinhas: manchas pequenas que encostam na borda
 * esquerda ou direita do recorte (a insígnia em si fica no meio).
 */
async function dropNeighbours(image) {
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const label = new Int32Array(w * h).fill(-1);
  const blobs = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] < 24) continue;
    const blob = { pixels: [], edge: false };
    const stack = [start];
    label[start] = blobs.length;
    while (stack.length) {
      const p = stack.pop();
      blob.pixels.push(p);
      const x = p % w;
      if (x <= 1 || x >= w - 2) blob.edge = true;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || label[q] !== -1 || data[q * 4 + 3] < 24) continue;
        if (Math.abs((q % w) - x) > 1) continue;
        label[q] = blobs.length;
        stack.push(q);
      }
    }
    blobs.push(blob);
  }
  const largest = Math.max(...blobs.map((b) => b.pixels.length));
  for (const blob of blobs) {
    const small = blob.pixels.length < largest * 0.02;
    if ((blob.edge && blob.pixels.length < largest * 0.25) || small) {
      for (const p of blob.pixels) data[p * 4 + 3] = 0;
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}
