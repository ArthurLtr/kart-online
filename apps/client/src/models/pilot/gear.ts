import type { Object3D } from 'three';
import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three';
import { loadGlb } from '../glb';

/**
 * Bota e luva modeladas (convertidas de referencias/ por `pnpm assets`).
 * Só geometria: as cores continuam vindo dos cosméticos. Sem o arquivo, o
 * piloto usa as peças procedurais.
 */
export interface PilotGear {
  /** Bota por pé (0 = esquerdo). Origem no tornozelo, sobre o eixo do cano; +Y para cima, +Z para o bico. */
  shoes: readonly [ShoeParts, ShoeParts];
  /**
   * Luva por mão (0 = esquerda). Origem no pulso, dedos para +Y, palma para +Z;
   * o polegar fica em -X na esquerda e em +X na direita.
   */
  gloves: readonly [GloveParts, GloveParts];
}
export interface ShoeParts {
  upper: BufferGeometry;
  sole: BufferGeometry;
}
export interface GloveParts {
  main: BufferGeometry;
  trim: BufferGeometry;
}

const GEAR_URL = '/assets/models/pilot_gear.glb';
/** Altura do tornozelo acima da sola da bota modelada (igual a GEAR.ankleHeight no conversor). */
export const SHOE_ANKLE_HEIGHT = 0.07;
let gear: PilotGear | null = null;
let pending: Promise<void> | undefined;

/** As peças já carregadas, ou `null` (ainda não carregou ou o arquivo não existe). */
export const pilotGear = (): PilotGear | null => gear;

/** Posição e normal em Float32, no espaço do arquivo (o GLB guarda quantizado, com escala no nó). */
function plain(root: Object3D, name: string): BufferGeometry {
  const mesh = root.getObjectByName(name);
  if (!(mesh instanceof Mesh)) throw new Error(`pilot_gear.glb sem a peça "${name}"`);
  const source = mesh.geometry as BufferGeometry;
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const positions = new Float32Array(position.count * 3);
  const normals = new Float32Array(position.count * 3);
  const point = new Vector3();
  for (let i = 0; i < position.count; i++) {
    point
      .fromBufferAttribute(position, i)
      .applyMatrix4(mesh.matrixWorld)
      .toArray(positions, i * 3);
    point
      .fromBufferAttribute(normal, i)
      .transformDirection(mesh.matrixWorld)
      .toArray(normals, i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(source.index ? Array.from(source.index.array) : null);
  return geometry;
}

/** Cópia espelhada em X (a peça do outro lado do corpo), com as faces reviradas. */
function mirrored(geometry: BufferGeometry): BufferGeometry {
  const copy = geometry.clone().scale(-1, 1, 1);
  const index = copy.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const second = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, second);
    }
  }
  return copy;
}

/** Carrega as peças uma vez. Nunca rejeita: sem arquivo, `pilotGear()` segue `null`. */
export function loadPilotGear(): Promise<void> {
  pending ??= loadGlb(GEAR_URL)
    .then(({ scene }) => {
      scene.updateMatrixWorld(true);
      const shoe = { upper: plain(scene, 'shoe_upper'), sole: plain(scene, 'shoe_sole') };
      // O arquivo traz a mão esquerda (palma para +Z, polegar para -X); a direita é o espelho.
      const left = { main: plain(scene, 'glove_main'), trim: plain(scene, 'glove_trim') };
      const right = { main: mirrored(left.main), trim: mirrored(left.trim) };
      gear = {
        shoes: [shoe, { upper: mirrored(shoe.upper), sole: mirrored(shoe.sole) }],
        gloves: [left, right],
      };
    })
    .catch(() => {
      gear = null;
    });
  return pending;
}
