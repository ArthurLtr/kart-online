import {
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Lugar do pódio: gramado entre a reta principal e a arquibancada, de frente para a pista. */
export const PODIUM_POSITION = { x: 12, z: -11.5 };

/** Degraus do pódio no espaço local (X para os lados, +Z = frente, virada para a pista). */
export const PODIUM_STEPS = [
  { place: 1, x: 0, height: 0.95 },
  { place: 2, x: 1.45, height: 0.65 },
  { place: 3, x: -1.45, height: 0.42 },
] as const;

function numberTexture(place: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D indisponível');
  ctx.fillStyle = '#f4f4f0';
  ctx.font = '900 104px system-ui, "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(place), 64, 70);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Pódio 1-2-3: três blocos de cantos arredondados com o número na frente. */
export function createPodium(): Group {
  const group = new Group();
  group.name = 'podium';
  group.position.set(PODIUM_POSITION.x, 0, PODIUM_POSITION.z);
  const colors = { 1: 0xd9a520, 2: 0xaab2bd, 3: 0xb5743a } as const;
  for (const step of PODIUM_STEPS) {
    const block = new Mesh(
      new RoundedBoxGeometry(1.4, step.height, 1.3, 4, 0.06).translate(step.x, step.height / 2, 0),
      new MeshStandardMaterial({ color: colors[step.place], roughness: 0.35, metalness: 0.55 }),
    );
    block.castShadow = true;
    block.receiveShadow = true;
    const size = Math.min(0.5, step.height * 0.75);
    const label = new Mesh(
      new PlaneGeometry(size, size).translate(step.x, step.height / 2, 0.656),
      new MeshStandardMaterial({
        map: numberTexture(step.place),
        transparent: true,
        roughness: 0.6,
      }),
    );
    group.add(block, label);
  }
  return group;
}
