import type { Vector3 } from 'three';
import { Group } from 'three';
import type { Track } from '@kart/shared';
import { createBarriers } from './barriers';
import { createScenery } from './scenery';
import { createCheckpointGates, createSurface } from './surface';
import { createWater } from './water';

export interface TrackScene {
  group: Group;
  /** Acende as `count` primeiras luzes do semáforo (0 a 5). */
  setStartLights(count: number): void;
  /** Mostra os portais de checkpoint (depuração). */
  setCheckpointsVisible(visible: boolean): void;
  update(timeSeconds: number): void;
}

/**
 * Monta a pista inteira a partir do spline de @kart/shared: piso, barreiras,
 * largada, cenário e mar. Tudo procedural (a pasta referencias/ não tem modelo
 * nem imagem de pista), marcado como provisório no inventário.
 */
export function createTrackScene(track: Track, sunDirection: Vector3): TrackScene {
  const group = new Group();
  group.name = 'track';

  const barriers = createBarriers(track);
  const gates = createCheckpointGates(track);
  const water = createWater(sunDirection);
  group.add(createSurface(track), barriers.group, createScenery(track), water.mesh, gates);

  // A pista é estática: congela as matrizes para não recalcular a cada quadro.
  group.updateMatrixWorld(true);
  group.traverse((node) => {
    node.matrixAutoUpdate = false;
  });

  return {
    group,
    setStartLights: (count) => barriers.gantry.setLights(count),
    setCheckpointsVisible: (visible) => {
      gates.visible = visible;
    },
    update: (timeSeconds) => water.update(timeSeconds),
  };
}
