import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Side, Track } from '@kart/shared';
import type { ProfilePoint } from './ribbon';
import { groundQuad, loopRibbon, ribbonGeometry } from './ribbon';
import {
  asphaltTexture,
  checkerTexture,
  grassTexture,
  gravelTexture,
  rubberAlphaTexture,
  sandTexture,
} from './textures';

/** Onde termina a grama plana e começa a faixa de areia, e onde está o mar. */
export const SHORE_Z = -62;
export const SEA_Z = -84;

const CURB_RED = new Color(0xc4201f);
const CURB_WHITE = new Color(0xf1f1ee);

function merge(geometries: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(geometries, false);
  if (!merged) throw new Error('falha ao mesclar geometrias da pista');
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

function wrapIndex(track: Track, index: number): number {
  const n = track.samples.length;
  return ((index % n) + n) % n;
}

function barrierAt(track: Track, index: number, side: Side): number {
  const i = wrapIndex(track, index);
  return (side === 1 ? track.barrierRight[i] : track.barrierLeft[i]) as number;
}

function asphalt(track: Track): Mesh {
  const half = track.halfWidth;
  const geometry = loopRibbon(track, () => [
    [-half, 0],
    [-half / 2, 0],
    [0, 0],
    [half / 2, 0],
    [half, 0],
  ]);
  const material = new MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.9 });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'asphalt';
  return mesh;
}

