import type { BufferGeometry, Group, MeshStandardMaterial, Texture } from 'three';
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from 'three';
import { KART_PARTS, KART_WHEEL_PARTS } from '@kart/shared';
import { hexToRgb, shiftHue } from './color';
import type { KartPaint, Sticker, StickerBounds } from './paint';
import { FINISHES, patternMix, stickerFaces, stickerUv, ZONE_IDS } from './paint';
import { stickerMask, STICKER_MASK_SIZE } from './stickerMask';
import type { ZonePart } from './zoneMap';
import { bodyZone, floodZones, rasterizeZones, ZONE, zonesByComponent } from './zoneMap';

/** Lado das texturas compostas. O atlas é feito de áreas chapadas, então 1024 basta. */
const SIZE = 1024;

/** Tudo o que não muda de uma pintura para outra: calculado uma vez por modelo. */
interface PaintPlan {
  color: Uint8ClampedArray;
  orm: Uint8ClampedArray | null;
  /** Pixels pintáveis (o azul do modelo dentro de alguma zona). */
  pixels: Uint32Array;
  zones: Uint8Array;
  /** Sombreado original de cada pixel pintável, 0–255. */
  shades: Uint8Array;
  positions: Float32Array;
  /** Normal da face de cada pixel pintável. */
  normals: Int8Array;
  /** Área da carroceria que recebe adesivos. */
  bounds: StickerBounds;
}

interface PaintLayer {
  color: DataTexture;
  orm: DataTexture | null;
  originalOrm: Texture | null;
}

const plans = new WeakMap<Texture, PaintPlan>();

function readPixels(texture: Texture): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas 2D indisponível');
  context.drawImage(texture.image as CanvasImageSource, 0, 0, SIZE, SIZE);
  return context.getImageData(0, 0, SIZE, SIZE).data;
}

/**
 * Somado à zona dos pixels que não são pintura (branco, preto, números de fábrica):
 * eles mantêm a cor original e só recebem adesivos.
 */
const PLAIN = 16;

/** Raio (fração do raio da roda) até onde vai o aro, e a faixa pintável na lateral do pneu. */
const RIM_EDGE = 0.72;
const STRIPE_BAND = [0.77, 0.87] as const;

/**
 * Geometria de uma peça no espaço do kart, com a zona de cada triângulo.
 * @param wheel as rodas dividem a mesma área do atlas: a posição vira (eixo, y, z)
 *   a partir do centro da roda, com y e z em frações do raio dela.
 */
function zonePart(
  kart: Group,
  name: string,
  zone: number | 'body',
  wheel = false,
): ZonePart | null {
  const mesh = kart.getObjectByName(name);
  if (!(mesh instanceof Mesh)) return null;
  const geometry = mesh.geometry as BufferGeometry;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!position || !uv) return null;
  const toKart = new Matrix4().copy(kart.matrixWorld).invert().multiply(mesh.matrixWorld);
  const point = new Vector3();
  const positions = new Float32Array(position.count * 3);
  const uvs = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    point
      .fromBufferAttribute(position, i)
      .applyMatrix4(toKart)
      .toArray(positions, i * 3);
    uvs[i * 2] = uv.getX(i);
    uvs[i * 2 + 1] = uv.getY(i);
  }
  if (wheel) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, positions[i]!);
      max[i % 3] = Math.max(max[i % 3]!, positions[i]!);
    }
    const radius = Math.max(max[1]! - min[1]!, max[2]! - min[2]!) / 2;
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      const centred = positions[i]! - (min[axis]! + max[axis]!) / 2;
      positions[i] = axis === 0 ? centred : centred / radius;
    }
  }
  const indices = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from({ length: position.count }, (_, i) => i);
  const zones =
    zone === 'body'
      ? zonesByComponent(positions, indices, bodyZone)
      : new Uint8Array(indices.length / 3).fill(zone);
  return { positions, uvs, indices, zones };
}

