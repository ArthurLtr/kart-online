import { Clock } from 'three';
import { createModelProvider } from './models';
import type { PostFx } from './render/postfx';
import { createPostFx } from './render/postfx';
import { applyRendererQuality, createRenderer } from './render/renderer';
import { createAccountScreen } from './screens/accountScreen';
import { createGarageScreen } from './screens/garageScreen';
import { createMenuScreen } from './screens/menuScreen';
import { createSettingsScreen } from './screens/settingsScreen';
import { createOnlineScreen } from './screens/onlineScreen';
import { createTrackScreen } from './screens/trackScreen';
import { createTrainingScreen } from './screens/trainingScreen';
import type { AppContext, GameScreen, ScreenFactory } from './screens/types';
import {
  getSettings,
  gpuName,
  isFirstRun,
  onSettingsChange,
  quality,
  suggestQuality,
  updateSettings,
} from './settings';

const SCREENS = {
  menu: createMenuScreen,
  config: createSettingsScreen,
  treino: createTrainingScreen,
  corrida: createOnlineScreen,
  pista: createTrackScreen,
  garagem: createGarageScreen,
  conta: createAccountScreen,
} satisfies Record<string, ScreenFactory>;
type ScreenName = keyof typeof SCREENS;

const canvas = document.querySelector<HTMLCanvasElement>('#cena');
const status = document.querySelector<HTMLElement>('#status');
const ui = document.querySelector<HTMLElement>('#tela-ui');
if (!canvas || !status || !ui) throw new Error('index.html sem #cena, #status ou #tela-ui');

const renderer = createRenderer(canvas);
if (isFirstRun()) {
  // Primeira visita: começa no preset sugerido para a placa de vídeo (sem gravar a escolha).
  const gpu = gpuName(renderer.getContext());
  updateSettings({ quality: suggestQuality(gpu, navigator.hardwareConcurrency ?? 4) }, false);
  applyRendererQuality(renderer);
}
renderer.info.autoReset = false; // somamos os draw calls de todas as passadas do quadro

const context: AppContext = {
  renderer,
  canvas,
  ui,
  models: createModelProvider(renderer),
  setStatus(text, isError = false) {
    status.textContent = text;
    status.dataset.erro = String(isError);
  },
};

let screen: GameScreen | undefined;
let postfx: PostFx | undefined;

function resize(): void {
  const { innerWidth: width, innerHeight: height } = window;
  renderer.setSize(width, height, false);
  postfx?.setSize(width, height);
  if (screen) {
    screen.camera.aspect = width / height;
    screen.camera.updateProjectionMatrix();
  }
}

function show(name: ScreenName): void {
  screen?.dispose();
  postfx?.dispose();
  screen = SCREENS[name](context);
  renderer.shadowMap.enabled = quality().shadowMap > 0;
  postfx = createPostFx(renderer, screen.scene, screen.camera, quality().postfx);
  context.ui.dataset.tela = name;
  document.body.dataset.tela = name;
  for (const tab of document.querySelectorAll<HTMLAnchorElement>('[data-tela-link]')) {
    if (tab.dataset.telaLink === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  resize();
  if (import.meta.env.DEV) {
    // Exposto para inspeção no console durante o desenvolvimento.
    Object.assign(window, { __kart: { renderer, screen } });
  }
}

function showFromHash(): void {
  const name = window.location.hash.slice(1);
  show(name in SCREENS ? (name as ScreenName) : 'menu');
}

let appliedQuality = getSettings().quality;
const stopSettings = onSettingsChange((settings) => {
  if (settings.quality === appliedQuality || !screen) return;
  // Trocou o preset: resolução e pós-processamento mudam na hora; sombras e cenário, na próxima tela.
  appliedQuality = settings.quality;
  applyRendererQuality(renderer);
  postfx?.dispose();
  postfx = createPostFx(renderer, screen.scene, screen.camera, quality().postfx);
  resize();
});

window.addEventListener('resize', resize);
window.addEventListener('hashchange', showFromHash);
showFromHash();

const clock = new Clock();
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.1);
  screen?.update(delta, clock.elapsedTime);
  postfx?.setMotionBlur(screen?.motionBlur ?? 0);
  renderer.info.reset();
  postfx?.render(delta);
});

import.meta.hot?.dispose(() => {
  renderer.setAnimationLoop(null);
  window.removeEventListener('resize', resize);
  window.removeEventListener('hashchange', showFromHash);
  stopSettings();
  screen?.dispose();
  postfx?.dispose();
  context.models.dispose();
  renderer.dispose();
});
