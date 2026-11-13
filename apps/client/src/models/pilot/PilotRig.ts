import type { BufferGeometry, Group, Mesh, Object3D } from 'three';
import { Color, Quaternion, Vector3 } from 'three';
import { BODY, buildLowerBody, PILOT_PARTS } from './createPilot';
import type { LegPose } from './createPilot';
import { solveTwoBone } from './geometry';

export type PilotPose = 'seated' | 'standing' | 'celebrate';

/** Onde o piloto encaixa num kart: quadril, pedais e volante, no espaço do kart. */
export interface Cockpit {
  /** Centro do quadril, sentado. */
  hip: Vector3;
  /** Tornozelos sobre os pedais (esquerdo = +X, direito = -X). */
  ankles: readonly [Vector3, Vector3];
  /** Inclinação do encosto, em radianos (tronco para trás). */
  recline: number;
  steeringCenter: Vector3;
  /** Eixo de giro do volante, apontando para a frente. */
  steeringAxis: Vector3;
  /** Raio em que as mãos seguram o aro. */
  gripRadius: number;
  /** Mesma relação volante/rodas usada pelo KartRig. */
  steeringRatio: number;
}

const UP = new Vector3(0, 1, 0);
const damp = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * Pose e animações procedurais do piloto: braços acompanham o volante, corpo
 * inclina nas curvas, cabeça olha para dentro da curva, comemoração no pódio.
 * É só visual; a física não passa por aqui.
 */
export class PilotRig {
  pose: PilotPose = 'standing';

  private readonly upperBody: Object3D;
  private readonly headMount: Object3D;
  private readonly legs: Mesh<BufferGeometry>;
  private readonly boots: Mesh<BufferGeometry>;
  private readonly arms: { upper: Object3D; fore: Object3D; glove: Object3D; side: 1 | -1 }[];
  private cockpit: Cockpit | undefined;
  private bootColor = new Color(0x141518);
  private soleColor = new Color(0xc8282a);
  private steer = 0;
  private lean = 0;
  private time = 0;

  // Vetores de trabalho, para não alocar a cada quadro.
  private readonly shoulder = new Vector3();
  private readonly wrist = new Vector3();
  private readonly elbow = new Vector3();
  private readonly hand = new Vector3();
  private readonly pole = new Vector3();
  private readonly direction = new Vector3();
  private readonly quaternion = new Quaternion();

