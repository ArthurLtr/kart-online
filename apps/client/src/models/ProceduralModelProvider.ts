import type { Group } from 'three';
import type { ModelId } from '@kart/shared';
import type { HelmetModel } from '../cosmetics/catalog';
import { createHelmet } from './helmet/createHelmet';
import type { ModelProvider } from './ModelProvider';
import { createPilot } from './pilot/createPilot';
import { loadPilotGear } from './pilot/gear';

type Factory = (variant?: string) => Group;

/**
 * Modelos gerados por código, no mesmo contrato dos GLBs. A pasta referencias/
 * só tem imagens do piloto e do capacete, então os dois são procedurais; o
 * kart vem do GLB.
 */
const FACTORIES: Partial<Record<ModelId, Factory>> = {
  pilot: () => createPilot(),
  helmet: (variant) =>
    createHelmet(variant === 'aero' ? 'aero' : ('integral' satisfies HelmetModel['id'])),
};

export class ProceduralModelProvider implements ModelProvider {
  readonly name = 'procedural';

  async load(id: ModelId, variant?: string): Promise<Group> {
    const factory = FACTORIES[id];
    if (!factory) throw new Error(`sem factory procedural para "${id}"`);
    // Bota e luva modeladas entram na montagem do piloto quando o arquivo existe.
    if (id === 'pilot') await loadPilotGear();
    return factory(variant);
  }

  dispose(): void {}
}
