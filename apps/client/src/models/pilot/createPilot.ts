import type { BufferGeometry } from 'three';
import {
  BufferAttribute,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pilotGear } from './gear';
import { latheSolid, limbGeometry, segmentMatrix, solveTwoBone } from './geometry';

/** Medidas de um adulto de ~1,76 m, em metros. */
export const BODY = {
  hipHalfWidth: 0.095,
  shoulderHalfWidth: 0.19,
  /** Altura do ombro acima do quadril, no eixo do tronco. */
  shoulderHeight: 0.48,
  /** Centro da cabeça acima do quadril. */
  headHeight: 0.73,
  thigh: 0.43,
  shin: 0.44,
  upperArm: 0.29,
  forearm: 0.26,
  hand: 0.12,
  foot: 0.19,
  /** Altura do quadril em pé. */
  standingHip: 0.95,
  ankleHeight: 0.085,
} as const;

/** Nomes dos nós do piloto (contrato usado pelo PilotRig e pelos cosméticos). */
export const PILOT_PARTS = {
  upperBody: 'pilot_upper_body',
  torso: 'pilot_torso',
  headMount: 'pilot_head_mount',
  legs: 'pilot_legs',
  boots: 'pilot_boots',
  upperArmLeft: 'pilot_upper_arm_l',
  upperArmRight: 'pilot_upper_arm_r',
  forearmLeft: 'pilot_forearm_l',
  forearmRight: 'pilot_forearm_r',
  gloveLeft: 'pilot_glove_l',
  gloveRight: 'pilot_glove_r',
} as const;

function merge(geometries: BufferGeometry[]): BufferGeometry {
  const mixed = new Set(geometries.map((g) => g.index !== null)).size > 1;
  const sources = mixed ? geometries.map((g) => (g.index ? g.toNonIndexed() : g)) : geometries;
  const merged = mergeGeometries(sources, false);
  if (!merged) throw new Error('falha ao mesclar geometrias do piloto');
  for (const geometry of new Set([...geometries, ...sources])) geometry.dispose();
  return merged;
}

function tint(geometry: BufferGeometry, color: Color): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

/** Tronco: quadril, cintura, peito, ombros arredondados, gola e pescoço. */
function torsoGeometry(): BufferGeometry {
  const body = latheSolid(
    [
      [0, -0.115],
      [0.09, -0.105],
      [0.15, -0.06],
      [0.168, 0],
      [0.158, 0.1],
      [0.152, 0.17],
      [0.166, 0.28],
      [0.182, 0.38],
      [0.176, 0.445],
      [0.13, 0.5],
      [0.072, 0.535],
      [0.062, 0.585],
      [0.06, 0.66],
      [0, 0.665],
    ],
    32,
    0.64,
  );
  // Os ombros reaproveitam a pala do tronco: UV fixo na faixa da pala.
  const shoulder = (side: number): BufferGeometry => {
    const ball = new SphereGeometry(0.078, 16, 12).translate(
      side * BODY.shoulderHalfWidth,
      BODY.shoulderHeight - 0.01,
      0,
    );
    const uv = ball.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, side > 0 ? 0.75 : 0.25, 0.7);
    return ball;
  };
  return merge([body, shoulder(1), shoulder(-1)]);
}

const GLOVE_MAIN = new Color(1, 1, 1);
const GLOVE_TRIM = new Color(0.2, 0.2, 0.22);
/** Acima do tornozelo a bota passa a seguir a canela; a transição acaba nesta altura. */
const SHAFT_BLEND = 0.075;
/** Alargamento do cano para a perna entrar nele. */
const SHAFT_WIDEN = 1.12;

const smooth = (t: number): number => {
  const k = Math.min(Math.max(t, 0), 1);
  return k * k * (3 - 2 * k);
};

/** Matriz do espaço da bota (Y para cima, Z para o bico) com a origem em `origin`. */
function shoeFrame(origin: Vector3, up: Vector3, toe: Vector3, upFirst: boolean): Matrix4 {
  const y = up.clone().normalize();
  const z = toe.clone().normalize();
  if (upFirst) z.addScaledVector(y, -z.dot(y)).normalize();
  else y.addScaledVector(z, -y.dot(z)).normalize();
  return new Matrix4().makeBasis(new Vector3().crossVectors(y, z), y, z).setPosition(origin);
}

/**
 * Dobra a bota rígida no tornozelo: do tornozelo para baixo segue o pé, o cano
 * segue a canela (e é alargado para envolvê-la), com transição suave entre os dois.
 */
