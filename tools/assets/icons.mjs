// Ícones do app (PWA, tela de início do iPhone e aba do navegador), feitos a
// partir da insígnia de Ouro já recortada. Uso: node tools/assets/convert.mjs icons
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const BACKGROUND = '#0b0e14';

/**
 * `scale`: quanto da largura a insígnia ocupa. No "maskable" o Android recorta
 * em círculo ou gota, então ela fica dentro da área segura (80% central).
 */
const ICONS = [
  { out: 'icon-192.png', size: 192, scale: 0.86, round: 0.2 },
  { out: 'icon-512.png', size: 512, scale: 0.86, round: 0.2 },
  { out: 'icon-maskable-512.png', size: 512, scale: 0.62, round: 0 },
  // O iPhone arredonda sozinho e não aceita transparência.
  { out: 'apple-touch-icon-180.png', size: 180, scale: 0.8, round: 0 },
  { out: 'favicon-32.png', size: 32, scale: 0.96, round: 0, transparent: true },
];

export async function convertIcons(publicDir) {
  const source = join(publicDir, 'assets', 'ranks', 'rank_gold.webp');
  if (!existsSync(source)) throw new Error(`Rode antes "ranks": falta ${source}`);
  const outDir = join(publicDir, 'icons');
  mkdirSync(outDir, { recursive: true });
  for (const icon of ICONS) {
    const inner = Math.round(icon.size * icon.scale);
    const badge = await sharp(source)
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const radius = Math.round(icon.size * icon.round);
    const base = icon.transparent
      ? sharp({
          create: {
            width: icon.size,
            height: icon.size,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
      : sharp(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${icon.size}" height="${icon.size}">` +
              `<defs><radialGradient id="g" cx="50%" cy="42%" r="70%">` +
              `<stop offset="0" stop-color="#2a2410"/><stop offset="1" stop-color="${BACKGROUND}"/>` +
              `</radialGradient></defs>` +
              `<rect width="100%" height="100%" rx="${radius}" fill="url(#g)"/></svg>`,
          ),
        );
    const file = join(outDir, icon.out);
    await base
      .composite([{ input: badge, gravity: 'center' }])
      .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })
      .toFile(file);
    console.log(`${icon.out}  ${(statSync(file).size / 1024).toFixed(0)} KB`);
  }
}
