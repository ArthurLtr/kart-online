import type { Group } from 'three';
import { applyLoadout } from '../cosmetics/apply';
import type { Loadout } from '../cosmetics/catalog';
import { cockpitOf } from './cockpit';
import { KartRig } from './kartRig';
import type { ModelProvider } from './ModelProvider';
import { PilotRig } from './pilot/PilotRig';

/** Um kart completo: modelo, piloto sentado, capacete e os cosméticos aplicados. */
export interface Driver {
  kart: Group;
  kartRig: KartRig;
  pilot: PilotRig;
  loadout: Loadout;
  /** Troca os cosméticos (carrega outro capacete se o modelo mudou). */
  setLoadout(loadout: Loadout): Promise<void>;
  /**
   * @param dt segundos desde a última chamada
   * @param distance metros percorridos desde a última chamada
   * @param steerAngle ângulo das rodas dianteiras em radianos (positivo = esquerda)
   */
  update(dt: number, distance: number, steerAngle: number): void;
}

export async function createDriver(models: ModelProvider, loadout: Loadout): Promise<Driver> {
  const [kart, pilotRoot] = await Promise.all([models.load('kart'), models.load('pilot')]);
  const kartRig = new KartRig(kart);
  const pilot = new PilotRig(pilotRoot);
  pilot.setCockpit(cockpitOf(kart));
  pilot.setPose('seated');
  kart.add(pilotRoot);

  let helmet: Group | undefined;
  const driver: Driver = {
    kart,
    kartRig,
    pilot,
    loadout,
    async setLoadout(next) {
      if (!helmet || helmet.userData.model !== next.helmetModel) {
        helmet = await models.load('helmet', next.helmetModel);
        pilot.attachHelmet(helmet);
      }
      driver.loadout = next;
      applyLoadout({ kart, pilot, helmet }, next);
    },
    update(dt, distance, steerAngle) {
      kartRig.update(distance, steerAngle);
      pilot.update(dt, steerAngle);
    },
  };
  await driver.setLoadout(loadout);
  return driver;
}