function fitShoe(source: BufferGeometry, foot: Matrix4, shin: Matrix4): BufferGeometry {
  const geometry = source.clone();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const a = new Vector3();
  const b = new Vector3();
  for (let i = 0; i < position.count; i++) {
    a.fromBufferAttribute(position, i);
    const weight = smooth(a.y / SHAFT_BLEND);
    const widen = 1 + (SHAFT_WIDEN - 1) * weight;
    b.set(a.x * widen, a.y, a.z * widen).applyMatrix4(shin);
    a.applyMatrix4(foot).lerp(b, weight);
    position.setXYZ(i, a.x, a.y, a.z);
    a.fromBufferAttribute(normal, i);
    b.copy(a).transformDirection(shin);
    a.transformDirection(foot).lerp(b, weight).normalize();
    normal.setXYZ(i, a.x, a.y, a.z);
  }
  return geometry;
}

/**
 * Mão enluvada, de y = 0 (punho) a BODY.hand. Com o modelo de referencias/
 * carregado usa a luva modelada (o tecido principal recebe a cor do cosmético e
 * os painéis ficam escuros); sem ele, punho largo e mão fechada. Palma para +Z.
 * @param side 0 = esquerda, 1 = direita
 */
function gloveGeometry(side: 0 | 1): BufferGeometry {
  const gear = pilotGear();
  if (gear) {
    const { main, trim } = gear.gloves[side];
    return merge([tint(main.clone(), GLOVE_MAIN), tint(trim.clone(), GLOVE_TRIM)]);
  }
  // Polegar em -X na mão esquerda e em +X na direita (palma para +Z).
  const thumbSide = side === 0 ? -1 : 1;
  const cuff = latheSolid(
    [
      [0, -0.055],
      [0.05, -0.05],
      [0.052, -0.02],
      [0.044, 0.015],
      [0, 0.02],
    ],
    14,
  );
  const hand = limbGeometry(BODY.hand - 0.04, 0.043, 0.04, 14);
  const thumb = limbGeometry(0.045, 0.019, 0.016, 8)
    .rotateZ(-0.9 * thumbSide)
    .translate(0.035 * thumbSide, 0.03, 0);
  return merge([cuff, hand, thumb]);
}

export interface LegPose {
  hips: readonly [Vector3, Vector3];
  ankles: readonly [Vector3, Vector3];
  toes: readonly [Vector3, Vector3];
  /** Direção para onde os joelhos dobram, por perna. */
  kneePoles: readonly [Vector3, Vector3];
}

const kneeScratch = new Vector3();
const endScratch = new Vector3();
const sideScratch = new Vector3();
const matrixScratch = new Matrix4();

/**
 * Pernas e botas numa pose fixa, já mescladas: um mesh para o macacão e um
 * para as botas. As pernas não se mexem durante a corrida, então isto custa
 * 2 draw calls em vez de 8.
 */
export function buildLowerBody(
  pose: LegPose,
  bootColor: Color,
  soleColor: Color,
): { legs: BufferGeometry; boots: BufferGeometry } {
  const legParts: BufferGeometry[] = [];
  const bootParts: BufferGeometry[] = [];

  for (const index of [0, 1] as const) {
    const outward = index === 0 ? 1 : -1; // índice 0 = perna esquerda (+X)
    const hip = pose.hips[index];
    const ankle = pose.ankles[index];
    const toe = pose.toes[index];
    solveTwoBone(hip, ankle, BODY.thigh, BODY.shin, pose.kneePoles[index], kneeScratch, endScratch);
    const knee = kneeScratch.clone();
    const foot = endScratch.clone();
    sideScratch.set(outward, 0, 0);

    const thigh = limbGeometry(BODY.thigh, 0.088, 0.066).applyMatrix4(
      segmentMatrix(hip, knee, sideScratch, matrixScratch),
    );
    const gear = pilotGear();
    // Com a bota modelada a perna afina para entrar no cano.
    const shin = limbGeometry(BODY.shin, 0.064, gear ? 0.032 : 0.05).applyMatrix4(
      segmentMatrix(knee, foot, sideScratch, matrixScratch),
    );
    // A textura da perna corre do quadril (v = 0) ao tornozelo (v = 1).
    const thighUv = thigh.getAttribute('uv');
    for (let i = 0; i < thighUv.count; i++) thighUv.setY(i, thighUv.getY(i) * 0.5);
    const shinUv = shin.getAttribute('uv');
    for (let i = 0; i < shinUv.count; i++) shinUv.setY(i, 0.5 + shinUv.getY(i) * 0.5);
    legParts.push(thigh, shin);

    const toeDirection = toe.clone().sub(foot).normalize();
    const footEnd = foot.clone().addScaledVector(toeDirection, BODY.foot);
    // +X local do pé = "para cima" do pé (perpendicular à sola).
    const footUp = new Vector3().subVectors(knee, foot).normalize();
    const footMatrix = segmentMatrix(foot, footEnd, footUp, new Matrix4());
    if (gear) {
      // Bota modelada: o pé dela segue o pé e o cano segue a canela.
      const shoe = gear.shoes[index];
      const onFoot = shoeFrame(foot, footUp, toeDirection, false);
      const onShin = shoeFrame(foot, footUp, toeDirection, true);
      bootParts.push(
        tint(fitShoe(shoe.upper, onFoot, onShin), bootColor),
        tint(fitShoe(shoe.sole, onFoot, onShin), soleColor),
      );
      continue;
    }
    // Bota: cano acompanhando a canela, pé e sola.
    const shaftStart = foot.clone().lerp(knee, 0.3);
    const shaft = limbGeometry(shaftStart.distanceTo(foot), 0.062, 0.058).applyMatrix4(
      segmentMatrix(shaftStart, foot, sideScratch, matrixScratch),
    );
    const upper = limbGeometry(BODY.foot, 0.052, 0.044).scale(0.85, 1, 1).applyMatrix4(footMatrix);
    const sole = new RoundedBoxGeometry(0.03, BODY.foot + 0.09, 0.1, 3, 0.012)
      .translate(-0.052, BODY.foot / 2, 0)
      .applyMatrix4(footMatrix);
    bootParts.push(tint(shaft, bootColor), tint(upper, bootColor), tint(sole, soleColor));
  }

  return { legs: merge(legParts), boots: merge(bootParts) };
}

