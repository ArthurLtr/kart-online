// Converte os modelos de referencias/ em GLBs otimizados para o cliente.
// Uso: pnpm assets   (requer Blender; defina BLENDER=<caminho> se não for achado)
//
// Uso parcial: node tools/assets/convert.mjs gear trees
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

/** Roda um script do Blender e devolve o relatório JSON que ele grava. */
function runBlender(script, args, reportFile) {
  mkdirSync(tmp, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const run = spawnSync(findBlender(), ['-b', '--python', join(here, script), '--', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error || !run.stdout.includes('CONVERT_OK')) {
    console.error(run.stdout?.split('\n').slice(-15).join('\n'));
    throw new Error(`Blender falhou em ${script} (${run.error?.message ?? 'veja o log acima'})`);
  }
  return JSON.parse(readFileSync(reportFile, 'utf8'));
}

async function gltfIo() {
  await MeshoptEncoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
}

// Medidas do piloto procedural (BODY em apps/client/src/models/pilot/createPilot.ts).
const GEAR = {
  shoeLength: 0.28,
  heelBack: 0.055,
  ankleHeight: 0.07,
  gloveLength: 0.155,
  cuff: 0.06,
};

/** Bota e luva do piloto: só geometria (as cores vêm dos cosméticos). */
async function convertGear() {
  const rawGlb = join(tmp, 'gear_raw.glb');
  const reportFile = join(tmp, 'gear_report.json');
  const report = runBlender(
    'convert_gear.py',
    [
      join(refs, 'shoes/Jane_shoes.obj'),
      join(refs, 'Gloves_Qa/Gloves_Qa/Gloves_Qa.obj'),
      rawGlb,
      reportFile,
      ...[GEAR.shoeLength, GEAR.heelBack, GEAR.ankleHeight, GEAR.gloveLength, GEAR.cuff].map(
        String,
      ),
    ],
    reportFile,
  );
  const io = await gltfIo();
  const document = await io.read(rawGlb);
  await document.transform(dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const outFile = join(outDir, 'pilot_gear.glb');
  await io.write(outFile, document);
  console.log(`pilot_gear.glb  ${(statSync(outFile).size / 1024).toFixed(0)} KB`);
  console.log(
    `  bota: ${report.shoe.upper} + ${report.shoe.sole} tri · luva: ${report.glove.main} + ${report.glove.trim} tri`,
  );
}

/** Árvores da pista: as duas leves do pacote, com texturas reduzidas. */
async function convertTrees() {
  const rawGlb = join(tmp, 'trees_raw.glb');
  const reportFile = join(tmp, 'trees_report.json');
  const report = runBlender(
    'convert_trees.py',
    [join(refs, 'arvores/Realistic+Trees+.glb'), rawGlb, reportFile],
    reportFile,
  );
  const io = await gltfIo();
  const document = await io.read(rawGlb);
  for (const material of document.getRoot().listMaterials()) {
    // Folhas e galhos são cartões recortados pelo alfa da textura.
    if (/^(Leaf|Branch)/.test(material.getName())) {
      material.setAlphaMode('MASK').setAlphaCutoff(0.45).setDoubleSided(true);
    } else {
      material.setAlphaMode('OPAQUE');
    }
  }
  await document.transform(
    dedup(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, resize: [512, 512] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const outFile = join(outDir, 'trees.glb');
  await io.write(outFile, document);
  console.log(`trees.glb  ${(statSync(outFile).size / 1024).toFixed(0)} KB`);
  for (const [name, tree] of Object.entries(report)) {
    console.log(`  - ${name}: ${tree.bark} + ${tree.leaves} tri, ${tree.height} m`);
  }
}

// Sem argumentos converte tudo; "node convert.mjs gear trees" converte só o que for pedido.
const STEPS = { kart: convertKart, gear: convertGear, trees: convertTrees };
const wanted = process.argv.slice(2);
for (const [name, step] of Object.entries(STEPS)) {
  if (wanted.length === 0 || wanted.includes(name)) await step();
}
