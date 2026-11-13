// Recorta as artes da economia (referencias/icone  das moedas) em ícones WebP com
// fundo transparente para o cliente. Uso: node tools/assets/convert.mjs currency
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

/** Cada arte: arquivo de origem (pela proporção), recorte [x, y, largura, altura] e tamanho final. */
const CUTS = [
  { out: 'icon_coin.webp', source: 'square-gold', box: [80, 560, 900, 940], size: 256 },
  { out: 'icon_gem.webp', source: 'square-blue', box: [120, 420, 940, 1140], size: 256 },
  { out: 'bundle_starter.webp', source: 'wide', box: [40, 380, 860, 960], size: 480 },
  { out: 'bundle_mid.webp', source: 'wide', box: [900, 200, 900, 1230], size: 480 },
  { out: 'bundle_mega.webp', source: 'wide', box: [1790, 0, 962, 1420], size: 480 },
];

/** Tira o fundo cinza-escuro liso: perto da cor do canto vira transparente, com borda suave. */
async function keyed(file, [left, top, width, height]) {
  const { data, info } = await sharp(file)
    .extract({ left, top, width, height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bg = [data[0], data[1], data[2]];
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
    const t = Math.min(1, Math.max(0, (d - 14) / 36));
    data[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}

export async function convertCurrency(refs, publicDir) {
  const dir = join(refs, 'icone  das moedas');
  const outDir = join(publicDir, 'currency');
  if (!existsSync(dir)) throw new Error(`Pasta ausente: ${dir}`);
  mkdirSync(outDir, { recursive: true });

  // Identifica as artes pelo formato e pela cor dominante do centro.
  const sources = {};
  for (const name of readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f))) {
    const file = join(dir, name);
    const { width, height } = await sharp(file).metadata();
    if (width > height * 1.3) {
      sources.wide = file;
      continue;
    }
    const { channels } = await sharp(file)
      .extract({ left: width >> 2, top: height >> 2, width: width >> 1, height: height >> 1 })
      .stats();
    sources[channels[2].mean > channels[0].mean ? 'square-blue' : 'square-gold'] = file;
  }

  for (const cut of CUTS) {
    const file = sources[cut.source];
    if (!file) throw new Error(`Arte ausente para ${cut.out}`);
    const png = await (await keyed(file, cut.box)).png().toBuffer();
    const outFile = join(outDir, cut.out);
    await sharp(png)
      .trim({ threshold: 1 })
      .resize(cut.size, cut.size, { fit: 'inside' })
      .webp({ quality: 88, alphaQuality: 90 })
      .toFile(outFile);
    console.log(`${cut.out}  ${(statSync(outFile).size / 1024).toFixed(0)} KB`);
  }
}
