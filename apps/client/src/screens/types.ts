import type { Camera, Scene, WebGLRenderer } from 'three';
import type { ModelProvider } from '../models';

/** O que cada tela recebe do aplicativo. */
export interface AppContext {
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
  models: ModelProvider;
  /** Contêiner HTML onde a tela monta os seus controles. */
  ui: HTMLElement;
  setStatus(text: string, isError?: boolean): void;
}

/** Uma tela 3D do jogo (pista, garagem…). Só uma fica ativa por vez. */
export interface GameScreen {
  scene: Scene;
  camera: Camera & { aspect: number; updateProjectionMatrix(): void };
  update(deltaSeconds: number, timeSeconds: number): void;
  /** Borrão de velocidade pedido pela tela neste quadro, 0 a 1 (ausente = sem borrão). */
  motionBlur?: number;
  /** Libera GPU, eventos e HTML da tela. */
  dispose(): void;
}

export type ScreenFactory = (context: AppContext) => GameScreen;

/** Cria um botão de alternância dentro de um contêiner. */
export function button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  parent.append(element);
  return element;
}
