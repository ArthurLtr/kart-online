import {
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Side, Track } from '@kart/shared';
import { frameAt, pointAt, pointAtSample } from '@kart/shared';
import type { ProfilePoint } from './ribbon';
import { loopRibbon } from './ribbon';

function barrierAt(track: Track, index: number, side: Side): number {
  const n = track.samples.length;
  const i = ((index % n) + n) % n;
  return (side === 1 ? track.barrierRight[i] : track.barrierLeft[i]) as number;
}

/** Guard-rail metálico: lâmina em W dos dois lados da pista, com postes. */
function guardRails(track: Track): Group {
  const group = new Group();
  group.name = 'guard_rails';

  // Perfil em W (duas ondas viradas para a pista): [recuo, altura].
  const wave: readonly (readonly [number, number])[] = [
    [0, 0.3],
    [0.035, 0.33],
    [0.07, 0.385],
    [0.035, 0.44],
    [0, 0.465],
    [0.035, 0.49],
    [0.07, 0.545],
    [0.035, 0.6],
    [0, 0.63],
  ];
  const blade = (side: Side) =>
    loopRibbon(track, (index) => {
      const base = barrierAt(track, index, side);
      const points = wave.map(([inset, height]): ProfilePoint => [side * (base - inset), height]);
      // d precisa ser crescente; em paredes verticais vários pontos empatam, o que é aceito.
      return side === 1 ? [...points].reverse() : points;
    });
  const merged = mergeGeometries([blade(-1), blade(1)], false);
  if (!merged) throw new Error('falha ao mesclar o guard-rail');
  const metal = new MeshStandardMaterial({
    color: 0xb9bdc4,
    metalness: 0.85,
    roughness: 0.38,
    side: DoubleSide,
  });
  const blades = new Mesh(merged, metal);
  blades.name = 'guard_rail_blades';
  blades.castShadow = true;
  blades.receiveShadow = true;

  const spacing = 4;
  const count = Math.floor(track.samples.length / spacing) * 2;
  const posts = new InstancedMesh(
    new RoundedBoxGeometry(0.1, 0.72, 0.14, 3, 0.03),
    new MeshStandardMaterial({ color: 0x8d9198, metalness: 0.8, roughness: 0.5 }),
    count,
  );
  posts.name = 'guard_rail_posts';
  const dummy = new Object3D();
  let instance = 0;
  for (let index = 0; index + spacing <= track.samples.length; index += spacing) {
    for (const side of [-1, 1] as const) {
      const p = pointAtSample(track, index, side * (barrierAt(track, index, side) + 0.08));
      const sample = track.samples[index];
      if (!sample) continue;
      dummy.position.set(p.x, p.y + 0.34, p.z);
      dummy.rotation.set(0, Math.atan2(sample.fx, sample.fz), 0);
      dummy.updateMatrix();
      posts.setMatrixAt(instance++, dummy.matrix);
    }
  }
  posts.count = instance;
  posts.castShadow = true;

  group.add(blades, posts);
  return group;
}

/** Muro de pneus empilhados na frente do guard-rail, do lado de fora das curvas fechadas. */
function tireWalls(track: Track): InstancedMesh {
  // Seção de um pneu deitado (anel de borda arredondada), torneada em volta do eixo Y.
  const profile: Vector2[] = [];
  const innerRadius = 0.17;
  const outerRadius = 0.3;
  const halfHeight = 0.1;
  const round = 0.05;
  const corner = (cx: number, cy: number, start: number): void => {
    for (let i = 0; i <= 2; i++) {
      const angle = start + (i / 2) * (Math.PI / 2);
      profile.push(new Vector2(cx + Math.cos(angle) * round, cy + Math.sin(angle) * round));
    }
  };
  corner(innerRadius + round, -halfHeight + round, Math.PI);
  corner(outerRadius - round, -halfHeight + round, -Math.PI / 2);
  corner(outerRadius - round, halfHeight - round, 0);
  corner(innerRadius + round, halfHeight - round, Math.PI / 2);
  profile.push(profile[0] as Vector2);
  // São mais de mil pneus: poucos segmentos por pneu para caber no orçamento de triângulos.
  const geometry = new LatheGeometry(profile, 10);

  const spacing = 0.62;
  const stackHeight = 3;
  const placements: { x: number; y: number; z: number; stack: number }[] = [];
  let stack = 0;
  for (const zone of track.tireWalls) {
    const from = zone.from * track.step;
    const to = zone.to * track.step;
    for (let s = from; s <= to; s += spacing) {
      const offset = zone.side * (barrierAt(track, Math.round(s / track.step), zone.side) - 0.42);
      const p = pointAt(track, s, offset);
      for (let level = 0; level < stackHeight; level++) {
        placements.push({ x: p.x, y: p.y + 0.1 + level * 0.2, z: p.z, stack });
      }
      stack++;
    }
  }

  const mesh = new InstancedMesh(
    geometry,
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }),
    placements.length,
  );
  mesh.name = 'tire_walls';
  const dummy = new Object3D();
  const black = new Color(0x17171a);
  const red = new Color(0xb7201c);
  const white = new Color(0xe9e9e4);
  placements.forEach((placement, i) => {
    dummy.position.set(placement.x, placement.y, placement.z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    // Faixas pintadas a cada poucos pneus, como nos kartódromos.
    const band = Math.floor(placement.stack / 4) % 6;
    mesh.setColorAt(i, band === 0 ? red : band === 3 ? white : black);
  });
  // Só recebem sombra: projetá-la dobraria o custo e mal aparece junto ao guard-rail.
  mesh.receiveShadow = true;
  return mesh;
}