function buildPlan(kart: Group, original: Texture, originalOrm: Texture | null): PaintPlan {
  kart.updateWorldMatrix(true, true);
  const parts = [
    zonePart(kart, KART_PARTS.body, 'body'),
    zonePart(kart, KART_PARTS.exhaust, ZONE.details),
    zonePart(kart, KART_PARTS.steeringWheel, ZONE.details),
    ...KART_WHEEL_PARTS.map((name) => zonePart(kart, name, ZONE.blocked, true)),
    zonePart(kart, KART_PARTS.fairing, ZONE.fairing),
  ].filter((part): part is ZonePart => part !== null);
  const color = readPixels(original);
  // Pintável é o azul da pintura de fábrica; preto, branco e números ficam como estão.
  const isBlue = (pixel: number): boolean => {
    const blue = color[pixel * 4 + 2]!;
    return blue > color[pixel * 4]! + 40 && blue > color[pixel * 4 + 1]! + 30;
  };
  const map = rasterizeZones(parts, SIZE);
  floodZones(map, isBlue);

  // Nas rodas: o aro é a parte clara ou azul perto do centro; a faixa é um anel
  // na lateral escura do pneu. O resto da roda não é pintável.
  const brightness = (pixel: number): number =>
    Math.max(color[pixel * 4]!, color[pixel * 4 + 1]!, color[pixel * 4 + 2]!);
  for (let pixel = 0; pixel < map.zone.length; pixel++) {
    if (map.zone[pixel] !== ZONE.blocked) continue;
    const radius = Math.hypot(map.position[pixel * 3 + 1]!, map.position[pixel * 3 + 2]!);
    const light = brightness(pixel);
    if (radius < RIM_EDGE && (isBlue(pixel) || light > 150)) map.zone[pixel] = ZONE.rim;
    else if (radius > STRIPE_BAND[0] && radius < STRIPE_BAND[1] && light < 110)
      map.zone[pixel] = ZONE.tire;
  }
  const paintable = (pixel: number): boolean => {
    const zone = map.zone[pixel]!;
    return zone !== 0 && zone !== ZONE.blocked;
  };
  // Fora do azul, adesivo só pega na carenagem e nas partes claras (placas, bico):
  // tubos e motor escuros ficam como estão.
  for (let pixel = 0; pixel < map.zone.length; pixel++) {
    const zone = map.zone[pixel]!;
    if (zone === 0 || zone >= ZONE.rim || isBlue(pixel)) continue;
    map.zone[pixel] = zone === ZONE.fairing || brightness(pixel) > 140 ? zone + PLAIN : 0;
  }

  let count = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let pixel = 0; pixel < map.zone.length; pixel++) {
    if (!paintable(pixel)) continue;
    count++;
    if (map.zone[pixel]! >= ZONE.rim && map.zone[pixel]! < PLAIN) continue;
    for (let axis = 0; axis < 3; axis++) {
      const value = map.position[pixel * 3 + axis]!;
      if (value < min[axis]!) min[axis] = value;
      if (value > max[axis]!) max[axis] = value;
    }
  }
  const plan: PaintPlan = {
    bounds: { min, max },
    color,
    orm: originalOrm ? readPixels(originalOrm) : null,
    pixels: new Uint32Array(count),
    zones: new Uint8Array(count),
    shades: new Uint8Array(count),
    positions: new Float32Array(count * 3),
    normals: new Int8Array(count * 3),
  };
  let next = 0;
  for (let pixel = 0; pixel < map.zone.length; pixel++) {
    if (!paintable(pixel)) continue;
    plan.pixels[next] = pixel;
    plan.zones[next] = map.zone[pixel]!;
    plan.shades[next] = brightness(pixel);
    plan.positions.set(map.position.subarray(pixel * 3, pixel * 3 + 3), next * 3);
    plan.normals.set(map.normal.subarray(pixel * 3, pixel * 3 + 3), next * 3);
    next++;
  }
  return plan;
}

/** Um adesivo pronto para pintar: máscara, cor e as cópias (a própria e a espelhada). */
interface Decal {
  sticker: Sticker;
  mask: Uint8ClampedArray;
  rgb: readonly [number, number, number];
  copies: readonly (0 | 1)[];
}

