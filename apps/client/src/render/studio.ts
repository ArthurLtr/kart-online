import type { Scene } from 'three';
import {
  BackSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SpotLight,
  Vector2,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Altura da plataforma giratória; o que fica sobre ela começa aqui. */
export const TURNTABLE_HEIGHT = 0.14;

/** Estúdio redondo: piso, parede em curva contínua (sem quina) e teto. */
export function createRoom(): Group {
  const group = new Group();
  group.name = 'garage_room';

  const profile: Vector2[] = [new Vector2(0, 0), new Vector2(8.5, 0)];
  for (let i = 1; i <= 12; i++) {
    const angle = (i / 12) * (Math.PI / 2);
    profile.push(new Vector2(8.5 + Math.sin(angle) * 2.5, 2.5 - Math.cos(angle) * 2.5));
  }
  profile.push(new Vector2(11, 6), new Vector2(10.5, 6.6), new Vector2(0, 6.9));
  const shell = new Mesh(
    new LatheGeometry(profile, 72),
    new MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.55, metalness: 0.1, side: BackSide }),
  );
  shell.receiveShadow = true;

  // Luminárias de teto: painéis arredondados acesos (entram no bloom).
  const panels = new InstancedMesh(
    new RoundedBoxGeometry(4.6, 0.12, 0.7, 3, 0.05),
    new MeshStandardMaterial({ color: 0x111111, emissive: 0xfff3df, emissiveIntensity: 2.6 }),
    4,
  );
  const dummy = new Object3D();
  [-3.3, -1.1, 1.1, 3.3].forEach((z, i) => {
    dummy.position.set(0, 5.6, z);
    dummy.updateMatrix();
    panels.setMatrixAt(i, dummy.matrix);
  });

  group.add(shell, panels);
  return group;
}

/** Plataforma giratória: disco chanfrado com um anel de luz na borda. */
export function createTurntable(): Group {
  const group = new Group();
  group.name = 'turntable';
  const radius = 2.5;
  const bevel = 0.04;
  const profile: Vector2[] = [
    new Vector2(0, TURNTABLE_HEIGHT),
    new Vector2(radius - bevel, TURNTABLE_HEIGHT),
  ];
  for (let i = 1; i <= 6; i++) {
    const angle = (i / 6) * (Math.PI / 2);
    profile.push(
      new Vector2(
        radius - bevel + Math.sin(angle) * bevel,
        TURNTABLE_HEIGHT - bevel + Math.cos(angle) * bevel,
      ),
    );
  }
  profile.push(new Vector2(radius, 0));
  const disc = new Mesh(
    new LatheGeometry(profile, 96),
    new MeshStandardMaterial({ color: 0x3b3f47, roughness: 0.3, metalness: 0.6 }),
  );
  disc.receiveShadow = true;

  const ring: Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    ring.push(new Vector2(radius + 0.09 + Math.cos(angle) * 0.03, 0.035 + Math.sin(angle) * 0.03));
  }
  const glow = new Mesh(
    new LatheGeometry(ring, 96),
    new MeshStandardMaterial({ color: 0x101010, emissive: 0x6fd6ff, emissiveIntensity: 3.2 }),
  );
  group.add(disc, glow);
  return group;
}

/** `shadowMapSize` 0 desliga a sombra do refletor principal. */
export function createStudioLights(scene: Scene, shadowMapSize = 2048): void {
  scene.add(new HemisphereLight(0xdfe8ff, 0x2b2620, 0.35));
  const spot = (x: number, y: number, z: number, intensity: number, shadow: boolean): void => {
    const light = new SpotLight(0xfff1dc, intensity, 30, 0.6, 0.6, 1.4);
    light.position.set(x, y, z);
    light.target.position.set(0, 0.6, 0);
    if (shadow && shadowMapSize > 0) {
      light.castShadow = true;
      light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      light.shadow.bias = -0.0005;
      light.shadow.normalBias = 0.02;
      light.shadow.radius = 5;
    }
    scene.add(light, light.target);
  };
  // Intensidades contidas: o branco do macacão não pode passar de 1 e entrar no bloom.
  spot(3.5, 6, 4.5, 95, true); // principal
  spot(-5, 4.2, 2.5, 30, false); // preenchimento
  spot(0, 5, -6, 55, false); // contraluz
}
