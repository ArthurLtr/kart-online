import { LIVERIES } from '../cosmetics/catalog';
import type { FinishId, KartPaint, PatternId, ZoneId } from '../cosmetics/paint';
import {
  clonePaint,
  FINISHES,
  ORIGINAL_BLUE,
  PAINT_ZONES,
  PATTERNS,
  solidPaint,
  ZONE_IDS,
} from '../cosmetics/paint';
import { isUnlocked } from '../net/account';
import { createColorPicker } from '../ui/colorPicker';
import { btn, el } from '../ui/dom';

export interface PaintEditorHost {
  /** Pintura livre em pré-visualização (`null` = pintura pronta do catálogo). */
  paint(): KartPaint | null;
  /** Id da pintura pronta em pré-visualização. */
  livery(): string;
  setPaint(paint: KartPaint, final: boolean): void;
  /** Escolhe uma pintura pronta e larga a pintura livre. */
  setLivery(id: string): void;
  focusZone(zone: ZoneId): void;
}

export interface PaintEditor {
  element: HTMLElement;
  /** Redesenha a partir do estado do anfitrião (depois de Descartar, por exemplo). */
  refresh(): void;
}

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const block = el('section', 'pin-secao');
  block.append(el('h3', 'pin-rotulo', title), ...children);
  return block;
}

/** Editor de pintura do kart: zonas, cor livre, acabamento e padrão. */
export function createPaintEditor(host: PaintEditorHost): PaintEditor {
  const root = el('div', 'pin');
  let zone: ZoneId = 'fairing';
  let allZones = true;
  let target: 'zone' | 'pattern' = 'zone';
  /** Verdadeiro enquanto a mudança vem do próprio seletor (ele já mostra a cor certa). */
  let fromPicker = false;

  const liveryColor = (): string =>
    LIVERIES.find((item) => item.id === host.livery())?.color ?? ORIGINAL_BLUE;
  /** A pintura em edição; partindo de uma pintura pronta, começa da cor dela. */
  const current = (): KartPaint => host.paint() ?? solidPaint(liveryColor());
  const edit = (change: (paint: KartPaint) => void, final = true): void => {
    const paint = clonePaint(current());
    change(paint);
    host.setPaint(paint, final);
    sync();
  };
  const eachZone = (paint: KartPaint, change: (id: ZoneId) => void): void => {
    for (const id of allZones ? ZONE_IDS : [zone]) change(id);
  };

  // --- pinturas prontas --------------------------------------------------------
  const readyRow = el('div', 'pin-prontas');
  const readyButtons = LIVERIES.map((item) => {
    const button = btn('pin-pronta', '', () => {
      host.setLivery(item.id);
      sync();
    });
    button.style.background = item.color ?? ORIGINAL_BLUE;
    button.title = item.name;
    button.setAttribute('aria-label', `Pintura pronta: ${item.name}`);
    readyRow.append(button);
    return { id: item.id, button };
  });

  // --- zonas -------------------------------------------------------------------
  const zoneRow = el('div', 'pin-zonas');
  const zoneButtons = PAINT_ZONES.map((item) => {
    const button = btn('pin-zona', '', () => {
      zone = item.id;
      allZones = false;
      target = 'zone';
      host.focusZone(item.id);
      sync();
    });
    const dot = el('span', 'pin-zona-cor');
    button.append(dot, el('span', '', item.label));
    button.title = item.hint;
    zoneRow.append(button);
    return { id: item.id, button, dot };
  });
  const allButton = btn('pin-zona', 'Kart inteiro', () => {
    allZones = true;
    target = 'zone';
    sync();
  });
  zoneRow.prepend(allButton);

  // --- cor ---------------------------------------------------------------------
  const targetRow = el('div', 'botoes pin-alvo');
  const zoneTarget = btn('', 'Cor da zona', () => {
    target = 'zone';
    sync();
  });
  const patternTarget = btn('', 'Cor do padrão', () => {
    target = 'pattern';
    sync();
  });
  targetRow.append(zoneTarget, patternTarget);
  const picker = createColorPicker((color, final) => {
    fromPicker = true;
    edit((paint) => {
      if (target === 'pattern') paint.pattern.color = color;
      else eachZone(paint, (id) => (paint.zones[id].color = color));
    }, final);
    fromPicker = false;
  });

  // --- acabamento --------------------------------------------------------------
  const finishRow = el('div', 'botoes');
  const finishButtons = FINISHES.map((item) => {
    const button = btn('', item.label, () =>
      edit((paint) => eachZone(paint, (id) => (paint.zones[id].finish = item.id))),
    );
    button.dataset.item = `finish:${item.id}`;
    finishRow.append(button);
    return { id: item.id as FinishId, button };
  });

  // --- padrão ------------------------------------------------------------------
  const patternRow = el('div', 'botoes');
  const patternButtons = PATTERNS.map((item) => {
    const button = btn('', item.label, () => {
      // Escolher um padrão já deixa o seletor na cor dele.
      target = item.id === 'solid' ? 'zone' : 'pattern';
      edit((paint) => (paint.pattern.type = item.id));
    });
    button.dataset.item = `pattern:${item.id}`;
    patternRow.append(button);
    return { id: item.id as PatternId, button };
  });
  const sizeLabel = el('label', 'pin-tamanho', 'Tamanho');
  const size = el('input');
  size.type = 'range';
  size.min = '0';
  size.max = '100';
  size.addEventListener('input', () =>
    edit((paint) => (paint.pattern.size = Number(size.value) / 100), false),
  );
  size.addEventListener('change', () =>
    edit((paint) => (paint.pattern.size = Number(size.value) / 100)),
  );
  sizeLabel.append(size);

  const state = el('p', 'nota pin-estado');
  root.append(
    section('Pinturas prontas', readyRow, state),
    section('Zona', zoneRow),
    section('Cor', targetRow, picker.element),
    section('Acabamento', finishRow),
    section('Padrão', patternRow, sizeLabel),
  );

  function sync(): void {
    const custom = host.paint();
    const paint = current();
    for (const item of readyButtons) {
      const locked = !isUnlocked('livery', item.id);
      item.button.setAttribute('aria-pressed', String(!custom && host.livery() === item.id));
      item.button.dataset.bloqueado = String(locked);
    }
    state.textContent = custom
      ? 'Pintura personalizada em uso.'
      : 'Mexa em qualquer controle abaixo para criar a sua.';
    allButton.setAttribute('aria-pressed', String(allZones));
    for (const item of zoneButtons) {
      item.button.setAttribute('aria-pressed', String(!allZones && item.id === zone));
      item.dot.style.background = paint.zones[item.id].color;
    }
    const shown = paint.zones[zone];
    zoneTarget.setAttribute('aria-pressed', String(target === 'zone'));
    patternTarget.setAttribute('aria-pressed', String(target === 'pattern'));
    patternTarget.disabled = paint.pattern.type === 'solid';
    if (patternTarget.disabled) target = 'zone';
    if (!fromPicker) picker.set(target === 'pattern' ? paint.pattern.color : shown.color);
    for (const item of finishButtons)
      item.button.setAttribute('aria-pressed', String(shown.finish === item.id));
    for (const item of patternButtons)
      item.button.setAttribute('aria-pressed', String(paint.pattern.type === item.id));
    size.disabled = paint.pattern.type === 'solid';
    if (document.activeElement !== size) size.value = String(Math.round(paint.pattern.size * 100));
  }
  sync();

  return { element: root, refresh: sync };
}
