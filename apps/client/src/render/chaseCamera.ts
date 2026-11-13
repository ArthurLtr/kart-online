import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';

const DISTANCE = 4.3;
const HEIGHT = 1.85;
const STIFFNESS = 45;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.95;
const BASE_FOV = 60;
const SPEED_FOV = 13;

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Câmera de perseguição com mola: segue o kart por trás com atraso, de modo
 * que acelerações, freadas e derrapagens aparecem no enquadramento. O campo
 * de visão abre um pouco com a velocidade.
 */
export class ChaseCamera {
  private readonly velocity = new Vector3();
  private readonly desired = new Vector3();
  private readonly previousDesired = new Vector3();
  private readonly targetVelocity = new Vector3();
  private readonly target = new Vector3();
  private readonly force = new Vector3();
  private yaw = 0;
  private started = false;

  constructor(private readonly camera: PerspectiveCamera) {}

  /**
   * @param position posição do kart (pivô no eixo traseiro)
   * @param heading rotação em Y do kart
   * @param speed m/s
   */
  update(dt: number, position: Vector3, heading: number, speed: number, lookBack: boolean): void {
    if (!this.started) {
      this.yaw = heading;
    } else {
      // O rumo da câmera segue o do kart com atraso: numa derrapagem dá para ver o ângulo.
      this.yaw = wrapAngle(this.yaw + wrapAngle(heading - this.yaw) * (1 - Math.exp(-7 * dt)));
    }
    const back = lookBack ? -1 : 1;
    const fx = Math.sin(this.yaw) * back;
    const fz = Math.cos(this.yaw) * back;
    this.previousDesired.copy(this.desired);
    this.desired.set(position.x - fx * DISTANCE, position.y + HEIGHT, position.z - fz * DISTANCE);

    if (!this.started || lookBack !== this.lookingBack || dt <= 0) {
      this.camera.position.copy(this.desired);
      this.velocity.set(0, 0, 0);
      this.started = true;
      this.lookingBack = lookBack;
    } else {
      // A mola amortece em relação à velocidade do ponto perseguido: em velocidade
      // constante a câmera não fica para trás; ela só cede em acelerações e freadas.
      this.targetVelocity.subVectors(this.desired, this.previousDesired).divideScalar(dt);
      // Em subpassos, para ficar estável com quadros longos.
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        this.force
          .subVectors(this.desired, this.camera.position)
          .multiplyScalar(STIFFNESS)
          .addScaledVector(this.velocity, -DAMPING)
          .addScaledVector(this.targetVelocity, DAMPING);
        this.velocity.addScaledVector(this.force, h);
        this.camera.position.addScaledVector(this.velocity, h);
      }
    }

    this.target.set(position.x + fx * 3, position.y + 0.75, position.z + fz * 3);
    this.camera.lookAt(this.target);
    const fov = BASE_FOV + SPEED_FOV * Math.min(1, speed / 31);
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private lookingBack = false;

  /** Recomeça colada no kart (depois de reposicionar ou reiniciar). */
  reset(): void {
    this.started = false;
  }
}
