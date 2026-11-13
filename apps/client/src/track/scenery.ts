import type { BufferGeometry } from 'three';
import {
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Track } from '@kart/shared';
import { barrierOffset, frameAt, pointAt, projectToTrack } from '@kart/shared';
import { SHORE_Z } from './surface';
import { createRandom, crowdTexture, signTexture } from './textures';

function merged(geometries: BufferGeometry[]): BufferGeometry {
  // Só dá para mesclar se todas forem indexadas ou nenhuma for.
  const mixed = new Set(geometries.map((geometry) => geometry.index !== null)).size > 1;
  const sources = mixed ? geometries.map((g) => (g.index ? g.toNonIndexed() : g)) : geometries;
  const result = mergeGeometries(sources, false);
  if (!result) throw new Error('falha ao mesclar geometrias do cenário');
  for (const geometry of sources) geometry.dispose();
  for (const geometry of geometries) geometry.dispose();
  return result;
}

const concrete = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: 0xc9c7c0, roughness: 0.85 });

// A reta principal corre em +X sobre z = 0. Arquibancada do lado do mar (-Z),
// boxes e torre do lado de dentro (+Z).
const STAND = { x0: -50, length: 110, front: -21, steps: 9, run: 0.9, rise: 0.55, base: 1.3 };
const PITS = { x: 35, z: 26, length: 110, depth: 9, height: 4.6 };
const TOWER = { x: -34, z: 25 };

/** Arquibancada em degraus com cobertura curva e torcida instanciada. */
function grandstand(density: number): Group {
  const group = new Group();
  group.name = 'grandstand';
  const { x0, length, front, steps, run, rise, base } = STAND;
  const depth = steps * run;
  const top = base + (steps - 1) * rise;

  // Perfil lateral (u = afastamento da pista, v = altura), extrudado ao longo da reta.
  const side = new Shape();
  side.moveTo(0, 0);
  side.lineTo(0, base);
  for (let k = 0; k < steps; k++) {
    side.lineTo((k + 1) * run, base + k * rise);
    if (k < steps - 1) side.lineTo((k + 1) * run, base + (k + 1) * rise);
  }
  side.lineTo(depth, top + 1.2);
  side.lineTo(depth + 0.5, top + 1.2);
  side.lineTo(depth + 0.5, 0);
  side.closePath();
  const body = new Mesh(
    new ExtrudeGeometry(side, {
      depth: length,
      bevelEnabled: true,
      bevelSegments: 4,
      bevelSize: 0.05,
      bevelThickness: 0.05,
    })
      // Leva (u, v, extrusão) para (-Z, Y, +X).
      .rotateY(Math.PI / 2)
      .translate(x0, 0, front),
    concrete(),
  );
  body.castShadow = true;
  body.receiveShadow = true;

  // Cobertura: casca curva sobre pilares tubulares.
  const canopyShape = new Shape();
  canopyShape.moveTo(-1.5, top + 4.4);
  canopyShape.quadraticCurveTo(depth * 0.5, top + 6.2, depth + 1.2, top + 4.9);
  canopyShape.lineTo(depth + 1.2, top + 5.15);
  canopyShape.quadraticCurveTo(depth * 0.5, top + 6.5, -1.5, top + 4.65);
  canopyShape.closePath();
  const canopy = new Mesh(
    new ExtrudeGeometry(canopyShape, {
      depth: length + 2,
      curveSegments: 16,
      bevelEnabled: true,
      bevelSegments: 4,
      bevelSize: 0.06,
      bevelThickness: 0.06,
    })
      .rotateY(Math.PI / 2)
      .translate(x0 - 1, 0, front),
    new MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.5, metalness: 0.2 }),
  );
  canopy.castShadow = true;

  const pillars: BufferGeometry[] = [];
  for (let x = x0 + 2; x <= x0 + length - 2; x += (length - 4) / 8) {
    pillars.push(
      new TubeGeometry(
        new CatmullRomCurve3([
          new Vector3(x, 0, front - depth - 0.2),
          new Vector3(x, top + 3, front - depth - 0.2),
          new Vector3(x, top + 5.2, front - depth + 1.6),
          new Vector3(x, top + 5.7, front - depth * 0.45),
        ]),
        24,
        0.16,
        8,
      ),
    );
  }
  const structure = new Mesh(
    merged(pillars),
    new MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.7, roughness: 0.45 }),
  );
  structure.castShadow = true;

  // Torcida: impostores (um plano por pessoa), tingidos por instância.
  const seatSpacing = 0.62;
  const perRow = Math.floor((length - 2) / seatSpacing);
  const crowd = new InstancedMesh(
    new PlaneGeometry(0.52, 0.86),
    new MeshStandardMaterial({
      map: crowdTexture(),
      alphaTest: 0.5,
      roughness: 0.9,
      side: DoubleSide,
    }),
    steps * perRow,
  );
  crowd.name = 'crowd';
  const random = createRandom(7);
  const dummy = new Object3D();
  const color = new Color();
  const shirts = [0xd8322f, 0x2456c9, 0xf2c230, 0xf4f4f0, 0x2f9e58, 0x1c1c22, 0xe97b23];
  let count = 0;
  for (let k = 0; k < steps; k++) {
    for (let i = 0; i < perRow; i++) {
      if (random() > 0.82 * density) continue; // lugares vazios
      dummy.position.set(
        x0 + 1 + i * seatSpacing + (random() - 0.5) * 0.12,
        base + k * rise + 0.45 + random() * 0.06,
        front - (k + 0.55) * run,
      );
      dummy.updateMatrix();
      crowd.setMatrixAt(count, dummy.matrix);
      crowd.setColorAt(count, color.setHex(shirts[Math.floor(random() * shirts.length)] as number));
      count++;
    }
  }
  crowd.count = count;

  group.add(body, canopy, structure, crowd);
  return group;
}