/**
 * Escreve a pintura nos pixels pintáveis das texturas de cor e de rugosidade/metal.
 * @param rimColor cor do aro do catálogo, usada quando a pintura não define a dela
 */
function compose(
  plan: PaintPlan,
  paint: KartPaint,
  rimColor: string | null,
  color: Uint8Array,
  orm: Uint8Array | null,
): void {
  const wheelColor = paint.wheels.color ?? rimColor;
  const decals: Decal[] = paint.stickers
    .filter((sticker) => sticker.opacity > 0 && (sticker.shape !== 'number' || paint.number))
    .map((sticker) => ({
      sticker,
      mask: stickerMask(sticker.shape, paint.number),
      rgb: hexToRgb(sticker.color),
      copies: sticker.mirror ? [0, 1] : [0],
    }));
  const stripeRgb = paint.wheels.stripe ? hexToRgb(paint.wheels.stripe) : null;
  const zones = [
    null,
    ...ZONE_IDS.map((id) => paint.zones[id]),
    wheelColor ? { color: wheelColor, finish: paint.wheels.finish } : null,
  ].map((zone) => {
    if (!zone) return null;
    const finish = FINISHES.find((entry) => entry.id === zone.finish) ?? FINISHES[0];
    const rgb = hexToRgb(zone.color);
    return {
      rgb,
      pearl: shiftHue(rgb, 40),
      finish: finish.id,
      roughness: Math.round(finish.roughness * 255),
      metalness: Math.round(finish.metalness * 255),
    };
  });
  const { type, size } = paint.pattern;
  const patternRgb = hexToRgb(paint.pattern.color);
  const { pixels, positions, shades, normals } = plan;
  /** Devolve o pixel ao que era de fábrica (as texturas são reescritas no lugar). */
  const restore = (at: number): void => {
    color[at] = plan.color[at]!;
    color[at + 1] = plan.color[at + 1]!;
    color[at + 2] = plan.color[at + 2]!;
    if (orm && plan.orm) {
      orm[at + 1] = plan.orm[at + 1]!;
      orm[at + 2] = plan.orm[at + 2]!;
    }
  };
  for (let i = 0; i < pixels.length; i++) {
    const zoneId = plan.zones[i]!;
    if (zoneId === ZONE.tire) {
      const at = pixels[i]! * 4;
      if (!stripeRgb) restore(at);
      else {
        color[at] = stripeRgb[0];
        color[at + 1] = stripeRgb[1];
        color[at + 2] = stripeRgb[2];
      }
      continue;
    }
    const at = pixels[i]! * 4;
    const zone = zoneId > PLAIN ? null : zones[zoneId];
    if (!zone && (zoneId < PLAIN || decals.length === 0)) {
      if (zoneId === ZONE.rim || zoneId > PLAIN) restore(at);
      continue;
    }
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    // Sem zona de pintura o pixel parte da cor de fábrica e só recebe adesivos.
    let r = zone ? zone.rgb[0] : plan.color[at]!;
    let g = zone ? zone.rgb[1] : plan.color[at + 1]!;
    let b = zone ? zone.rgb[2] : plan.color[at + 2]!;
    if (!zone) {
      // Cor de fábrica: nada a misturar antes dos adesivos.
    } else if (zone.finish === 'carbon') {
      // Trama de fibra: xadrez diagonal escuro, com um fio da cor escolhida.
      const weave = (Math.floor((x + z) / 0.018) + Math.floor((x - z + y) / 0.018)) & 1;
      const base = weave ? 52 : 26;
      r = base + r * 0.1;
      g = base + g * 0.1;
      b = base + b * 0.1;
    } else if (zone.finish === 'pearl') {
      const shift = (0.5 + 0.5 * Math.sin(y * 16 + z * 7 + x * 5)) * 0.55;
      r += (zone.pearl[0] - r) * shift;
      g += (zone.pearl[1] - g) * shift;
      b += (zone.pearl[2] - b) * shift;
    } else if (zone.finish === 'chrome') {
      r += (255 - r) * 0.55;
      g += (255 - g) * 0.55;
      b += (255 - b) * 0.55;
    }
    const body = zoneId !== ZONE.rim;
    const mix = !zone || !body || type === 'solid' ? 0 : patternMix(type, size, x, y, z);
    if (mix > 0) {
      r += (patternRgb[0] - r) * mix;
      g += (patternRgb[1] - g) * mix;
      b += (patternRgb[2] - b) * mix;
    }
    if (body) {
      for (const decal of decals) {
        for (const copy of decal.copies) {
          const uv = stickerUv(decal.sticker, plan.bounds, x, y, z, copy);
          if (!uv) continue;
          const n = i * 3;
          if (!stickerFaces(decal.sticker, normals[n]!, normals[n + 1]!, normals[n + 2]!, copy))
            continue;
          const column = Math.min(STICKER_MASK_SIZE - 1, Math.floor(uv[0] * STICKER_MASK_SIZE));
          const row = Math.min(STICKER_MASK_SIZE - 1, Math.floor((1 - uv[1]) * STICKER_MASK_SIZE));
          const alpha =
            (decal.mask[(row * STICKER_MASK_SIZE + column) * 4 + 3]! / 255) * decal.sticker.opacity;
          if (alpha <= 0) continue;
          r += (decal.rgb[0] - r) * alpha;
          g += (decal.rgb[1] - g) * alpha;
          b += (decal.rgb[2] - b) * alpha;
        }
      }
    }
    const shade = zone ? shades[i]! / 255 : 1;
    color[at] = r * shade;
    color[at + 1] = g * shade;
    color[at + 2] = b * shade;
    if (orm && zone) {
      orm[at + 1] = zone.roughness;
      orm[at + 2] = zone.metalness;
    }
  }
}

