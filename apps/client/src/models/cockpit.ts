import type { Group, Mesh } from 'three';
import { Box3, Vector3 } from 'three';
import { KART_PARTS } from '@kart/shared';
import { STEERING_WHEEL_RATIO } from './kartRig';
import type { Cockpit } from './pilot/PilotRig';

/**
 * Medidas do assento e dos pedais do "Cartoon Kart G" já convertido (metros,
 * espaço do kart), tiradas das ilhas da malha listadas no inventário: assento
 * com topo em y ≈ 0,28 e encosto em z ≈ 0,30; pedais em z ≈ 0,86 a 0,95.
 * Um GLB de kart diferente precisa das suas próprias medidas aqui.
 */
const SEAT = {
  hip: new Vector3(0, 0.375, 0.435),
  ankles: [new Vector3(0.125, 0.215, 0.86), new Vector3(-0.125, 0.215, 0.86)] as const,
  recline: 0.2,
};

/** Monta o encaixe do piloto num kart: assento fixo + volante lido do próprio modelo. */
export function cockpitOf(kart: Group): Cockpit {
  const wheel = kart.getObjectByName(KART_PARTS.steeringWheel) as Mesh | undefined;
  if (!wheel) throw new Error('kart sem volante');
  const axis: unknown = wheel.userData.axis;
  const steeringAxis =
    Array.isArray(axis) && axis.length === 3
      ? new Vector3().fromArray(axis as number[]).normalize()
      : new Vector3(0, 0, 1);
  // A geometria pode estar quantizada (inteiros + escala no nó): mede já com a escala.
  wheel.geometry.computeBoundingBox();
  const size = (wheel.geometry.boundingBox ?? new Box3())
    .getSize(new Vector3())
    .multiply(wheel.scale);
  return {
    hip: SEAT.hip,
    ankles: SEAT.ankles,
    recline: SEAT.recline,
    steeringCenter: wheel.position.clone(),
    steeringAxis,
    gripRadius: Math.max(size.x, size.y) / 2 - 0.012,
    steeringRatio: STEERING_WHEEL_RATIO,
  };
}