export interface StartGantry {
  group: Group;
  /** Acende as `count` primeiras luzes (0 a 5). */
  setLights(count: number): void;
}

/** Pórtico sobre a pista com o semáforo de 5 luzes voltado para o grid. */
function startGantry(track: Track): StartGantry {
  const group = new Group();
  group.name = 'start_gantry';

  const s = 8;
  const frame = frameAt(track, s);
  const base = pointAt(track, s, 0);
  group.position.set(base.x, base.y, base.z);
  // No espaço local: Z = sentido da corrida, +X = esquerda do piloto.
  group.rotation.y = Math.atan2(frame.fx, frame.fz);

  const span = track.halfWidth + 2.2;
  const height = 6;
  const arch = (z: number): TubeGeometry =>
    new TubeGeometry(
      new CatmullRomCurve3(
        [
          new Vector3(-span, -0.2, z),
          new Vector3(-span, height - 1.4, z),
          new Vector3(-span + 1.2, height, z),
          new Vector3(span - 1.2, height, z),
          new Vector3(span, height - 1.4, z),
          new Vector3(span, -0.2, z),
        ],
        false,
        'catmullrom',
        0.2,
      ),
      96,
      0.13,
      10,
    );
  const brace = (x: number): TubeGeometry =>
    new TubeGeometry(
      new CatmullRomCurve3([new Vector3(x, height, -0.45), new Vector3(x, height, 0.45)]),
      2,
      0.07,
      8,
    );
  const braces: TubeGeometry[] = [];
  for (let x = -span + 1.6; x <= span - 1.6; x += 1.7) braces.push(brace(x));
  const structureGeometry = mergeGeometries([arch(-0.45), arch(0.45), ...braces], false);
  if (!structureGeometry) throw new Error('falha ao mesclar o pórtico');
  const structure = new Mesh(
    structureGeometry,
    new MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.7, roughness: 0.45 }),
  );
  structure.castShadow = true;

  const panel = new Mesh(
    new RoundedBoxGeometry(5.2, 1.15, 0.3, 4, 0.12),
    new MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.6 }),
  );
  panel.position.set(0, height - 0.95, -0.62);
  panel.castShadow = true;

  const lights: MeshStandardMaterial[] = [];
  const lens = new SphereGeometry(0.34, 24, 16).scale(1, 1, 0.35);
  for (let i = 0; i < 5; i++) {
    const material = new MeshStandardMaterial({
      color: 0x2a0606,
      emissive: 0xff1a12,
      emissiveIntensity: 0,
      roughness: 0.25,
    });
    const light = new Mesh(lens, material);
    light.name = `start_light_${i}`;
    light.position.set((i - 2) * 0.95, height - 0.95, -0.78);
    lights.push(material);
    group.add(light);
  }

  group.add(structure, panel);
  return {
    group,
    setLights(count) {
      lights.forEach((material, i) => {
        // Acima de 1 em HDR: é o que faz a luz acesa entrar no bloom.
        material.emissiveIntensity = i < count ? 5 : 0;
      });
    },
  };
}

export interface Barriers {
  group: Group;
  gantry: StartGantry;
}

export function createBarriers(track: Track): Barriers {
  const group = new Group();
  group.name = 'barriers';
  const gantry = startGantry(track);
  group.add(guardRails(track), tireWalls(track), gantry.group);
  return { group, gantry };
}