function dataTexture(pixels: Uint8ClampedArray, like: Texture): DataTexture {
  const texture = new DataTexture(new Uint8Array(pixels), SIZE, SIZE, RGBAFormat, UnsignedByteType);
  texture.colorSpace = like.colorSpace;
  texture.flipY = false;
  texture.wrapS = like.wrapS;
  texture.wrapT = like.wrapT;
  texture.anisotropy = like.anisotropy;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

/**
 * Aplica (ou remove, com `null`) a pintura livre num kart. As texturas compostas
 * são do kart: criadas na primeira pintura e reescritas no lugar nas seguintes.
 * @param original atlas de cor de fábrica do modelo
 * @param rimColor cor do aro escolhido no catálogo (`null` = aro original)
 */
export function paintKart(
  kart: Group,
  material: MeshStandardMaterial,
  original: Texture,
  paint: KartPaint | null,
  rimColor: string | null = null,
): void {
  let layer = kart.userData.paintLayer as PaintLayer | undefined;
  if (!paint) {
    if (layer) material.roughnessMap = material.metalnessMap = material.aoMap = layer.originalOrm;
    return;
  }
  const originalOrm = layer ? layer.originalOrm : material.roughnessMap;
  let plan = plans.get(original);
  if (!plan) {
    plan = buildPlan(kart, original, originalOrm);
    plans.set(original, plan);
  }
  if (!layer) {
    layer = {
      color: dataTexture(plan.color, original),
      orm: plan.orm && originalOrm ? dataTexture(plan.orm, originalOrm) : null,
      originalOrm,
    };
    kart.userData.paintLayer = layer;
    kart.userData.paintBounds = plan.bounds;
  }
  compose(
    plan,
    paint,
    rimColor,
    layer.color.image.data as Uint8Array,
    (layer.orm?.image.data as Uint8Array | undefined) ?? null,
  );
  layer.color.needsUpdate = true;
  material.map = layer.color;
  if (layer.orm) {
    layer.orm.needsUpdate = true;
    material.roughnessMap = material.metalnessMap = material.aoMap = layer.orm;
  }
  material.needsUpdate = true;
}
