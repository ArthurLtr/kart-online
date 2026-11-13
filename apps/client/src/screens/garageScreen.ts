import { Color, Group, PerspectiveCamera, PMREMGenerator, Scene, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Loadout } from '../cosmetics/catalog';
import { CATALOG, findDesign, loadLoadout, saveLoadout, SLOT_LABELS } from '../cosmetics/catalog';
import { applyLoadout } from '../cosmetics/apply';
import type { KartPaint, StickerSurface, ZoneId } from '../cosmetics/paint';
import { loadPaint, ORIGINAL_BLUE, samePaint, savePaint, solidPaint } from '../cosmetics/paint';
import type { Driver } from '../models/driver';
import { createDriver } from '../models/driver';
import type { PilotPose } from '../models/pilot/PilotRig';
import { isUnlocked, refreshAccount, saveAccountLook, sessionToken } from '../net/account';
import { disposeTree } from '../render/dispose';
import {
  createRoom,
  createStudioLights,
  createTurntable,
  TURNTABLE_HEIGHT,
} from '../render/studio';
import { quality } from '../settings';
import { arrowNavigation } from '../ui/arrows';
import { setHints } from '../ui/shell';
import { createPaintEditor } from './paintEditor';
import { createHistory } from '../cosmetics/history';
import type { Preset } from '../cosmetics/presets';
import { loadPresets, savePresets } from '../cosmetics/presets';
import { createPresetEditor } from './presetEditor';
import { createStickerEditor } from './stickerEditor';
import { createWheelEditor } from './wheelEditor';
import type { AppContext, GameScreen } from './types';

type Slot = keyof Loadout;
type Triple = readonly [number, number, number];

/** Para onde a câmera vai ao abrir uma categoria. */
interface Focus {
  target: Triple;
  /** Posição da câmera em relação ao alvo. */
  offset: Triple;
  /** A plataforma segue girando (só nas vistas do kart inteiro). */
  spin: boolean;
}

interface Category {
  /** Item do loadout que a categoria troca (os adesivos fazem parte da pintura do kart). */
  slot: Slot;
  group: string;
  focus: Focus;
  /** Categoria sem itens de catálogo, só com editor. */
  panel?: 'stickers' | 'presets';
}

/** O que o desfazer/refazer guarda: itens do catálogo e pintura livre. */
interface Look {
  loadout: Loadout;
  paint: KartPaint | null;
}

const STICKERS_LABEL = 'Adesivos e número';

const OVERVIEW: Focus = { target: [0, 0.75, 0], offset: [2.7, 0.8, 3.4], spin: true };
const HELMET: Triple = [0, 1.38, -0.25];

/** Alvos medidos com a plataforma de frente e o piloto sentado. */
export const CATEGORIES: readonly Category[] = [
  { slot: 'livery', group: 'Kart', focus: OVERVIEW },
  {
    slot: 'rim',
    group: 'Kart',
    focus: { target: [0.46, 0.34, 0.51], offset: [1.2, 0.25, 1.1], spin: false },
  },
  {
    slot: 'livery',
    group: 'Kart',
    panel: 'stickers',
    focus: { target: [0, 0.5, 0.35], offset: [0.9, 2.1, 1.6], spin: false },
  },
  {
    slot: 'helmetModel',
    group: 'Piloto',
    focus: { target: HELMET, offset: [0.95, 0.15, 1.05], spin: false },
  },
  {
    slot: 'helmetPaint',
    group: 'Piloto',
    focus: { target: HELMET, offset: [1.05, 0.25, 0.95], spin: false },
  },
  {
    slot: 'visor',
    group: 'Piloto',
    focus: { target: HELMET, offset: [0.3, 0.05, 1.3], spin: false },
  },
  {
    slot: 'suit',
    group: 'Piloto',
    focus: { target: [0, 0.85, -0.15], offset: [1.2, 0.35, 1.7], spin: false },
  },
  {
    slot: 'gloves',
    group: 'Piloto',
    focus: { target: [0.05, 0.68, 0.05], offset: [0.7, 0.45, 0.9], spin: false },
  },
  {
    slot: 'boots',
    group: 'Piloto',
    focus: { target: [0, 0.4, 0.33], offset: [0.9, 0.55, 1.1], spin: false },
  },
  {
    slot: 'trail',
    group: 'Efeitos',
    focus: { target: [0, 0.6, -0.4], offset: [-2.6, 1.0, -3.6], spin: false },
  },
  { slot: 'livery', group: 'Visuais', panel: 'presets', focus: OVERVIEW },
];