  constructor(readonly root: Group) {
    const find = (name: string): Object3D => {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`piloto sem a parte "${name}"`);
      return node;
    };
    this.upperBody = find(PILOT_PARTS.upperBody);
    this.headMount = find(PILOT_PARTS.headMount);
    this.legs = find(PILOT_PARTS.legs) as Mesh<BufferGeometry>;
    this.boots = find(PILOT_PARTS.boots) as Mesh<BufferGeometry>;
    this.arms = [
      {
        upper: find(PILOT_PARTS.upperArmLeft),
        fore: find(PILOT_PARTS.forearmLeft),
        glove: find(PILOT_PARTS.gloveLeft),
        side: 1,
      },
      {
        upper: find(PILOT_PARTS.upperArmRight),
        fore: find(PILOT_PARTS.forearmRight),
        glove: find(PILOT_PARTS.gloveRight),
        side: -1,
      },
    ];
    this.setPose('standing');
  }

  /** Coloca o capacete (ou qualquer acessório de cabeça) no piloto. */
  attachHelmet(helmet: Object3D): void {
    this.headMount.clear();
    this.headMount.add(helmet);
  }

  /** Informa as medidas do cockpit; necessário antes de usar a pose 'seated'. */
  setCockpit(cockpit: Cockpit): void {
    this.cockpit = cockpit;
    if (this.pose === 'seated') this.setPose('seated');
  }

  setBootColors(color: Color, sole: Color): void {
    this.bootColor = color;
    this.soleColor = sole;
    this.rebuildLowerBody();
  }

  setPose(pose: PilotPose): void {
    if (pose === 'seated' && !this.cockpit) throw new Error('setCockpit() antes da pose sentada');
    this.pose = pose;
    this.time = 0;
    this.rebuildLowerBody();
    this.update(0, 0);
  }

  private legPose(): LegPose {
    const w = BODY.hipHalfWidth;
    if (this.pose === 'seated' && this.cockpit) {
      const { hip, ankles } = this.cockpit;
      const toe = (ankle: Vector3): Vector3 => ankle.clone().add(new Vector3(0, 0.6, 0.8));
      return {
        hips: [hip.clone().setX(w), hip.clone().setX(-w)],
        ankles,
        toes: [toe(ankles[0]), toe(ankles[1])],
        // Joelhos para cima e para fora, um de cada lado da coluna de direção.
        kneePoles: [new Vector3(0.5, 1, 0.15), new Vector3(-0.5, 1, 0.15)],
      };
    }
    const ankle = (side: number): Vector3 => new Vector3(side * 0.11, BODY.ankleHeight, 0);
    const toe = (side: number): Vector3 => new Vector3(side * 0.14, BODY.ankleHeight - 0.035, 0.2);
    return {
      hips: [new Vector3(w, BODY.standingHip, 0), new Vector3(-w, BODY.standingHip, 0)],
      ankles: [ankle(1), ankle(-1)],
      toes: [toe(1), toe(-1)],
      kneePoles: [new Vector3(0, 0, 1), new Vector3(0, 0, 1)],
    };
  }

  private rebuildLowerBody(): void {
    const { legs, boots } = buildLowerBody(this.legPose(), this.bootColor, this.soleColor);
    this.legs.geometry?.dispose();
    this.boots.geometry?.dispose();
    this.legs.geometry = legs;
    this.boots.geometry = boots;
  }

  /**
   * @param dt segundos desde a última chamada
   * @param steerAngle ângulo das rodas dianteiras em radianos (positivo = esquerda)
   */
  update(dt: number, steerAngle: number): void {
    this.time += dt;
    this.steer = dt > 0 ? damp(this.steer, steerAngle, 14, dt) : steerAngle;
    // O corpo demora mais que as mãos para acompanhar a curva.
    this.lean = dt > 0 ? damp(this.lean, steerAngle, 4, dt) : steerAngle;

    if (this.pose === 'seated' && this.cockpit) this.updateSeated(this.cockpit);
    else this.updateStanding();

    this.upperBody.updateMatrix();
    for (const arm of this.arms) this.updateArm(arm);
  }

  private updateSeated(cockpit: Cockpit): void {
    this.upperBody.position.copy(cockpit.hip);
    // Inclina para dentro da curva e gira um pouco os ombros.
    this.upperBody.rotation.set(-cockpit.recline, this.lean * 0.12, -this.lean * 0.22);
    // A cabeça desfaz a inclinação do encosto e olha para dentro da curva.
    this.headMount.rotation.set(cockpit.recline * 0.9, this.lean * 0.7, this.lean * 0.12);
  }

  private updateStanding(): void {
    const celebrate = this.pose === 'celebrate';
    const bounce = celebrate ? Math.abs(Math.sin(this.time * 6)) * 0.035 : 0;
    this.upperBody.position.set(0, BODY.standingHip + bounce, 0);
    this.upperBody.rotation.set(
      celebrate ? -0.08 : 0,
      0,
      celebrate ? Math.sin(this.time * 3) * 0.05 : 0,
    );
    this.headMount.rotation.set(celebrate ? -0.18 : 0, 0, 0);
  }

  private wristTarget(side: 1 | -1, out: Vector3): void {
    if (this.pose === 'seated' && this.cockpit) {
      const { steeringCenter, steeringAxis, gripRadius, steeringRatio } = this.cockpit;
      // Mãos às 9 e às 3 horas, girando junto com o aro; o punho fica um pouco antes do aro.
      out
        .set(side * gripRadius, 0, 0)
        .applyAxisAngle(steeringAxis, -this.steer * steeringRatio)
        .add(steeringCenter)
        .addScaledVector(steeringAxis, -0.075);
      return;
    }
    out.copy(this.shoulder);
    if (this.pose === 'celebrate') {
      // Braços para o alto, socando o ar alternadamente.
      const pump = Math.sin(this.time * 6 + (side === 1 ? 0 : Math.PI)) * 0.07;
      out.x += side * 0.2;
      out.y += 0.44 + pump;
      out.z += 0.1;
    } else {
      // Braços abertos, um pouco abaixo da horizontal, como nas referências.
      const reach = BODY.upperArm + BODY.forearm - 0.004;
      out.x += side * reach * Math.cos(0.42);
      out.y -= reach * Math.sin(0.42);
    }
  }

  private place(node: Object3D, from: Vector3, to: Vector3): void {
    this.direction.subVectors(to, from).normalize();
    node.position.copy(from);
    node.quaternion.setFromUnitVectors(UP, this.direction);
  }

  private updateArm(arm: PilotRig['arms'][number]): void {
    this.shoulder
      .set(arm.side * BODY.shoulderHalfWidth, BODY.shoulderHeight - 0.01, 0)
      .applyMatrix4(this.upperBody.matrix);
    this.wristTarget(arm.side, this.wrist);
    // Cotovelos para fora e para baixo.
    this.pole.set(arm.side * 0.8, this.pose === 'celebrate' ? -0.2 : -0.7, -0.35);
    solveTwoBone(
      this.shoulder,
      this.wrist,
      BODY.upperArm,
      BODY.forearm,
      this.pole,
      this.elbow,
      this.hand,
    );
    this.place(arm.upper, this.shoulder, this.elbow);
    this.place(arm.fore, this.elbow, this.hand);
    // A mão continua a direção do antebraço.
    arm.glove.position.copy(this.hand);
    arm.glove.quaternion.copy(arm.fore.quaternion);
    if (arm.side === -1)
      arm.glove.quaternion.multiply(this.quaternion.setFromAxisAngle(UP, Math.PI));
  }
}