/** Prédio dos boxes com portas de garagem e a torre de cronometragem. */
function pitBuildings(): Group {
  const group = new Group();
  group.name = 'pit_buildings';
  const { x, z, length, depth, height } = PITS;

  const building = new Mesh(
    new RoundedBoxGeometry(length, height, depth, 4, 0.25).translate(x, height / 2, z),
    new MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.8 }),
  );
  const roof = new Mesh(
    new RoundedBoxGeometry(length + 2, 0.45, depth + 3.5, 4, 0.18).translate(
      x,
      height + 0.25,
      z - 1,
    ),
    new MeshStandardMaterial({ color: 0x2f3640, roughness: 0.6, metalness: 0.3 }),
  );

  const doorCount = 12;
  const doors = new InstancedMesh(
    new RoundedBoxGeometry(6.4, 3.3, 0.3, 3, 0.12),
    new MeshStandardMaterial({ color: 0x1d2530, roughness: 0.45, metalness: 0.6 }),
    doorCount,
  );
  doors.name = 'pit_doors';
  const dummy = new Object3D();
  for (let i = 0; i < doorCount; i++) {
    dummy.position.set(x - length / 2 + (i + 0.5) * (length / doorCount), 1.75, z - depth / 2);
    dummy.updateMatrix();
    doors.setMatrixAt(i, dummy.matrix);
  }

  // Torre: fuste arredondado, sala envidraçada e antena torneada.
  const tower = new Mesh(
    new RoundedBoxGeometry(6, 13, 6, 4, 0.4).translate(TOWER.x, 6.5, TOWER.z),
    new MeshStandardMaterial({ color: 0xdfe2e6, roughness: 0.7 }),
  );
  const cabin = new Mesh(
    new RoundedBoxGeometry(8.4, 3, 8.4, 4, 0.5).translate(TOWER.x, 13.6, TOWER.z),
    new MeshPhysicalMaterial({
      color: 0x16324a,
      roughness: 0.08,
      metalness: 0.2,
      clearcoat: 1,
      envMapIntensity: 1.6,
    }),
  );
  const cap = new Mesh(
    new RoundedBoxGeometry(9, 0.5, 9, 4, 0.2).translate(TOWER.x, 15.3, TOWER.z),
    new MeshStandardMaterial({ color: 0x2f3640, roughness: 0.6, metalness: 0.3 }),
  );
  const antenna = new Mesh(
    new LatheGeometry(
      [
        new Vector2(0, 0),
        new Vector2(0.35, 0),
        new Vector2(0.3, 0.3),
        new Vector2(0.09, 0.6),
        new Vector2(0.05, 4.2),
        new Vector2(0, 4.3),
      ],
      16,
    ).translate(TOWER.x, 15.5, TOWER.z),
    new MeshStandardMaterial({ color: 0x8d9198, metalness: 0.8, roughness: 0.4 }),
  );

  group.add(building, roof, doors, tower, cabin, cap, antenna);
  group.traverse((node) => {
    if (node instanceof Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  return group;
}

/** Árvores de copa arredondada espalhadas fora da pista (tronco e copa instanciados). */
function trees(track: Track, density: number): Group {
  const group = new Group();
  group.name = 'trees';
  const random = createRandom(101);
  const spots: { x: number; z: number; scale: number }[] = [];
  const blocked = (x: number, z: number): boolean => {
    if (z < SHORE_Z + 6) return true; // areia e mar
    const nearStand =
      x > STAND.x0 - 12 && x < STAND.x0 + STAND.length + 12 && z < STAND.front + 4 && z > -45;
    const nearPits =
      x > TOWER.x - 14 && x < PITS.x + PITS.length / 2 + 8 && z > PITS.z - 12 && z < PITS.z + 14;
    if (nearStand || nearPits) return true;
    const projection = projectToTrack(track, x, z);
    const side = projection.d >= 0 ? 1 : -1;
    return Math.abs(projection.d) < barrierOffset(track, projection.s, side) + 5;
  };
  for (let attempt = 0; attempt < 4000 && spots.length < Math.round(280 * density); attempt++) {
    const x = -330 + random() * 680;
    const z = SHORE_Z + random() * 330;
    if (!blocked(x, z)) spots.push({ x, z, scale: 0.75 + random() * 0.7 });
  }

  const trunks = new InstancedMesh(
    new LatheGeometry(
      [
        new Vector2(0, 0),
        new Vector2(0.3, 0),
        new Vector2(0.2, 0.5),
        new Vector2(0.15, 2.6),
        new Vector2(0, 2.7),
      ],
      8,
    ),
    new MeshStandardMaterial({ color: 0x5a4332, roughness: 1 }),
    spots.length,
  );
  const crowns = new InstancedMesh(
    new IcosahedronGeometry(1.7, 2),
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
    spots.length,
  );
  const dummy = new Object3D();
  const color = new Color();
  spots.forEach((spot, i) => {
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.scale.setScalar(spot.scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.y = 3.4 * spot.scale;
    dummy.scale.set(spot.scale, spot.scale * (0.8 + random() * 0.25), spot.scale);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    crowns.setColorAt(i, color.setHSL(0.27 + random() * 0.07, 0.5, 0.2 + random() * 0.1));
  });
  trunks.castShadow = crowns.castShadow = true;
  crowns.receiveShadow = true;
  group.add(trunks, crowns);
  return group;
}

/** Postes de iluminação ao longo da reta principal, com a luminária acesa. */
function lightPosts(track: Track): Group {
  const group = new Group();
  group.name = 'light_posts';
  const pole = new TubeGeometry(
    new CatmullRomCurve3([
      new Vector3(0, 0, 0),
      new Vector3(0, 7.2, 0),
      new Vector3(0.5, 8.4, 0),
      new Vector3(2.2, 8.7, 0),
    ]),
    24,
    0.09,
    8,
  );
  const lamp = new RoundedBoxGeometry(1, 0.14, 0.42, 3, 0.06).translate(2.3, 8.62, 0);

  const positions: { s: number; side: -1 | 1 }[] = [];
  for (let s = -110; s <= 160; s += 30) positions.push({ s, side: 1 });
  const poles = new InstancedMesh(
    pole,
    new MeshStandardMaterial({ color: 0x4a4f57, metalness: 0.7, roughness: 0.45 }),
    positions.length,
  );
  const lamps = new InstancedMesh(
    lamp,
    new MeshStandardMaterial({
      color: 0x222222,
      emissive: 0xffe2b0,
      emissiveIntensity: 3,
    }),
    positions.length,
  );
  const dummy = new Object3D();
  positions.forEach(({ s, side }, i) => {
    const frame = frameAt(track, s);
    const p = pointAt(track, s, side * (barrierOffset(track, s, side) + 1.5));
    dummy.position.set(p.x, p.y, p.z);
    // Com esta rotação o +X local é a esquerda do piloto; o braço aponta para a pista.
    dummy.rotation.set(0, Math.atan2(frame.fx, frame.fz) + (side === -1 ? Math.PI : 0), 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    lamps.setMatrixAt(i, dummy.matrix);
  });
  poles.castShadow = true;
  group.add(poles, lamps);
  return group;
}

/** Placas de publicidade (marcas fictícias do jogo) atrás do guard-rail. */
function signs(track: Track): Group {
  const group = new Group();
  group.name = 'signs';
  const boards: { s: number; side: -1 | 1; text: string; bg: string; fg: string }[] = [
    { s: 150, side: 1, text: 'CIRCUITO DA ORLA', bg: '#0f3d8c', fg: '#ffffff' },
    { s: 300, side: -1, text: 'KART ONLINE', bg: '#111111', fg: '#ffd21f' },
    { s: 480, side: -1, text: 'PNEUS MARESIA', bg: '#c4201f', fg: '#ffffff' },
    { s: 640, side: -1, text: 'RÁDIO ORLA FM', bg: '#f4f4f0', fg: '#0f3d8c' },
    { s: 850, side: -1, text: 'OFICINA DO GRID', bg: '#ffd21f', fg: '#111111' },
    { s: 1010, side: -1, text: 'ÓLEO VENTANIA', bg: '#0b6b4a', fg: '#ffffff' },
    { s: 1200, side: -1, text: 'CIRCUITO DA ORLA', bg: '#0f3d8c', fg: '#ffffff' },
  ];

  const width = 9;
  const height = 2.25;
  const radius = 0.25;
  const face = new Shape();
  face.moveTo(-width / 2 + radius, -height / 2);
  face.lineTo(width / 2 - radius, -height / 2);
  face.quadraticCurveTo(width / 2, -height / 2, width / 2, -height / 2 + radius);
  face.lineTo(width / 2, height / 2 - radius);
  face.quadraticCurveTo(width / 2, height / 2, width / 2 - radius, height / 2);
  face.lineTo(-width / 2 + radius, height / 2);
  face.quadraticCurveTo(-width / 2, height / 2, -width / 2, height / 2 - radius);
  face.lineTo(-width / 2, -height / 2 + radius);
  face.quadraticCurveTo(-width / 2, -height / 2, -width / 2 + radius, -height / 2);
  const faceGeometry = new ShapeGeometry(face, 6);
  // UV de 0 a 1 sobre a placa.
  const uv = faceGeometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / width + 0.5, uv.getY(i) / height + 0.5);
  }

  const frameGeometry = merged([
    new RoundedBoxGeometry(width + 0.3, height + 0.3, 0.16, 3, 0.07).translate(0, 2.6, -0.1),
    new CapsuleGeometry(0.1, 2.4, 4, 10).translate(-width / 2 + 1, 1.2, -0.15),
    new CapsuleGeometry(0.1, 2.4, 4, 10).translate(width / 2 - 1, 1.2, -0.15),
  ]);
  const frameMaterial = new MeshStandardMaterial({
    color: 0x2b2f36,
    metalness: 0.6,
    roughness: 0.5,
  });

  for (const board of boards) {
    const frame = frameAt(track, board.s);
    const p = pointAt(
      track,
      board.s,
      board.side * (barrierOffset(track, board.s, board.side) + 2.5),
    );
    const sign = new Group();
    sign.position.set(p.x, p.y, p.z);
    // A face (+Z local) olha para a pista.
    sign.rotation.y =
      Math.atan2(frame.fx, frame.fz) + (board.side === 1 ? Math.PI / 2 : -Math.PI / 2);
    const panel = new Mesh(
      faceGeometry,
      new MeshStandardMaterial({
        map: signTexture(board.text, board.bg, board.fg),
        roughness: 0.55,
      }),
    );
    panel.position.y = 2.6;
    const support = new Mesh(frameGeometry, frameMaterial);
    support.castShadow = true;
    sign.add(support, panel);
    group.add(sign);
  }
  return group;
}

/** `density` (0 a 1) é a fração de árvores e torcida, vinda do preset gráfico. */
export function createScenery(track: Track, density = 1): Group {
  const group = new Group();
  group.name = 'scenery';
  group.add(
    grandstand(density),
    pitBuildings(),
    trees(track, density),
    lightPosts(track),
    signs(track),
  );
  return group;
}
