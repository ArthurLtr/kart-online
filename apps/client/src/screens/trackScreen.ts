import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getCircuitoDaOrla, pointAt } from '@kart/shared';
import { loadLoadout, sampleLoadout } from '../cosmetics/catalog';
import { loadPaint } from '../cosmetics/paint';
import { createDriver } from '../models/driver';
import { disposeTree } from '../render/dispose';
import { setupLighting, SUN_DIRECTION } from '../render/lighting';
import { createSky } from '../render/sky';
import { createTrackScene } from '../track';
import type { AppContext, GameScreen } from './types';
import { button } from './types';

type CameraMode = 'largada' | 'geral' | 'volta';

const FLY_SPEED = 25; // m/s (90 km/h)

/** Pista com os 9 karts no grid e câmeras de inspeção. A corrida entra na etapa 4. */
export function createTrackScreen(context: AppContext): GameScreen {
  const { renderer, canvas, models, ui } = context;
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.3, 4000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 3;
  controls.maxDistance = 700;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;

  const track = getCircuitoDaOrla();
  const lighting = setupLighting(scene, renderer);
  const sky = createSky(SUN_DIRECTION);
  const trackScene = createTrackScene(track, SUN_DIRECTION);
  scene.add(sky.mesh, trackScene.group);

  let disposed = false;
  let mode: CameraMode = 'largada';
  let flyDistance = 0;
  const eye = new Vector3();
  const look = new Vector3();

  // --- interface ----------------------------------------------------------
  const nav = document.createElement('nav');
  nav.className = 'botoes';
  nav.setAttribute('aria-label', 'Câmeras e depuração');
  const hint = document.createElement('p');
  hint.textContent = 'Arraste para girar a câmera · Role para aproximar';
  ui.append(nav, hint);

  const cameraButtons = new Map<CameraMode, HTMLButtonElement>();
  const setMode = (next: CameraMode): void => {
    mode = next;
    controls.enabled = next !== 'volta';
    if (next === 'largada') {
      const grid = track.grid[4] ?? track.grid[0];
      if (grid) controls.target.set(grid.x, 0.6, grid.z);
      camera.position.copy(controls.target).add(new Vector3(-17, 6.5, -11));
    } else if (next === 'geral') {
      controls.target.set(5, 0, 72);
      camera.position.set(5, 330, 345);
    } else {
      flyDistance = 0;
    }
    for (const [key, element] of cameraButtons) {
      element.setAttribute('aria-pressed', String(key === next));
    }
  };
  cameraButtons.set(
    'largada',
    button(nav, '1 · Largada', () => setMode('largada')),
  );
  cameraButtons.set(
    'geral',
    button(nav, '2 · Visão geral', () => setMode('geral')),
  );
  cameraButtons.set(
    'volta',
    button(nav, '3 · Volta de câmera', () => setMode('volta')),
  );

  let checkpointsVisible = false;
  const toggleCheckpoints = (): void => {
    checkpointsVisible = !checkpointsVisible;
    trackScene.setCheckpointsVisible(checkpointsVisible);
    checkpointsButton.setAttribute('aria-pressed', String(checkpointsVisible));
  };
  const checkpointsButton = button(nav, 'C · Checkpoints', toggleCheckpoints);
  checkpointsButton.setAttribute('aria-pressed', 'false');

  let lightsOn = 0;
  const cycleLights = (): void => {
    lightsOn = (lightsOn + 1) % 6;
    trackScene.setStartLights(lightsOn);
  };
  button(nav, 'L · Semáforo', cycleLights);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'Digit1') setMode('largada');
    else if (event.code === 'Digit2') setMode('geral');
    else if (event.code === 'Digit3') setMode('volta');
    else if (event.code === 'KeyC') toggleCheckpoints();
    else if (event.code === 'KeyL') cycleLights();
  };
  window.addEventListener('keydown', onKeyDown);
  setMode('largada');

  // --- 9 karts com piloto no grid ------------------------------------------
  // A pole usa o loadout aplicado na garagem; os outros variam para mostrar o catálogo.
  context.setStatus('Carregando karts…');
  Promise.all(
    track.grid.map((_, i) =>
      createDriver(
        models,
        i === 0 ? loadLoadout() : sampleLoadout(i),
        i === 0 ? loadPaint() : null,
      ),
    ),
  )
    .then((drivers) => {
      if (disposed) return;
      drivers.forEach((driver, i) => {
        const slot = track.grid[i];
        if (!slot) return;
        driver.kart.position.set(slot.x, slot.y, slot.z);
        driver.kart.rotation.y = slot.heading;
        scene.add(driver.kart);
      });
      context.setStatus(
        `${track.definition.name} · ${(track.length / 1000).toFixed(2)} km · ${track.corners.length} curvas · ${drivers.length} karts no grid`,
      );
    })
    .catch((erro: unknown) => {
      console.error(erro);
      context.setStatus(
        'Não foi possível carregar os karts. Rode "pnpm assets" e recarregue.',
        true,
      );
    });

  return {
    scene,
    camera,
    update(delta, time) {
      if (mode === 'volta') {
        flyDistance += FLY_SPEED * delta;
        const here = pointAt(track, flyDistance, 0);
        const ahead = pointAt(track, flyDistance + 14, 0);
        eye.set(here.x, here.y + 1.6, here.z);
        look.set(ahead.x, ahead.y + 1.0, ahead.z);
        camera.position.lerp(eye, Math.min(1, delta * 8));
        controls.target.lerp(look, Math.min(1, delta * 8));
        camera.lookAt(controls.target);
      } else {
        controls.update(delta);
      }
      // A sombra acompanha o alvo da câmera e abre o alcance quando a câmera se afasta.
      const distance = camera.position.distanceTo(controls.target);
      lighting.follow(controls.target, Math.min(300, Math.max(30, distance * 0.9)));
      sky.update(time);
      trackScene.update(time);
    },
    dispose() {
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      controls.dispose();
      ui.replaceChildren();
      disposeTree(scene);
      lighting.dispose();
    },
  };
}
