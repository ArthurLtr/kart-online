import { Color, Group, PerspectiveCamera, PMREMGenerator, Scene } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadLoadout } from '../cosmetics/catalog';
import type { Driver } from '../models/driver';
import { createDriver } from '../models/driver';
import { disposeTree } from '../render/dispose';
import {
  createRoom,
  createStudioLights,
  createTurntable,
  TURNTABLE_HEIGHT,
} from '../render/studio';
import { quality } from '../settings';
import type { AppContext } from './types';

export interface Showroom {
  scene: Scene;
  camera: PerspectiveCamera;
  update(delta: number, time: number): void;
  dispose(): void;
}

/**
 * Fundo dos menus: o kart do jogador, com o piloto e os cosméticos equipados,
 * girando devagar na plataforma do estúdio.
 */
export function createShowroom(context: AppContext): Showroom {
  const scene = new Scene();
  scene.background = new Color(0x15171b);
  const camera = new PerspectiveCamera(34, 1, 0.1, 100);

  const pmrem = new PMREMGenerator(context.renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.6;

  const turntable = createTurntable();
  const stage = new Group();
  stage.position.y = TURNTABLE_HEIGHT;
  turntable.add(stage);
  scene.add(createRoom(), turntable);
  createStudioLights(scene, quality().shadowMap);

  let disposed = false;
  let driver: Driver | undefined;
  createDriver(context.models, loadLoadout())
    .then((created) => {
      if (disposed) {
        disposeTree(created.kart);
        return;
      }
      driver = created;
      // Centraliza o kart na plataforma (o pivô dele fica no eixo traseiro).
      created.kart.position.set(0, 0, -0.6);
      stage.add(created.kart);
    })
    .catch((erro: unknown) => {
      console.error(erro);
      context.setStatus('Não foi possível carregar o kart. Rode "pnpm assets" e recarregue.', true);
    });

  return {
    scene,
    camera,
    update(delta, time) {
      turntable.rotation.y += delta * 0.3;
      driver?.update(delta, 0, Math.sin(time * 0.6) * 0.25);
      // O kart fica à direita da tela, deixando a esquerda livre para os botões.
      const wide = camera.aspect > 1.2;
      camera.position.set(wide ? -1.5 : 0, 1.55 + Math.sin(time * 0.25) * 0.1, wide ? 6.2 : 8.5);
      camera.lookAt(wide ? -1.5 : 0, wide ? 0.7 : 1.3, 0);
    },
    dispose() {
      disposed = true;
      disposeTree(scene);
      environment.dispose();
    },
  };
}