/** Vistas das zonas de pintura (plataforma de frente). */
const ZONE_FOCUS: Record<ZoneId, Focus> = {
  fairing: { target: [0, 0.5, 0.35], offset: [1.9, 0.9, 2.4], spin: false },
  seat: { target: [0, 0.5, -0.6], offset: [-1.5, 1.0, -1.7], spin: false },
  floor: { target: [0, 0.3, 0.1], offset: [1.0, 1.9, 1.0], spin: false },
  details: { target: [0, 0.5, 0], offset: [-2.2, 1.2, 2.6], spin: false },
};

/** Vistas das superfícies dos adesivos (plataforma de frente). */
const SURFACE_FOCUS: Record<StickerSurface, Focus> = {
  top: { target: [0, 0.5, 0.35], offset: [0.9, 2.1, 1.6], spin: false },
  left: { target: [0, 0.45, 0], offset: [3.2, 0.5, 0.4], spin: false },
  right: { target: [0, 0.45, 0], offset: [-3.2, 0.5, 0.4], spin: false },
  front: { target: [0, 0.45, 0.4], offset: [0.4, 0.6, 2.9], spin: false },
};

const categoryLabel = (category: Category): string =>
  category.panel === 'stickers'
    ? STICKERS_LABEL
    : category.panel === 'presets'
      ? 'Visuais salvos'
      : SLOT_LABELS[category.slot];

const POSES: { id: PilotPose; label: string }[] = [
  { id: 'seated', label: 'No kart' },
  { id: 'standing', label: 'Em pé' },
  { id: 'celebrate', label: 'Comemoração' },
];

/** Imagens de referencias/ para comparar lado a lado (só no servidor de desenvolvimento). */
const REFERENCES = [
  'referencia piloto.jpg',
  'referencia piloto2.jpg',
  'referencia piloto3.jpg',
  'referencia piloto4.jpg',
  'referencia piloto5.jpg',
  'referencia piloto6.jpg',
];

/** Cores que resumem um item na lista (vazio = item sem cor própria). */
export function swatchColors(slot: Slot, id: string): string[] {
  switch (slot) {
    case 'livery':
      return [findDesign('livery', id).color ?? '#2b48c9'];
    case 'rim':
      return [findDesign('rim', id).color ?? '#c9ccd2'];
    case 'suit': {
      const suit = findDesign('suit', id);
      return [suit.base, suit.yoke, suit.accent];
    }
    case 'gloves': {
      const gloves = findDesign('gloves', id);
      return [gloves.color, gloves.cuff];
    }
    case 'boots': {
      const boots = findDesign('boots', id);
      return [boots.color, boots.sole];
    }
    case 'helmetPaint': {
      const paint = findDesign('helmetPaint', id);
      return [paint.base, paint.stripe, paint.accent];
    }
    case 'visor':
      return [findDesign('visor', id).color];
    case 'trail': {
      const color = findDesign('trail', id).color;
      return color ? [color] : [];
    }
    default:
      return [];
  }
}

/** Fundo CSS da amostra: as cores do item em faixas diagonais. */
function swatchBackground(colors: readonly string[]): string {
  if (colors.length === 0) return '';
  if (colors.length === 1) return colors[0]!;
  const stops = colors.length === 2 ? [58, 100] : [50, 76, 100];
  let from = 0;
  const parts = colors.map((color, index) => {
    const part = `${color} ${from}% ${stops[index]}%`;
    from = stops[index]!;
    return part;
  });
  return `linear-gradient(135deg, ${parts.join(', ')})`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  if (className) created.className = className;
  created.textContent = text;
  return created;
}

