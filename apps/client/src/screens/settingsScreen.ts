import type { Action, Quality } from '../settings';
import {
  ACTIONS,
  DEFAULT_KEYS,
  getSettings,
  gpuName,
  keyLabel,
  QUALITY,
  QUALITY_NAMES,
  remapKey,
  suggestQuality,
  updateSettings,
} from '../settings';
import { createShowroom } from './showroom';
import type { AppContext, GameScreen } from './types';
import { button } from './types';

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  parent: HTMLElement,
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

/** Configurações: preset gráfico, áudio e remapeamento das teclas. */
export function createSettingsScreen(context: AppContext): GameScreen {
  const showroom = createShowroom(context);
  const panel = document.createElement('section');
  panel.className = 'painel config';
  node('h2', panel, 'Configurações');

  // --- Gráficos --------------------------------------------------------------
  const graphics = node('fieldset', panel);
  node('legend', graphics, 'Gráficos');
  const gpu = gpuName(context.renderer.getContext());
  const suggested = suggestQuality(gpu, navigator.hardwareConcurrency ?? 4);
  const qualityRow = node('div', graphics);
  qualityRow.className = 'botoes';
  const qualityButtons = new Map<Quality, HTMLButtonElement>();
  for (const name of QUALITY_NAMES) {
    qualityButtons.set(
      name,
      button(qualityRow, QUALITY[name].label, () => {
        updateSettings({ quality: name });
        refresh();
      }),
    );
  }
  node(
    'p',
    graphics,
    `Placa de vídeo: ${gpu || 'não informada pelo navegador'}. Sugerido: ${QUALITY[suggested].label}.`,
  ).className = 'nota';
  const detail = node('p', graphics);
  detail.className = 'nota';

  const toggle = (
    parent: HTMLElement,
    label: string,
    key: 'motionBlur' | 'nameTags' | 'music',
  ): HTMLInputElement => {
    const row = node('label', parent);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = getSettings()[key];
    input.addEventListener('change', () => updateSettings({ [key]: input.checked }));
    row.append(input, ` ${label}`);
    return input;
  };
  toggle(graphics, 'Borrão de velocidade', 'motionBlur');
  toggle(graphics, 'Nomes sobre os karts', 'nameTags');

  // --- Áudio -----------------------------------------------------------------
  const audio = node('fieldset', panel);
  node('legend', audio, 'Áudio');
  const volumeRow = node('label', audio, 'Volume geral ');
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.value = String(Math.round(getSettings().volume * 100));
  volume.addEventListener('input', () => updateSettings({ volume: Number(volume.value) / 100 }));
  volumeRow.append(volume);
  toggle(audio, 'Música no menu', 'music');

  // --- Controles -------------------------------------------------------------
  const controls = node('fieldset', panel);
  node('legend', controls, 'Controles');
  const table = node('table', controls);
  const keyButtons: { action: Action; index: 0 | 1; element: HTMLButtonElement }[] = [];
  let listening: { action: Action; index: 0 | 1 } | null = null;
  for (const { action, label } of ACTIONS) {
    const row = table.insertRow();
    const head = document.createElement('th');
    head.scope = 'row';
    head.textContent = label;
    row.append(head);
    for (const index of [0, 1] as const) {
      const cell = row.insertCell();
      const element = button(cell, '', () => {
        listening = { action, index };
        refresh();
      });
      element.setAttribute('aria-label', `${label}, tecla ${index + 1}`);
      keyButtons.push({ action, index, element });
    }
  }
  const controlActions = node('div', controls);
  controlActions.className = 'botoes';
  button(controlActions, 'Restaurar teclas padrão', () => {
    listening = null;
    updateSettings({ keys: DEFAULT_KEYS });
    refresh();
  });
  const padStatus = node('p', controls);
  padStatus.className = 'nota';

  const actions = node('div', panel);
  actions.className = 'botoes';
  button(actions, 'Voltar ao menu', () => {
    window.location.hash = 'menu';
  });

  function refresh(): void {
    const settings = getSettings();
    for (const [name, element] of qualityButtons) {
      element.setAttribute('aria-pressed', String(name === settings.quality));
      element.className = name === settings.quality ? 'primario' : '';
    }
    const preset = QUALITY[settings.quality];
    detail.textContent =
      `Sombras: ${preset.shadowMap > 0 ? `${preset.shadowMap} px` : 'desligadas'} · ` +
      `pós-processamento: ${preset.postfx === 'completo' ? 'completo' : 'básico'} · ` +
      `cenário: ${Math.round(preset.scenery * 100)}% · ` +
      `resolução: até ${preset.pixelRatio}× (vale ao entrar na pista).`;
    for (const { action, index, element } of keyButtons) {
      const waiting = listening?.action === action && listening.index === index;
      const code = settings.keys[action][index];
      element.textContent = waiting ? 'Pressione uma tecla…' : code ? keyLabel(code) : '—';
      element.className = waiting ? 'primario' : '';
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!listening) return;
    event.preventDefault();
    event.stopPropagation();
    const { action, index } = listening;
    listening = null;
    if (event.code !== 'Escape') {
      updateSettings({ keys: remapKey(getSettings().keys, action, index, event.code) });
    }
    refresh();
  };
  window.addEventListener('keydown', onKeyDown, true);

  let padName = '';
  const describePad = (): void => {
    const pad = navigator.getGamepads?.().find((candidate) => candidate?.connected) ?? null;
    const name = pad ? pad.id : '';
    if (name === padName && padStatus.textContent) return;
    padName = name;
    padStatus.textContent = pad
      ? `Gamepad conectado: ${pad.id}. Analógico esquerdo vira, RT acelera, LT freia, A faz drift, RB olha para trás.`
      : 'Gamepad: conecte um controle e aperte qualquer botão. Analógico esquerdo vira, RT acelera, LT freia, A faz drift, RB olha para trás.';
  };

  refresh();
  describePad();
  context.ui.append(panel);
  context.setStatus('Configurações');

  return {
    scene: showroom.scene,
    camera: showroom.camera,
    update(delta, time) {
      showroom.update(delta, time);
      describePad();
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown, true);
      context.ui.replaceChildren();
      showroom.dispose();
    },
  };
}
