import type { BufferGeometry } from 'three';
import { LatheGeometry, Matrix4, Vector2, Vector3 } from 'three';

/** Sobrescreve o V do UV com a altura normalizada (0 na base, 1 no topo). */
function uvByHeight(geometry: BufferGeometry, yMin: number, yMax: number): void {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    const v = (position.getY(i) - yMin) / (yMax - yMin);
    uv.setY(i, Math.min(1, Math.max(0, v)));
  }
}

/**
 * Sólido de revolução em torno de Y a partir de um perfil [raio, altura].
 * O U do UV vale 0,5 na frente (+Z), 0,75 no lado +X e 0/1 nas costas, para
 * a emenda da textura ficar atrás. `depth` achata no eixo Z (corpo elíptico).
 */
export function latheSolid(
  profile: readonly (readonly [radius: number, y: number])[],
  segments = 28,
  depth = 1,
): BufferGeometry {
  const points = profile.map(([radius, y]) => new Vector2(radius, y));
  const geometry = new LatheGeometry(points, segments, Math.PI);
  const ys = profile.map(([, y]) => y);
  uvByHeight(geometry, Math.min(...ys), Math.max(...ys));
  if (depth !== 1) {
    geometry.scale(1, 1, depth);
    geometry.computeVertexNormals();
  }
  return geometry;
}

/**
 * Segmento de membro: cápsula afunilada de y = 0 (raio r0) a y = length
 * (raio r1), com as pontas arredondadas servindo de articulação.
 */
export function limbGeometry(
  length: number,
  r0: number,
  r1: number,
  segments = 14,
): BufferGeometry {
  const profile: [number, number][] = [];
  const cap = 5;
  for (let i = 0; i <= cap; i++) {
    const angle = (-Math.PI / 2) * (1 - i / cap);
    profile.push([Math.cos(angle) * r0, Math.sin(angle) * r0]);
  }
  for (let i = 0; i <= cap; i++) {
    const angle = (Math.PI / 2) * (i / cap);
    profile.push([Math.cos(angle) * r1, length + Math.sin(angle) * r1]);
  }
  const geometry = new LatheGeometry(
    profile.map(([radius, y]) => new Vector2(Math.max(radius, 0), y)),
    segments,
    Math.PI,
  );
  uvByHeight(geometry, 0, length);
  return geometry;
}

const scratchDir = new Vector3();
const scratchPole = new Vector3();

/**
 * Cinemática inversa de dois ossos: dado o início `root`, o alvo `target` e os
 * comprimentos, calcula a articulação do meio (cotovelo/joelho) dobrando na
 * direção de `pole`. Se o alvo estiver fora de alcance, o membro estica até onde dá.
 */
export function solveTwoBone(
  root: Vector3,
  target: Vector3,
  length1: number,
  length2: number,
  pole: Vector3,
  outMid: Vector3,
  outEnd: Vector3,
): void {
  scratchDir.subVectors(target, root);
  const reach = length1 + length2 - 1e-4;
  const distance = Math.min(Math.max(scratchDir.length(), 1e-4), reach);
  scratchDir.normalize();
  const along = (length1 * length1 - length2 * length2 + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, length1 * length1 - along * along));
  scratchPole.copy(pole).addScaledVector(scratchDir, -pole.dot(scratchDir));
  if (scratchPole.lengthSq() < 1e-8) scratchPole.set(0, 0, 1);
  scratchPole.normalize();
  outMid.copy(root).addScaledVector(scratchDir, along).addScaledVector(scratchPole, height);
  outEnd.copy(root).addScaledVector(scratchDir, distance);
}

const basisX = new Vector3();
const basisY = new Vector3();
const basisZ = new Vector3();

/**
 * Matriz que leva um segmento modelado ao longo de +Y até a reta `from`→`to`,
 * com o +X local apontando o mais perto possível de `side` (fixa o giro em
 * torno do próprio eixo, para a textura ficar no lugar certo).
 */
export function segmentMatrix(
  from: Vector3,
  to: Vector3,
  side: Vector3,
  out = new Matrix4(),
): Matrix4 {
  basisY.subVectors(to, from).normalize();
  basisX.copy(side).addScaledVector(basisY, -side.dot(basisY));
  if (basisX.lengthSq() < 1e-8) basisX.set(1, 0, 0).addScaledVector(basisY, -basisY.x);
  basisX.normalize();
  basisZ.crossVectors(basisX, basisY);
  return out.makeBasis(basisX, basisY, basisZ).setPosition(from);
}