/**
 * Piloto procedural com proporções humanas, seguindo as imagens de referência
 * (macacão de gola alta, luvas de punho largo, botas de cano médio).
 *
 * Contrato: pivô no chão entre os pés quando em pé; sentado, a origem coincide
 * com a do kart. Frente para +Z. Os nós têm os nomes de PILOT_PARTS; a pose e
 * as animações são do PilotRig, e as cores, de cosmetics/apply.
 */
export function createPilot(): Group {
  const root = new Group();
  root.name = 'pilot';

  const fabric = (): MeshPhysicalMaterial =>
    new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.82, sheen: 0.5, sheenRoughness: 0.6 });
  const suitTorso = fabric();
  const suitArm = fabric();
  const suitLeg = fabric();
  const gloveMaterial = new MeshStandardMaterial({
    color: 0x15171b,
    roughness: 0.7,
    vertexColors: pilotGear() !== null,
    // A luva modelada é tecido de uma face só: desenha os dois lados.
    side: pilotGear() ? DoubleSide : FrontSide,
  });
  const bootMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  suitTorso.name = 'suit_torso';
  suitArm.name = 'suit_arm';
  suitLeg.name = 'suit_leg';
  gloveMaterial.name = 'gloves';
  bootMaterial.name = 'boots';

  const upperBody = new Group();
  upperBody.name = PILOT_PARTS.upperBody;
  const torso = new Mesh(torsoGeometry(), suitTorso);
  torso.name = PILOT_PARTS.torso;
  torso.castShadow = true;
  const headMount = new Group();
  headMount.name = PILOT_PARTS.headMount;
  headMount.position.set(0, BODY.headHeight, 0.015);
  upperBody.add(torso, headMount);

  const legs = new Mesh<BufferGeometry>(undefined, suitLeg);
  legs.name = PILOT_PARTS.legs;
  legs.castShadow = true;
  const boots = new Mesh<BufferGeometry>(undefined, bootMaterial);
  boots.name = PILOT_PARTS.boots;

  const upperArmGeometry = limbGeometry(BODY.upperArm, 0.062, 0.05);
  // Com a luva modelada o punho afina para entrar no cano dela.
  const forearmGeometry = limbGeometry(BODY.forearm, 0.048, pilotGear() ? 0.019 : 0.04);
  // No antebraço a textura continua de onde o braço parou (v de 0,5 a 1).
  const upperUv = upperArmGeometry.getAttribute('uv');
  for (let i = 0; i < upperUv.count; i++) upperUv.setY(i, upperUv.getY(i) * 0.5);
  const foreUv = forearmGeometry.getAttribute('uv');
  for (let i = 0; i < foreUv.count; i++) foreUv.setY(i, 0.5 + foreUv.getY(i) * 0.5);
  const gloveLeft = gloveGeometry(0);
  const gloveRight = gloveGeometry(1);

  const limb = (name: string, geometry: BufferGeometry, material: MeshStandardMaterial): Mesh => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  };
  root.add(
    upperBody,
    legs,
    boots,
    limb(PILOT_PARTS.upperArmLeft, upperArmGeometry, suitArm),
    limb(PILOT_PARTS.upperArmRight, upperArmGeometry, suitArm),
    limb(PILOT_PARTS.forearmLeft, forearmGeometry, suitArm),
    limb(PILOT_PARTS.forearmRight, forearmGeometry, suitArm),
    limb(PILOT_PARTS.gloveLeft, gloveLeft, gloveMaterial),
    limb(PILOT_PARTS.gloveRight, gloveRight, gloveMaterial),
  );
  root.traverse((node) => {
    if (node instanceof Mesh) node.receiveShadow = true;
  });
  return root;
}
