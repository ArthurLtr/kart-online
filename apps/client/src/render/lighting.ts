import type { Scene, WebGLRenderer } from 'three';
import { DirectionalLight, HemisphereLight, Object3D, PMREMGenerator, Vector3 } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Direção de onde vem o sol de fim de tarde (baixo no horizonte). */
export const SUN_DIRECTION = new Vector3(-0.5, 0.36, -0.78).normalize(); // sol se pondo sobre o mar

const SHADOW_HALF_SIZE = 40;
const SHADOW_DISTANCE = 400;

export interface Lighting {
  /**
   * Centraliza a câmera de sombra num ponto (o kart do jogador ou o alvo da
   * câmera). `halfSize` é o alcance da sombra em metros para cada lado.
   */
  follow(target: Vector3, halfSize?: number): void;
  dispose(): void;
}

/** `shadowMapSize` é o lado do mapa de sombra em pixels; 0 desliga as sombras. */
export function setupLighting(
  scene: Scene,
  renderer: WebGLRenderer,
  shadowMapSize = 2048,
): Lighting {
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  const hemisphere = new HemisphereLight(0xbcd4ff, 0x4a3d2e, 0.7);
  scene.add(hemisphere);

  const sun = new DirectionalLight(0xffd2a1, 3.2);
  sun.castShadow = shadowMapSize > 0;
  sun.shadow.mapSize.set(shadowMapSize || 512, shadowMapSize || 512);
  sun.shadow.camera.left = -SHADOW_HALF_SIZE;
  sun.shadow.camera.right = SHADOW_HALF_SIZE;
  sun.shadow.camera.top = SHADOW_HALF_SIZE;
  sun.shadow.camera.bottom = -SHADOW_HALF_SIZE;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = SHADOW_DISTANCE * 2;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 4;

  const sunTarget = new Object3D();
  sun.target = sunTarget;
  scene.add(sun, sunTarget);

  let currentHalfSize = SHADOW_HALF_SIZE;
  const follow = (target: Vector3, halfSize = SHADOW_HALF_SIZE): void => {
    sunTarget.position.copy(target);
    sun.position.copy(target).addScaledVector(SUN_DIRECTION, SHADOW_DISTANCE);
    if (Math.abs(halfSize - currentHalfSize) > currentHalfSize * 0.05) {
      currentHalfSize = halfSize;
      const camera = sun.shadow.camera;
      camera.left = camera.bottom = -halfSize;
      camera.right = camera.top = halfSize;
      camera.updateProjectionMatrix();
      // Sombras mais largas precisam de mais folga contra o "acne".
      sun.shadow.normalBias = 0.02 * (halfSize / SHADOW_HALF_SIZE);
    }
  };
  follow(new Vector3());

  return {
    follow,
    dispose() {
      scene.remove(hemisphere, sun, sunTarget);
      scene.environment = null;
      environment.dispose();
      sun.shadow.map?.dispose();
      hemisphere.dispose();
      sun.dispose();
    },
  };
}
