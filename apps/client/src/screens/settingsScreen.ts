import type { Action, Quality, TouchSize, TouchSteer } from '../settings';
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
  TOUCH_SIZES,
  TOUCH_STEER,
  updateSettings,
} from '../settings';
import { isTouchDevice } from '../ui/mobile';
import { btn, el } from '../ui/dom';
import type { SectionDef } from '../ui/sections';
import { block, createSections, stat, toggleRow } from '../ui/sections';
import { setHints } from '../ui/shell';
import { createShowroom } from './showroom';
import type { AppContext, GameScreen } from './types';

const GAMEPAD_MAP: readonly (readonly [string, string])[] = [
  ['Analógico esquerdo', 'Virar'],
  ['RT', 'Acelerar'],
  ['LT', 'Frear / ré'],
  ['A', 'Drift'],
  ['RB', 'Olhar para trás'],
];

/** Configurações: preset gráfico, áudio, teclas e gamepad. */
export function createSettingsScreen(context: AppContext): GameScreen {
  const showroom = createShowroom(context);
  const gpu = gpuName(context.renderer.getContext());
  const touchDevice = isTouchDevice();
  const suggested = touchDevice ? 'baixo' : suggestQuality(gpu, navigator.hardwareConcurrency ?? 4);
  const sections = createSections('Seções das configurações');
  let listening: { action: Action; index: 0 | 1 } | null = null;

  const connectedPad = (): Gamepad | null =>
    navigator.getGamepads?.().find((candidate) => candidate?.connected) ?? null;

  function renderGraphics(body: HTMLElement): void {
    const settings = getSettings();
    const preset = QUALITY[settings.quality];
    const row = el('div', 'botoes seg');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Qualidade gráfica');
    for (const name of QUALITY_NAMES) {
      const button = btn('', QUALITY[name].label, () => {
        updateSettings({ quality: name as Quality });
        sections.refresh();
        row.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
      });
      button.setAttribute('aria-pressed', String(name === settings.quality));
      if (name === suggested) button.dataset.sugerido = 'true';
      row.append(button);
    }
    const facts = el('div', 'dados');
    facts.append(
      stat(preset.shadowMap > 0 ? `${preset.shadowMap}` : 'Off', 'Sombras (px)'),
      stat(preset.postfx === 'completo' ? 'Completo' : 'Básico', 'Pós-processamento'),
      stat(`${Math.round(preset.scenery * 100)}%`, 'Cenário'),
      stat(`${preset.pixelRatio}×`, 'Resolução máx.'),
    );
    body.append(
      block(
        'Qualidade',
        row,
        facts,
        el(
          'p',
          'nota',
          `Sugerido para este ${touchDevice ? 'aparelho' : 'computador'}: ${QUALITY[suggested].label}. Resolução e pós-processamento mudam na hora; sombras e cenário, ao entrar na pista.`,
        ),
      ),
      block(
        'Efeitos',
        toggleRow(
          'Borrão de velocidade',
          'Desfoca a imagem em alta velocidade',
          settings.motionBlur,
          (checked) => updateSettings({ motionBlur: checked }),
        ),
        toggleRow(
          'Nomes sobre os karts',
          'Mostra o apelido de cada piloto na corrida',
          settings.nameTags,
          (checked) => updateSettings({ nameTags: checked }),
        ),
      ),
      block('Placa de vídeo', el('p', 'nota', gpu || 'Não informada pelo navegador.')),
    );
  }

  function renderAudio(body: HTMLElement): void {
    const settings = getSettings();
    const volume = el('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '100';
    volume.value = String(Math.round(settings.volume * 100));
    volume.setAttribute('aria-label', 'Volume geral');
    const amount = el('output', 'faixa-valor', `${volume.value}%`);
    volume.addEventListener('input', () => {
      amount.textContent = `${volume.value}%`;
      updateSettings({ volume: Number(volume.value) / 100 });
      sections.refreshValues();
    });
    const row = el('div', 'faixa');
    row.append(volume, amount);
    body.append(
      block('Volume geral', row),
      block(
        'Música',
        toggleRow('Música no menu', 'Toca nas telas fora da corrida', settings.music, (checked) => {
          updateSettings({ music: checked });
          sections.refreshValues();
        }),
      ),
    );
  }

  function renderKeys(body: HTMLElement): void {
    const settings = getSettings();
    const table = el('table', 'teclas');
    const head = table.createTHead().insertRow();
    for (const title of ['Ação', 'Tecla 1', 'Tecla 2']) {
      const cell = el('th', '', title);
      cell.scope = 'col';
      head.append(cell);
    }
    const rows = table.createTBody();
    for (const { action, label } of ACTIONS) {
      const row = rows.insertRow();
      const name = el('th', '', label);
      name.scope = 'row';
      row.append(name);
      for (const index of [0, 1] as const) {
        const waiting = listening?.action === action && listening.index === index;
        const code = settings.keys[action][index];
        const key = btn('tecla', waiting ? 'Pressione…' : code ? keyLabel(code) : '—', () => {
          listening = { action, index };
          sections.refresh();
          context.setStatus(`Pressione a tecla para ${label} · Esc cancela`);
        });
        key.dataset.ouvindo = String(waiting);
        key.dataset.acao = `${action}:${index}`;
        key.setAttribute('aria-label', `${label}, tecla ${index + 1}: ${key.textContent ?? ''}`);
        row.insertCell().append(key);
      }
    }
    const actions = el('div', 'botoes');
    actions.append(
      btn('', 'Restaurar teclas padrão', () => {
        listening = null;
        updateSettings({ keys: DEFAULT_KEYS });
        sections.refresh();
        context.setStatus('Teclas padrão restauradas');
      }),
    );
    body.append(
      block('Teclado', table),
      el('p', 'nota', 'Clique numa tecla e pressione a nova. Esc cancela a troca.'),
      actions,
    );
    // Depois de redesenhar, o foco volta para a tecla que estava em edição.
    if (listening) {
      const { action, index } = listening;
      table.querySelector<HTMLButtonElement>(`[data-acao="${action}:${index}"]`)?.focus();
    }
  }

  const STEER_LABELS: Record<TouchSteer, string> = { arrastar: 'Arrastar', botoes: 'Botões' };
  const SIZE_LABELS: Record<TouchSize, string> = {
    pequeno: 'Pequeno',
    medio: 'Médio',
    grande: 'Grande',
  };

  /** Grupo de botões de escolha única (como o da qualidade). */
  function choice<T extends string>(
    label: string,
    options: readonly T[],
    labels: Record<T, string>,
    current: T,
    pick: (value: T) => void,
  ): HTMLElement {
    const row = el('div', 'botoes seg');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    for (const option of options) {
      const button = btn('', labels[option], () => {
        pick(option);
        sections.refresh();
      });
      button.setAttribute('aria-pressed', String(option === current));
      row.append(button);
    }
    return row;
  }

  function renderTouch(body: HTMLElement): void {
    const settings = getSettings();
    body.append(
      block(
        'Direção',
        choice('Direção no toque', TOUCH_STEER, STEER_LABELS, settings.touchSteer, (touchSteer) =>
          updateSettings({ touchSteer }),
        ),
        el(
          'p',
          'nota',
          'Arrastar: encoste o dedo do lado da direção e deslize para os lados (vira mais ou menos, como um volante). Botões: duas setas.',
        ),
      ),
      block(
        'Botões na tela',
        choice('Tamanho dos botões', TOUCH_SIZES, SIZE_LABELS, settings.touchSize, (touchSize) =>
          updateSettings({ touchSize }),
        ),
        toggleRow(
          'Aceleração automática',
          'O kart acelera sozinho; segure o freio para frear ou dar ré',
          settings.touchAutoAccel,
          (checked) => updateSettings({ touchAutoAccel: checked }),
        ),
        toggleRow(
          'Inverter lados',
          'Pedais à esquerda e direção à direita',
          settings.touchSwap,
          (checked) => updateSettings({ touchSwap: checked }),
        ),
      ),
      el(
        'p',
        'nota',
        touchDevice
          ? 'Vale na próxima corrida. Jogue sempre com o celular deitado.'
          : 'Estes controles aparecem só em celular e tablet.',
      ),
    );
  }

  let padName: string | null = null;
  function renderGamepad(body: HTMLElement): void {
    const pad = connectedPad();
    const list = el('dl', 'mapa');
    for (const [control, action] of GAMEPAD_MAP) {
      list.append(el('dt', '', control), el('dd', '', action));
    }
    const state = el('p', 'estado', pad ? pad.id : 'Nenhum controle conectado');
    state.dataset.ligado = String(pad !== null);
    body.append(
      block(
        'Controle',
        state,
        el(
          'p',
          'nota',
          pad
            ? 'Pronto para usar: o jogo lê o controle junto com o teclado.'
            : 'Conecte um controle e aperte qualquer botão para o navegador reconhecer.',
        ),
      ),
      block('Mapa dos botões', list),
    );
  }

  const defs: SectionDef[] = [
    {
      id: 'graficos',
      group: 'Jogo',
      label: 'Gráficos',
      note: 'Qualidade da imagem e efeitos',
      value: () => QUALITY[getSettings().quality].label,
      render: renderGraphics,
    },
    {
      id: 'audio',
      group: 'Jogo',
      label: 'Áudio',
      note: 'Volume e música',
      value: () =>
        `${Math.round(getSettings().volume * 100)}% · música ${getSettings().music ? 'ligada' : 'desligada'}`,
      render: renderAudio,
    },
    {
      id: 'teclado',
      group: 'Controles',
      label: 'Teclado',
      note: 'Duas teclas para cada ação',
      value: () => `${ACTIONS.length} ações`,
      render: renderKeys,
    },
    {
      id: 'toque',
      group: 'Controles',
      label: 'Toque',
      note: 'Controles na tela do celular',
      value: () =>
        `${STEER_LABELS[getSettings().touchSteer]} · ${getSettings().touchAutoAccel ? 'acelera sozinho' : 'acelerador manual'}`,
      render: renderTouch,
    },
    {
      id: 'gamepad',
      group: 'Controles',
      label: 'Gamepad',
      note: 'Controle com analógico e gatilhos',
      value: () => (connectedPad() ? 'Conectado' : 'Não conectado'),
      render: renderGamepad,
    },
  ];
  sections.set(defs);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!listening) return;
    event.preventDefault();
    event.stopPropagation();
    const { action, index } = listening;
    listening = null;
    if (event.code !== 'Escape') {
      updateSettings({ keys: remapKey(getSettings().keys, action, index, event.code) });
      context.setStatus('Tecla trocada');
    } else {
      context.setStatus('Configurações');
    }
    sections.refresh();
    sections.panel.querySelector<HTMLButtonElement>(`[data-acao="${action}:${index}"]`)?.focus();
  };
  window.addEventListener('keydown', onKeyDown, true);

  context.ui.append(sections.rail, sections.panel);
  sections.rail.querySelector('button')?.focus({ preventScroll: true });
  context.setStatus('Configurações');
  setHints([
    { keys: ['↑', '↓'], label: 'Navegar' },
    { keys: ['Enter'], label: 'Abrir' },
    { keys: ['Tab'], label: 'Ir para as opções' },
  ]);

  return {
    scene: showroom.scene,
    camera: showroom.camera,
    update(delta, time) {
      showroom.update(delta, time);
      // Conectar ou tirar o controle atualiza a seção sem precisar reabrir.
      const name = connectedPad()?.id ?? '';
      if (name !== padName) {
        const first = padName === null;
        padName = name;
        if (!first && sections.current() === 'gamepad') sections.refresh();
        else sections.refreshValues();
      }
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown, true);
      sections.dispose();
      context.ui.replaceChildren();
      showroom.dispose();
    },
  };
}
