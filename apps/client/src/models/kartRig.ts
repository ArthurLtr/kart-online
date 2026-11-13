import type { Group, Object3D } from 'three';
import { Quaternion, Vector3 } from 'three';
import { KART_PARTS } from '@kart/shared';

interface Wheel {
  node: Object3D;
  radius: number;
  steers: boolean;
  spin: number;
}

/** Quanto o volante gira para cada radiano de esterço das rodas. */
export const STEERING_WHEEL_RATIO = 2.5;

/**
 * Controla as partes móveis de um kart (GLB ou procedural, tanto faz):
 * rodas girando conforme a distância percorrida, dianteiras esterçando e
 * volante acompanhando. É só visual; a física não passa por aqui.
 */
export class KartRig {
  private readonly wheels: Wheel[] = [];
  private readonly steeringWheel: Object3D | undefined;
  private readonly steeringAxis = new Vector3(0, 0, 1);
  private readonly steeringRest = new Quaternion();
  private readonly scratch = new Quaternion();

  constructor(readonly root: Group) {
    const wheel = (name: string, steers: boolean): void => {
      const node = root.getObjectByName(name);
      if (!node) throw new Error(`kart sem a parte "${name}"`);
      const radius = Number(node.userData.radius);
      if (!(radius > 0)) throw new Error(`roda "${name}" sem userData.radius`);
      node.rotation.order = 'YXZ'; // esterço (Y) aplicado antes do giro (X)
      this.wheels.push({ node, radius, steers, spin: 0 });
    };
    wheel(KART_PARTS.wheelFrontLeft, true);
    wheel(KART_PARTS.wheelFrontRight, true);
    wheel(KART_PARTS.wheelRearLeft, false);
    wheel(KART_PARTS.wheelRearRight, false);

    this.steeringWheel = root.getObjectByName(KART_PARTS.steeringWheel);
    const axis: unknown = this.steeringWheel?.userData.axis;
    if (this.steeringWheel && Array.isArray(axis) && axis.length === 3) {
      this.steeringAxis.fromArray(axis as number[]).normalize();
      this.steeringRest.copy(this.steeringWheel.quaternion);
    }
  }

  /**
   * @param distance metros percorridos desde a última chamada (negativo em ré)
   * @param steerAngle ângulo das rodas dianteiras em radianos (positivo = esquerda)
   */
  update(distance: number, steerAngle: number): void {
    for (const wheel of this.wheels) {
      wheel.spin = (wheel.spin + distance / wheel.radius) % (Math.PI * 2);
      wheel.node.rotation.x = wheel.spin;
      if (wheel.steers) wheel.node.rotation.y = steerAngle;
    }
    if (this.steeringWheel) {
      this.scratch.setFromAxisAngle(this.steeringAxis, -steerAngle * STEERING_WHEEL_RATIO);
      this.steeringWheel.quaternion.copy(this.steeringRest).multiply(this.scratch);
    }
  }
}
