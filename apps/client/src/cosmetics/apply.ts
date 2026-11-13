import type { Group, Material, MeshStandardMaterial, Texture } from 'three';
import { CanvasTexture, Color, Mesh } from 'three';
import { KART_PARTS } from '@kart/shared';
import { HELMET_PARTS, helmetPaintTexture } from '../models/helmet/createHelmet';
import { PILOT_PARTS } from '../models/pilot/createPilot';
import type { PilotRig } from '../models/pilot/PilotRig';
import { suitTextures } from '../models/pilot/suitTextures';
import type { Loadout } from './catalog';
import { findDesign } from './catalog';

const KART_PART_NAMES = new Set<string>(Object.values(KART_PARTS));
const liveryCache = new Map<string, Texture>();

/**
 * Troca o azul da pintura original do kart por outra cor, mantendo preto,
 * branco, números e sombreado. O kart inteiro usa um único atlas de textura.
 */
function recolorLivery(original: Texture, hex: string): Texture {
  const cached = liveryCache.get(hex);
  if (cached) return cached;
  const image = original.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2D indisponível');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  const target = new Color(hex).convertLinearToSRGB();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    if (b > r + 40 && b > g + 30) {
      const shade = b / 255; // o azul-escuro do modelo vira um tom escuro da nova cor
      data[i] = target.r * 255 * shade;
      data[i + 1] = target.g * 255 * shade;
      data[i + 2] = target.b * 255 * shade;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.flipY = original.flipY;
  texture.colorSpace = original.colorSpace;
  texture.wrapS = original.wrapS;
  texture.wrapT = original.wrapT;
  texture.anisotropy = original.anisotropy;
  liveryCache.set(hex, texture);
  return texture;
}

function applyLivery(kart: Group, color: string | null): void {
  // Os karts clonados dividem um material; cada kart ganha o seu na primeira troca.
  let paint = kart.userData.paintMaterial as MeshStandardMaterial | undefined;
  let original = kart.userData.originalLivery as Texture | undefined;
  if (!paint) {
    kart.traverse((node) => {
      // Só as peças do kart: o piloto sentado é filho do kart e tem materiais próprios.
      if (!(node instanceof Mesh) || !KART_PART_NAMES.has(node.name)) return;
      const source = node.material as MeshStandardMaterial;
      original ??= source.map ?? undefined;
      paint ??= source.clone();
      node.material = paint;
    });
    kart.userData.paintMaterial = paint;
    kart.userData.originalLivery = original;
  }
  if (!paint || !original) return;
  paint.map = color ? recolorLivery(original, color) : original;
  paint.needsUpdate = true;
}

const WHEEL_PARTS = new Set<string>([
  KART_PARTS.wheelFrontLeft,
  KART_PARTS.wheelFrontRight,
  KART_PARTS.wheelRearLeft,
  KART_PARTS.wheelRearRight,
]);

/**
 * Aros: as quatro rodas ganham um material próprio, tingido. O pneu é preto na
 * textura e continua preto; só o aro (claro) pega a cor.
 */
function applyRims(kart: Group, color: string | null): void {
  const paint = kart.userData.paintMaterial as MeshStandardMaterial | undefined;
  if (!paint) return;
  let wheels = kart.userData.wheelMaterial as MeshStandardMaterial | undefined;
  if (!wheels) {
    if (!color) return;
    const material = paint.clone();
    wheels = material;
    kart.userData.wheelMaterial = material;
    kart.traverse((node) => {
      if (node instanceof Mesh && WHEEL_PARTS.has(node.name)) node.material = material;
    });
  }
  wheels.map = paint.map;
  wheels.color.set(color ?? '#ffffff');
  wheels.needsUpdate = true;
}

function materialOf<T extends Material>(root: Group, part: string): T {
  const node = root.getObjectByName(part);
  if (!(node instanceof Mesh)) throw new Error(`parte "${part}" não encontrada`);
  return node.material as T;
}

export interface Dressable {
  kart?: Group;
  pilot?: PilotRig;
  helmet?: Group;
}

/**
 * Aplica um loadout aos modelos. Mexe só em materiais e texturas; forma,
 * tamanho e colisão ficam intactos (cosmético nunca altera a física).
 * O modelo do capacete é uma troca de malha e fica por conta de quem carrega.
 */
export function applyLoadout(target: Dressable, loadout: Loadout): void {
  if (target.kart) {
    applyLivery(target.kart, findDesign('livery', loadout.livery).color);
    applyRims(target.kart, findDesign('rim', loadout.rim).color);
  }

  if (target.pilot) {
    const root = target.pilot.root;
    const textures = suitTextures(findDesign('suit', loadout.suit));
    const set = (part: string, map: Texture): void => {
      const material = materialOf<MeshStandardMaterial>(root, part);
      material.map = map;
      material.needsUpdate = true;
    };
    set(PILOT_PARTS.torso, textures.torso);
    set(PILOT_PARTS.upperArmLeft, textures.arm);
    set(PILOT_PARTS.legs, textures.leg);

    const gloves = findDesign('gloves', loadout.gloves);
    materialOf<MeshStandardMaterial>(root, PILOT_PARTS.gloveLeft).color.set(gloves.color);

    const boots = findDesign('boots', loadout.boots);
    target.pilot.setBootColors(new Color(boots.color), new Color(boots.sole));
  }

  if (target.helmet) {
    const shell = materialOf<MeshStandardMaterial>(target.helmet, HELMET_PARTS.shell);
    shell.map = helmetPaintTexture(findDesign('helmetPaint', loadout.helmetPaint));
    shell.needsUpdate = true;
    materialOf<MeshStandardMaterial>(target.helmet, HELMET_PARTS.visor).color.set(
      findDesign('visor', loadout.visor).color,
    );
  }
}