/** Borracha escura acumulada no traçado ideal (por dentro das curvas). */
function rubberLine(track: Track): Mesh {
  const n = track.samples.length;
  const raw = track.samples.map((p) => Math.max(-3.4, Math.min(3.4, p.curvature * 220)));
  const offsets = raw.map((_, i) => {
    let sum = 0;
    for (let k = -25; k <= 25; k++) sum += raw[(i + k + n) % n] as number;
    return sum / 51;
  });
  const geometry = loopRibbon(
    track,
    (index) => {
      const center = offsets[wrapIndex(track, index)] as number;
      return [
        [center - 1.3, 0.012],
        [center, 0.012],
        [center + 1.3, 0.012],
      ];
    },
    { uv: 'across' },
  );
  const material = new MeshStandardMaterial({
    color: 0x0c0c0d,
    alphaMap: rubberAlphaTexture(),
    transparent: true,
    opacity: 0.55,
    roughness: 0.75,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'rubber_line';
  return mesh;
}

/** Linhas brancas de borda e marcações do grid de largada. */
function paint(track: Track): Mesh {
  const half = track.halfWidth;
  const lift = 0.015;
  const geometries: BufferGeometry[] = [
    loopRibbon(track, () => [
      [-half + 0.1, lift],
      [-half + 0.25, lift],
    ]),
    loopRibbon(track, () => [
      [half - 0.25, lift],
      [half - 0.1, lift],
    ]),
  ];
  for (const slot of track.grid) {
    // Colchete na frente do bico: uma barra e duas pernas curtas.
    const front = slot.s + 1.75;
    geometries.push(
      groundQuad(track, front, front + 0.12, slot.d - 0.9, slot.d + 0.9),
      groundQuad(track, front - 0.8, front, slot.d - 0.9, slot.d - 0.78),
      groundQuad(track, front - 0.8, front, slot.d + 0.78, slot.d + 0.9),
    );
  }
  const material = new MeshStandardMaterial({
    color: 0xf2f2ee,
    roughness: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const mesh = new Mesh(merge(geometries), material);
  mesh.name = 'track_paint';
  return mesh;
}

function finishLine(track: Track): Mesh {
  const half = track.halfWidth;
  const geometry = ribbonGeometry(track, {
    from: 0,
    rows: 3,
    uv: 'across',
    profile: () => [
      [-half, 0.018],
      [half, 0.018],
    ],
  });
  const map = checkerTexture();
  map.repeat.set(12, 12);
  const material = new MeshStandardMaterial({
    map,
    roughness: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'finish_line';
  return mesh;
}

/** Zebras vermelho/branco com relevo: rampa lateral e blocos abaulados. */
function curbs(track: Track): Mesh {
  const inner = track.halfWidth;
  const width = track.definition.curbWidth;
  const blockRows = 3; // um bloco = 2 m
  const hump = [0.7, 1, 0.7];
  const geometries: BufferGeometry[] = [];

  const n = track.samples.length;
  let block = 0;
  for (let index = 0; index < n; index += blockRows - 1) {
    if ((track.curbCorner[index] as number) < 0) continue;
    if ((track.curbCorner[wrapIndex(track, index + blockRows - 1)] as number) < 0) continue;
    const color = block++ % 2 === 0 ? CURB_RED : CURB_WHITE;
    for (const side of [-1, 1] as const) {
      const geometry = ribbonGeometry(track, {
        from: index,
        rows: blockRows,
        profile: (_, row) => {
          const k = hump[row] as number;
          const points: ProfilePoint[] = [
            [inner, 0.004],
            [inner + width * 0.3, 0.035 * k],
            [inner + width * 0.75, 0.055 * k],
            [inner + width, 0.01],
          ];
          return side === 1
            ? points
            : points.map(([d, lift]): ProfilePoint => [-d, lift]).reverse();
        },
      });
      const count = geometry.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
      geometry.setAttribute('color', new BufferAttribute(colors, 3));
      geometries.push(geometry);
    }
  }
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.65 });
  const mesh = new Mesh(merge(geometries), material);
  mesh.name = 'curbs';
  return mesh;
}

/** Faixa de grama entre o asfalto e a área atrás do guard-rail. */
function verges(track: Track): Mesh {
  const inner = track.halfWidth;
  const sideRibbon = (side: Side): BufferGeometry =>
    loopRibbon(track, (index) => {
      const outer = barrierAt(track, index, side) + 3;
      const points: ProfilePoint[] = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) points.push([inner + ((outer - inner) * i) / steps, -0.004]);
      return side === 1 ? points : points.map(([d, lift]): ProfilePoint => [-d, lift]).reverse();
    });
  const material = new MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
  const mesh = new Mesh(merge([sideRibbon(-1), sideRibbon(1)]), material);
  mesh.name = 'verges';
  return mesh;
}

function gravelTraps(track: Track): Mesh {
  const inner = track.halfWidth + track.definition.curbWidth;
  const geometries = track.gravelTraps.map((zone) =>
    ribbonGeometry(track, {
      from: zone.from,
      rows: Math.floor((zone.to - zone.from) / 2) + 1,
      stride: 2,
      profile: (index, row) => {
        // Afunila nas pontas para a caixa terminar em bico arredondado.
        const rows = Math.floor((zone.to - zone.from) / 2);
        const taper = Math.min(1, Math.sin((Math.PI * row) / rows) * 2.2);
        const outer = inner + (barrierAt(track, index, zone.side) - 1 - inner) * taper;
        const points: ProfilePoint[] = [];
        for (let i = 0; i <= 5; i++) points.push([inner + ((outer - inner) * i) / 5, 0.012]);
        return zone.side === 1
          ? points
          : points.map(([d, lift]): ProfilePoint => [-d, lift]).reverse();
      },
      tile: 3,
    }),
  );
  const material = new MeshStandardMaterial({
    map: gravelTexture(),
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new Mesh(merge(geometries), material);
  mesh.name = 'gravel_traps';
  return mesh;
}

/** Gramado geral (miolo e entorno) e a faixa de areia até o mar. */
function terrain(): Group {
  const group = new Group();
  group.name = 'terrain';

  const grassMap = grassTexture();
  grassMap.repeat.set(450, 250);
  const ground = new Mesh(
    new PlaneGeometry(1800, 1000).rotateX(-Math.PI / 2).translate(0, -0.03, SHORE_Z + 500),
    new MeshStandardMaterial({ map: grassMap, roughness: 1 }),
  );
  ground.name = 'ground';

  const sandMap = sandTexture();
  sandMap.repeat.set(600, 14);
  // Rampa de areia que desce do gramado até abaixo da linha d'água.
  const far = SEA_Z - 30;
  const beachGeometry = new BufferGeometry();
  beachGeometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        -900,
        -0.03,
        SHORE_Z,
        900,
        -0.03,
        SHORE_Z,
        -900,
        -2.2,
        far,
        900,
        -2.2,
        far,
      ]),
      3,
    ),
  );
  beachGeometry.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2),
  );
  beachGeometry.setIndex([0, 1, 2, 1, 3, 2]);
  beachGeometry.computeVertexNormals();
  const beach = new Mesh(beachGeometry, new MeshStandardMaterial({ map: sandMap, roughness: 1 }));
  beach.name = 'beach';

  group.add(ground, beach);
  return group;
}

/** Tudo o que é piso: asfalto, pintura, zebras, grama, brita e terreno. */
export function createSurface(track: Track): Group {
  const group = new Group();
  group.name = 'surface';
  group.add(
    terrain(),
    verges(track),
    gravelTraps(track),
    asphalt(track),
    rubberLine(track),
    curbs(track),
    paint(track),
    finishLine(track),
  );
  group.traverse((node) => {
    if (node instanceof Mesh) node.receiveShadow = true;
  });
  return group;
}

/** Portais de checkpoint, só para depuração (invisíveis no jogo). */
export function createCheckpointGates(track: Track): Group {
  const group = new Group();
  group.name = 'checkpoint_gates';
  group.visible = false;
  const half = track.halfWidth + track.definition.curbWidth;
  track.checkpoints.forEach((checkpoint, i) => {
    const geometry = new PlaneGeometry(half * 2, 3);
    const material = new MeshBasicMaterial({
      color: i === 0 ? 0xffe14a : 0x35d0ff,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: 2,
    });
    const gate = new Mesh(geometry, material);
    gate.position.set(checkpoint.x, checkpoint.y + 1.5, checkpoint.z);
    gate.rotation.y = Math.atan2(checkpoint.fx, checkpoint.fz);
    group.add(gate);
  });
  return group;
}