function actionButton(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const created = element('button', className, label);
  created.type = 'button';
  created.addEventListener('click', onClick);
  return created;
}

const itemName = (slot: Slot, id: string): string =>
  (CATALOG[slot] as readonly { id: string; name: string }[]).find((item) => item.id === id)?.name ??
  id;

/**
 * Garagem: o kart e o piloto no estúdio, categorias à esquerda, itens ao lado
 * e a câmera que voa até a peça em edição. O visual só vale depois de Aplicar.
 */
export function createGarageScreen(context: AppContext): GameScreen {
  const { renderer, canvas, models, ui } = context;
  const scene = new Scene();
  scene.background = new Color(0x15171b);
  const camera = new PerspectiveCamera(36, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 0.6;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.target.set(...OVERVIEW.target);
  camera.position.set(...OVERVIEW.target).add(new Vector3(...OVERVIEW.offset));

  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.6;

  const turntable = createTurntable();
  const stage = new Group(); // tudo o que gira junto com a plataforma
  stage.position.y = TURNTABLE_HEIGHT;
  turntable.add(stage);
  scene.add(createRoom(), turntable);
  createStudioLights(scene, quality().shadowMap);

  let disposed = false;
  let driver: Driver | undefined;
  let applied = loadLoadout();
  let preview: Loadout = { ...applied };
  let appliedPaint = loadPaint();
  let previewPaint: KartPaint | null = appliedPaint;
  let paintQueued = false;
  let presets = loadPresets();
  const sameLook = (a: Look, b: Look): boolean =>
    samePaint(a.paint, b.paint) &&
    (Object.keys(a.loadout) as Slot[]).every((slot) => a.loadout[slot] === b.loadout[slot]);
  const look = (): Look => ({ loadout: { ...preview }, paint: previewPaint });
  const history = createHistory<Look>(look(), sameLook);
  const restore = (state: Look | null): void => {
    if (!state) return;
    preview = { ...state.loadout };
    previewPaint = state.paint;
    refreshEditors();
    showPreview();
  };
  let pose: PilotPose = 'seated';
  let category = CATEGORIES[0]!;
  // Com movimento reduzido no sistema, a plataforma começa parada (o botão Girar liga).
  let spinning = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let flying = true;
  let requestId = 0;
  const wantedTarget = new Vector3(...OVERVIEW.target);
  const wantedPosition = new Vector3();
  const stopFlying = (): void => {
    flying = false;
  };
  controls.addEventListener('start', stopFlying);

  // --- categorias ------------------------------------------------------------
  const rail = element('nav', 'gar-categorias');
  rail.setAttribute('aria-label', 'Categorias');
  const categoryButtons = new Map<Category, { button: HTMLButtonElement; value: HTMLElement }>();
  let lastGroup = '';
  for (const entry of CATEGORIES) {
    if (entry.group !== lastGroup) {
      lastGroup = entry.group;
      rail.append(element('p', 'gar-grupo', entry.group));
    }
    const button = actionButton('gar-categoria', '', () => openCategory(entry));
    const value = element('span', 'gar-categoria-valor');
    button.append(element('span', 'gar-categoria-nome', categoryLabel(entry)), value);
    categoryButtons.set(entry, { button, value });
    rail.append(button);
  }

  // --- itens -----------------------------------------------------------------
  const panel = element('section', 'gar-itens');
  const heading = element('header', 'gar-itens-topo');
  const grid = element('div', 'gar-grade');
  const note = element('p', 'nota gar-aviso');
  const setPaint = (paint: KartPaint, final = true): void => {
    previewPaint = paint;
    // Arrastar um controle é um passo só: entra no histórico quando solta.
    if (final) history.push(look());
    refreshState();
    // Arrastando um controle chegam muitas mudanças por quadro: pinta uma vez por quadro.
    if (paintQueued || !driver) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      if (driver && !disposed) applyLoadout({ kart: driver.kart }, preview, previewPaint);
    });
  };
  /** A pintura em edição; partindo de uma pintura pronta, começa da cor dela. */
  const currentPaint = (): KartPaint =>
    previewPaint ?? solidPaint(findDesign('livery', preview.livery).color ?? ORIGINAL_BLUE);
  const editor = createPaintEditor({
    paint: () => previewPaint,
    livery: () => preview.livery,
    setPaint,
    setLivery(id) {
      previewPaint = null;
      preview = { ...preview, livery: id };
      history.push(look());
      showPreview();
    },
    focusZone: (zone) => flyTo(ZONE_FOCUS[zone]),
  });
  const wheelEditor = createWheelEditor({ paint: currentPaint, setPaint });
  const stickerEditor = createStickerEditor({
    paint: currentPaint,
    setPaint,
    focusSurface: (surface) => flyTo(SURFACE_FOCUS[surface]),
  });
  /** Presets ficam guardados na hora, sem depender do Aplicar. */
  const storePresets = (next: Preset[], status: string): void => {
    presets = next;
    savePresets(presets);
    refreshEditors();
    refreshState();
    context.setStatus(status);
    if (!sessionToken()) return;
    saveAccountLook(applied, appliedPaint, presets).catch((erro: unknown) => {
      context.setStatus(erro instanceof Error ? erro.message : 'Não consegui salvar.', true);
    });
  };
  const presetEditor = createPresetEditor({
    presets: () => presets,
    colors: (preset) =>
      [
        preset.paint?.zones.fairing.color ?? swatchColors('livery', preset.loadout.livery)[0],
        swatchColors('suit', preset.loadout.suit)[0],
        swatchColors('helmetPaint', preset.loadout.helmetPaint)[0],
        preset.paint?.wheels.color ?? swatchColors('rim', preset.loadout.rim)[0],
      ].filter((color): color is string => typeof color === 'string'),
    isCurrent: (preset) => sameLook(preset, look()),
    save: (name) => storePresets([...presets, { name, ...look() }], `Visual "${name}" salvo`),
    overwrite: (index) =>
      storePresets(
        presets.map((preset, i) => (i === index ? { name: preset.name, ...look() } : preset)),
        `Visual "${presets[index]?.name ?? ''}" atualizado`,
      ),
    use(index) {
      const preset = presets[index];
      if (!preset) return;
      preview = { ...preset.loadout };
      previewPaint = preset.paint;
      history.push(look());
      refreshEditors();
      showPreview();
      context.setStatus(`Visual "${preset.name}" no kart. Aplique para usar nas corridas.`);
    },
    remove: (index) =>
      storePresets(
        presets.filter((_, i) => i !== index),
        'Visual removido',
      ),
  });
  const refreshEditors = (): void => {
    editor.refresh();
    wheelEditor.refresh();
    stickerEditor.refresh();
    presetEditor.refresh();
  };
  editor.element.hidden =
    wheelEditor.element.hidden =
    stickerEditor.element.hidden =
    presetEditor.element.hidden =
      true;
  panel.append(
    heading,
    grid,
    editor.element,
    wheelEditor.element,
    stickerEditor.element,
    presetEditor.element,
    note,
  );
  let itemButtons = new Map<string, HTMLButtonElement>();

  function renderItems(): void {
    const stickers = category.panel === 'stickers';
    const saved = category.panel === 'presets';
    const painting = category.slot === 'livery';
    const wheels = category.slot === 'rim';
    grid.hidden = painting;
    editor.element.hidden = !painting || category.panel !== undefined;
    presetEditor.element.hidden = !saved;
    wheelEditor.element.hidden = !wheels;
    // Nos aros, os itens prontos rolam junto com o editor de cor livre.
    if (wheels) wheelEditor.element.prepend(grid);
    else panel.insertBefore(grid, editor.element);
    stickerEditor.element.hidden = !stickers;
    refreshEditors();
    const items = painting
      ? []
      : (CATALOG[category.slot] as readonly { id: string; name: string }[]);
    const position = CATEGORIES.indexOf(category) + 1;
    heading.replaceChildren(
      element('p', 'sobretitulo', `${category.group} · ${String(position).padStart(2, '0')}`),
      element('h2', 'gar-titulo', categoryLabel(category)),
      element(
        'p',
        'nota',
        saved
          ? 'Guarde combinações completas de kart e piloto'
          : stickers
            ? 'Camadas com posição, tamanho, giro, cor e opacidade'
            : painting
              ? 'Cor livre, acabamento e padrão por zona'
              : wheels
                ? 'Aros prontos, ou cor livre e faixa no pneu'
                : `${items.length} ${items.length === 1 ? 'opção' : 'opções'}`,
      ),
    );
    itemButtons = new Map();
    grid.replaceChildren(
      ...items.map((item, index) => {
        const card = actionButton('gar-item', '', () => {
          preview = { ...preview, [category.slot]: item.id };
          // Escolher um aro pronto larga a cor livre do aro.
          if (wheels && previewPaint?.wheels.color)
            previewPaint = { ...previewPaint, wheels: { ...previewPaint.wheels, color: null } };
          history.push(look());
          refreshEditors();
          showPreview();
        });
        card.style.setProperty('--ordem', String(index));
        const swatch = element('span', 'gar-amostra');
        const colors = swatchColors(category.slot, item.id);
        if (colors.length > 0) swatch.style.background = swatchBackground(colors);
        else swatch.dataset.vazio = 'true';
        card.append(
          swatch,
          element('span', 'gar-item-nome', item.name),
          element('span', 'gar-item-estado'),
        );
        itemButtons.set(item.id, card);
        return card;
      }),
    );
  }

  // --- barra inferior: vista e ações -----------------------------------------
  const bar = element('div', 'gar-barra');
  const view = element('div', 'botoes');
  const poseButtons = new Map<PilotPose, HTMLButtonElement>();
  for (const item of POSES) {
    const button = actionButton('', item.label, () => {
      setPose(item.id);
      if (item.id !== 'seated') flyTo(OVERVIEW);
    });
    poseButtons.set(item.id, button);
    view.append(button);
  }
  const spinButton = actionButton('', 'Girar', () => {
    spinning = !spinning;
    refreshState();
  });
  view.append(spinButton);
  const actions = element('div', 'botoes gar-acoes');
  const pending = element('span', 'gar-pendente');
  const undoButton = actionButton('gar-historico', '↶', () => restore(history.undo()));
  undoButton.setAttribute('aria-label', 'Desfazer');
  undoButton.title = 'Desfazer (Ctrl+Z)';
  const redoButton = actionButton('gar-historico', '↷', () => restore(history.redo()));
  redoButton.setAttribute('aria-label', 'Refazer');
  redoButton.title = 'Refazer (Ctrl+Y)';
  const onHistoryKey = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    // Num campo de texto, o Ctrl+Z é do próprio campo.
    const target = event.target;
    if (target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'search'))
      return;
    event.preventDefault();
    restore(key === 'y' || event.shiftKey ? history.redo() : history.undo());
  };
  window.addEventListener('keydown', onHistoryKey);
  const discardButton = actionButton('', 'Descartar', () => {
    preview = { ...applied };
    previewPaint = appliedPaint;
    history.push(look());
    refreshEditors();
    showPreview();
  });
  const applyButton = actionButton('primario', 'Aplicar', () => {
    applied = { ...preview };
    appliedPaint = previewPaint;
    saveLoadout(applied);
    savePaint(appliedPaint);
    refreshState();
    context.setStatus('Visual aplicado');
    if (sessionToken()) {
      saveAccountLook(applied, appliedPaint, presets)
        .then(() => context.setStatus('Visual salvo na sua conta'))
        .catch((erro: unknown) => {
          context.setStatus(erro instanceof Error ? erro.message : 'Não consegui salvar.', true);
        });
    }
  });
  actions.append(pending, undoButton, redoButton, discardButton, applyButton);
  bar.append(view, actions);

  function refreshState(): void {
    const slots = Object.keys(preview) as Slot[];
    for (const [item, entry] of categoryButtons) {
      const slot = item.slot;
      entry.button.setAttribute('aria-current', String(item === category));
      const count = previewPaint?.stickers.length ?? 0;
      entry.value.textContent =
        item.panel === 'presets'
          ? `${presets.length} ${presets.length === 1 ? 'salvo' : 'salvos'}`
          : item.panel === 'stickers'
            ? `${count} ${count === 1 ? 'adesivo' : 'adesivos'}${previewPaint?.number ? ` · nº ${previewPaint.number}` : ''}`
            : slot === 'livery' && previewPaint !== null
              ? 'Personalizada'
              : slot === 'rim' && previewPaint?.wheels.color
                ? 'Cor livre'
                : itemName(slot, preview[slot]);
      entry.button.dataset.alterado = String(
        item.panel === undefined &&
          (preview[slot] !== applied[slot] ||
            (slot === 'livery' && !samePaint(previewPaint, appliedPaint))),
      );
    }
    for (const [id, card] of itemButtons) {
      const locked = !isUnlocked(category.slot, id);
      const equipped = applied[category.slot] === id;
      card.setAttribute('aria-pressed', String(preview[category.slot] === id));
      card.dataset.bloqueado = String(locked);
      const state = card.lastElementChild!;
      state.textContent = locked ? 'Bloqueado' : equipped ? 'Equipado' : '';
    }
    for (const [id, button] of poseButtons)
      button.setAttribute('aria-pressed', String(id === pose));
    spinButton.setAttribute('aria-pressed', String(spinning));
    undoButton.disabled = !history.canUndo();
    redoButton.disabled = !history.canRedo();
    const changed = slots.filter(
      (slot) =>
        preview[slot] !== applied[slot] ||
        (slot === 'livery' && !samePaint(previewPaint, appliedPaint)),
    );
    // Com pintura livre, a pintura pronta escolhida por baixo não conta.
    const locked = slots.filter(
      (slot) => !(slot === 'livery' && previewPaint) && !isUnlocked(slot, preview[slot]),
    );
    discardButton.disabled = changed.length === 0;
    applyButton.disabled = changed.length === 0 || locked.length > 0;
    pending.textContent =
      changed.length === 0
        ? ''
        : `${changed.length} ${changed.length === 1 ? 'alteração' : 'alterações'} sem aplicar`;
    // Item bloqueado pode ser visto no kart, mas não aplicado.
    note.textContent =
      locked.length > 0
        ? `Só pré-visualização: ${locked.map((slot) => itemName(slot, preview[slot])).join(', ')} ainda não está no seu inventário.`
        : '';
  }

  function showPreview(): void {
    refreshState();
    const id = ++requestId;
    void driver?.setLoadout({ ...preview }, previewPaint).then(() => {
      if (id === requestId && !disposed) setPose(pose);
    });
  }

  function setPose(next: PilotPose): void {
    pose = next;
    refreshState();
    if (!driver) return;
    const pilot = driver.pilot;
    if (next === 'seated') {
      driver.kart.add(pilot.root);
      pilot.root.position.set(0, 0, 0);
    } else {
      // Em pé ao lado do kart, na pose das imagens de referência.
      stage.add(pilot.root);
      pilot.root.position.set(1.35, 0, 0.1);
    }
    pilot.setPose(next);
  }

  let focus = OVERVIEW;
  function flyTo(next: Focus): void {
    focus = next;
    spinning = next.spin;
    flying = true;
    refreshState();
  }

  function openCategory(next: Category): void {
    category = next;
    renderItems();
    // As vistas de perto foram medidas com o piloto sentado.
    if (next.focus !== OVERVIEW && pose !== 'seated') setPose('seated');
    flyTo(next.focus);
  }

  ui.append(rail, panel, bar);
  const stopArrows = [arrowNavigation(rail), arrowNavigation(grid)];

  // --- referências (só em desenvolvimento; nunca entram no build) -------------
  if (import.meta.env.DEV) {
    const figure = element('figure', 'gar-referencia');
    figure.hidden = true;
    const image = element('img', '');
    let index = 2;
    const show = (next: number): void => {
      index = (next + REFERENCES.length) % REFERENCES.length;
      image.src = `/referencias/${encodeURIComponent(REFERENCES[index]!)}`;
      image.alt = `Imagem de referência ${index + 1} de ${REFERENCES.length}`;
    };
    image.addEventListener('click', () => show(index + 1));
    figure.append(image);
    view.append(
      actionButton('', 'Referência', () => {
        figure.hidden = !figure.hidden;
        if (!figure.hidden) show(index);
      }),
    );
    ui.append(figure);
  }

  openCategory(category);
  categoryButtons.get(category)?.button.focus({ preventScroll: true });
  context.setStatus('Garagem · carregando…');
  setHints([
    { keys: ['↑', '↓'], label: 'Navegar' },
    { keys: ['Enter'], label: 'Pré-visualizar' },
    { keys: ['Ctrl', 'Z'], label: 'Desfazer' },
    { keys: ['Arrastar'], label: 'Girar a câmera' },
  ]);

  // Com conta, o inventário e o loadout do servidor mandam.
  void refreshAccount()
    .then((me) => {
      if (disposed || !me) return;
      applied = loadLoadout();
      preview = { ...applied };
      appliedPaint = loadPaint();
      previewPaint = appliedPaint;
      presets = loadPresets();
      history.reset(look());
      refreshEditors();
      showPreview();
    })
    .catch(() => {
      // Servidor fora do ar: a garagem segue com o que está neste navegador.
    });

  createDriver(models, preview, previewPaint)
    .then((created) => {
      if (disposed) {
        disposeTree(created.kart);
        return;
      }
      driver = created;
      // Centraliza o kart na plataforma (o pivô dele fica no eixo traseiro).
      created.kart.position.set(0, 0, -0.6);
      stage.add(created.kart);
      setPose(pose);
      flying = true;
      context.setStatus('Garagem');
    })
    .catch((erro: unknown) => {
      console.error(erro);
      context.setStatus('Não foi possível carregar o kart. Rode "pnpm assets" e recarregue.', true);
    });

  const TURN = Math.PI * 2;
  return {
    scene,
    camera,
    update(delta, time) {
      // Em tela larga a cena vai para a direita, livre dos painéis.
      const wide = camera.aspect > 1.35;
      if (wide !== (camera.view?.enabled ?? false)) {
        // setViewOffset redefine o aspecto pela largura/altura informadas: passa o aspecto atual.
        const aspect = camera.aspect;
        if (wide) camera.setViewOffset(aspect, 1, -0.19 * aspect, 0, aspect, 1);
        else camera.clearViewOffset();
      }
      const ease = 1 - Math.exp(-delta * 4.5);
      if (spinning) {
        turntable.rotation.y = (turntable.rotation.y + delta * 0.3) % TURN;
      } else if (flying) {
        // Volta de frente pelo caminho mais curto, para as vistas de perto baterem.
        const angle = turntable.rotation.y;
        turntable.rotation.y += ((angle > Math.PI ? TURN : 0) - angle) * ease;
      }
      driver?.update(delta, 0, Math.sin(time * 0.6) * 0.2);
      if (flying) {
        wantedTarget.set(...focus.target);
        wantedPosition.set(...focus.offset).add(wantedTarget);
        controls.target.lerp(wantedTarget, ease);
        camera.position.lerp(wantedPosition, ease);
        const settled = camera.position.distanceToSquared(wantedPosition) < 1e-4;
        const angle = turntable.rotation.y % TURN;
        if (settled && (spinning || Math.min(angle, TURN - angle) < 0.002)) flying = false;
      }
      controls.update(delta);
    },
    dispose() {
      disposed = true;
      for (const stop of stopArrows) stop();
      window.removeEventListener('keydown', onHistoryKey);
      controls.removeEventListener('start', stopFlying);
      controls.dispose();
      camera.clearViewOffset();
      ui.replaceChildren();
      disposeTree(scene);
      environment.dispose();
    },
  };
}
