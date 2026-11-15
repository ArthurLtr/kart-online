import type { Group, Material } from 'three';
import { Box3, Mesh, MeshBasicMaterial, Sphere } from 'three';
import { KART_WHEEL_PARTS } from '@kart/shared';
import { loadOptionalGlb } from '../models/glb';
import type { RimDesign } from './catalog';

const MODEL_NAME = 'roda_temporada';
/** Esconde a roda original sem tirá-la da cena (o pivô continua girando e esterçando). */
const HIDDEN = new MeshBasicMaterial({ visible: false });

/**
 * Roda da temporada com .glb próprio (`public/assets/cosmetics/s1/<id>.glb`):
 * o modelo entra dentro de cada pivô de roda do kart, no tamanho da roda
 * original, e a malha original fica escondida. Sem o arquivo (ou para rodas
 * sem .glb), as rodas do kart ficam, com o material do item por cima.
 * Puramente visual: o raio de colisão da simulação não muda.
 */
export async function applyWheelModel(kart: Group, design: RimDesign): Promise<void> {
  const gltf = design.glb ? await loadOptionalGlb(design.glb) : null;
  // Outra troca chegou enquanto o arquivo carregava: vale a mais recente.
  kart.userData.wheelModel = design.id;
  for (const part of KART_WHEEL_PARTS) {
    const wheel = kart.getObjectByName(part);
    if (!(wheel instanceof Mesh)) continue;
    const previous = wheel.getObjectByName(MODEL_NAME);
    if (previous) wheel.remove(previous);
    const original = wheel.userData.originalMaterial as Material | Material[] | undefined;
    if (!gltf) {
      if (original) {
        wheel.material = original;
        delete wheel.userData.originalMaterial;
      }
      continue;
    }
    if (kart.userData.wheelModel !== design.id) return;
    wheel.userData.originalMaterial ??= wheel.material;
    wheel.material = HIDDEN;
    const model = gltf.scene.clone(true);
    model.name = MODEL_NAME;
    const radius = typeof wheel.userData.radius === 'number' ? wheel.userData.radius : 0.13;
    const sphere = new Box3().setFromObject(model).getBoundingSphere(new Sphere());
    if (sphere.radius > 0) {
      model.scale.setScalar(radius / sphere.radius);
      model.position.copy(sphere.center).multiplyScalar(-radius / sphere.radius);
    }
    wheel.add(model);
  }
}
