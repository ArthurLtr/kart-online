// Converte os modelos de referencias/ em GLBs otimizados para o cliente.
// Uso: pnpm assets   (requer Blender; defina BLENDER=<caminho> se não for achado)
//
// Etapas: Blender separa/nomeia/escala o kart -> gltf-transform liga as texturas
// PBR (cor, normal, ORM), comprime a geometria com Meshopt e as texturas em WebP.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const KART_LENGTH_M = 1.85; // igual a KART_LENGTH_M em @kart/shared
const TEXTURE_SIZE = 2048;

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const refs = join(root, 'referencias');
const tmp = join(here, '.tmp');
const outDir = join(root, 'apps/client/public/assets/models');

function findBlender() {
  if (process.env.BLENDER && existsSync(process.env.BLENDER)) return process.env.BLENDER;
  const base = 'C:/Program Files/Blender Foundation';
  if (existsSync(base)) {
    const versions = readdirSync(base).sort().reverse();
    for (const version of versions) {
      const exe = join(base, version, 'blender.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return 'blender'; // tenta o PATH
}

function texture(name) {
  const file = join(refs, `${name} Map - ${TEXTURE_SIZE}.png`);
  if (!existsSync(file)) throw new Error(`Textura ausente: ${file}`);
  return file;
}

/** Empacota AO (R), rugosidade (G) e metalicidade (B) num só mapa, como o glTF espera. */
async function packOrm() {
  // Os mapas são em tons de cinza: o primeiro canal já é o valor.
  const channel = (name) =>
    sharp(texture(name))
      .extractChannel(0)
      .raw({ depth: 'uchar' })
      .toBuffer({ resolveWithObject: true });
  const [ao, roughness, metallic] = await Promise.all([
    channel('AO'),
    channel('Roughness'),
    channel('Metallic'),
  ]);
  const { width, height } = ao.info;
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = ao.data[i];
    pixels[i * 3 + 1] = roughness.data[i];
    pixels[i * 3 + 2] = metallic.data[i];
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

async function convertKart() {
  mkdirSync(tmp, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const rawGlb = join(tmp, 'kart_raw.glb');
  const reportFile = join(tmp, 'kart_report.json');

  const blender = findBlender();
  const run = spawnSync(
    blender,
    [
      '-b',
      '--python',
      join(here, 'convert_kart.py'),
      '--',
      join(refs, 'Cartoon+Kart+G+-+OBJ.obj'),
      rawGlb,
      reportFile,
      String(KART_LENGTH_M),
    ],
    { encoding: 'utf8' },
  );
  if (run.error || !run.stdout.includes('CONVERT_OK')) {
    console.error(run.stdout?.split('\n').slice(-15).join('\n'));
    throw new Error(`Blender falhou (${run.error?.message ?? 'veja o log acima'})`);
  }

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const document = await io.read(rawGlb);

  const paint = document
    .getRoot()
    .listMaterials()
    .find((material) => material.getName() === 'kart_paint');
  if (!paint) throw new Error('material kart_paint não encontrado no GLB');

  const png = (name, data) => document.createTexture(name).setMimeType('image/png').setImage(data);
  const orm = png('kart_orm', await packOrm());
  paint
    .setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(png('kart_color', readFileSync(texture('Color'))))
    .setNormalTexture(png('kart_normal', readFileSync(texture('Normal'))))
    .setOcclusionTexture(orm)
    .setMetallicRoughnessTexture(orm)
    .setMetallicFactor(1)
    .setRoughnessFactor(1);

  await document.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );

  const outFile = join(outDir, 'kart.glb');
  await io.write(outFile, document);

  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  const { width, height, length } = report.size_m;
  console.log(`kart.glb  ${(statSync(outFile).size / 1024).toFixed(0)} KB`);
  console.log(`  ${report.triangles} triângulos · ${length} × ${width} × ${height} m (C × L × A)`);
  for (const [name, part] of Object.entries(report.parts)) {
    console.log(`  - ${name}: ${part.triangles} tri, pivô [${part.origin.join(', ')}]`);
  }
}

await convertKart();
