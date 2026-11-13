import type { KartPaint, Sticker, StickerSurface } from '../cosmetics/paint';
import {
  clonePaint,
  MAX_STICKERS,
  newSticker,
  sanitizeNumber,
  STICKER_SHAPES,
  STICKER_SURFACES,
} from '../cosmetics/paint';
import { createColorPicker } from '../ui/colorPicker';
import { btn, el } from '../ui/dom';
import type { CustomEditor, CustomHost } from './wheelEditor';
import { section } from './wheelEditor';

export interface StickerHost extends CustomHost {
  /** Leva a câmera para a superfície em que o adesivo é aplicado. */
  focusSurface(surface: StickerSurface): void;
}

const shapeLabel = (sticker: Sticker): string =>
  STICKER_SHAPES.find((shape) => shape.id === sticker.shape)?.label ?? sticker.shape;

interface Slider {
  label: HTMLElement;
  input: HTMLInputElement;
  key: 'x' | 'y' | 'size' | 'rotation' | 'opacity';
  /** Valor do adesivo → posição do controle (0 a 100) e de volta. */
  toInput(value: number): number;
  fromInput(value: number): number;
}

/** Editor de adesivos em camadas e do número do piloto. */
export function createStickerEditor(host: StickerHost): CustomEditor {
  const root = el('div', 'pin');
  let selected = 0;
  let fromPicker = false;

  const edit = (change: (paint: KartPaint) => void, final = true): void => {
    const paint = clonePaint(host.paint());
    change(paint);
    host.setPaint(paint, final);
    sync();
  };
  const editSelected = (change: (sticker: Sticker) => void, final = true): void =>
    edit((paint) => {
      const sticker = paint.stickers[selected];
      if (sticker) change(sticker);
    }, final);

  // --- número do piloto --------------------------------------------------------
  const numberLabel = el('label', 'pin-numero', 'Número');
  const number = el('input');
  number.type = 'text';
  number.inputMode = 'numeric';
  number.maxLength = 3;
  number.placeholder = '—';
  number.setAttribute('aria-label', 'Número do piloto, até três dígitos');
  number.addEventListener('input', () => {
    const value = sanitizeNumber(number.value);
    number.value = value;
    edit((paint) => (paint.number = value), false);
  });
  number.addEventListener('change', () => edit((paint) => (paint.number = number.value)));
  numberLabel.append(number);
  const numberNote = el('p', 'nota');

  // --- camadas -----------------------------------------------------------------
  const addRow = el('div', 'botoes');
  const addButtons = STICKER_SHAPES.map((shape) => {
    const button = btn('', shape.label, () =>
      edit((paint) => {
        paint.stickers.push(newSticker(shape.id));
        selected = paint.stickers.length - 1;
        host.focusSurface('top');
      }),
    );
    button.dataset.item = `sticker:${shape.id}`;
    addRow.append(button);
    return button;
  });
  const layers = el('ol', 'pin-camadas');
  const empty = el('p', 'nota', 'Nenhum adesivo ainda. Escolha uma forma acima para adicionar.');

  // --- adesivo selecionado -----------------------------------------------------
  const surfaceRow = el('div', 'botoes');
  const surfaceButtons = STICKER_SURFACES.map((surface) => {
    const button = btn('', surface.label, () => {
      editSelected((sticker) => {
        // Trocar de superfície leva o adesivo para o lugar de partida dela.
        const start = newSticker(sticker.shape, surface.id);
        sticker.surface = surface.id;
        sticker.x = start.x;
        sticker.y = start.y;
      });
      host.focusSurface(surface.id);
    });
    surfaceRow.append(button);
    return { id: surface.id, button };
  });
  const mirror = btn('', 'Espelhar no outro lado', () =>
    editSelected((sticker) => (sticker.mirror = !sticker.mirror)),
  );
  surfaceRow.append(mirror);

  const slider = (
    text: string,
    key: Slider['key'],
    toInput: Slider['toInput'],
    fromInput: Slider['fromInput'],
  ): Slider => {
    const label = el('label', 'pin-tamanho', text);
    const input = el('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    const apply = (final: boolean): void =>
      editSelected((sticker) => (sticker[key] = fromInput(Number(input.value))), final);
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => apply(true));
    label.append(input);
    return { label, input, key, toInput, fromInput };
  };
  const unit = [(value: number) => value * 100, (value: number) => value / 100] as const;
  const sliders = [
    slider('Horizontal', 'x', ...unit),
    slider('Vertical', 'y', ...unit),
    slider('Tamanho', 'size', ...unit),
    slider(
      'Giro',
      'rotation',
      (value) => (value + 180) / 3.6,
      (value) => Math.round(value * 3.6 - 180),
    ),
    slider('Opacidade', 'opacity', ...unit),
  ];
  const picker = createColorPicker((color, final) => {
    fromPicker = true;
    editSelected((sticker) => (sticker.color = color), final);
    fromPicker = false;
  });
  const details = section(
    'Adesivo selecionado',
    surfaceRow,
    ...sliders.map((item) => item.label),
    picker.element,
  );

  root.append(
    section('Número do piloto', numberLabel, numberNote),
    section('Adicionar adesivo', addRow),
    section('Camadas', layers, empty),
    details,
  );

  function renderLayers(stickers: readonly Sticker[]): void {
    layers.replaceChildren(
      ...stickers.map((sticker, index) => {
        const row = el('li', 'pin-camada');
        row.dataset.atual = String(index === selected);
        const pick = btn('pin-camada-nome', '', () => {
          selected = index;
          host.focusSurface(sticker.surface);
          sync();
        });
        const dot = el('span', 'pin-zona-cor');
        dot.style.background = sticker.color;
        pick.append(dot, el('span', '', `${index + 1}. ${shapeLabel(sticker)}`));
        pick.setAttribute('aria-pressed', String(index === selected));
        const move = (by: number, label: string, text: string): HTMLButtonElement => {
          const button = btn('pin-camada-acao', text, () =>
            edit((paint) => {
              const [item] = paint.stickers.splice(index, 1);
              if (item) paint.stickers.splice(index + by, 0, item);
              selected = index + by;
            }),
          );
          button.setAttribute('aria-label', label);
          button.disabled = index + by < 0 || index + by >= stickers.length;
          return button;
        };
        const remove = btn('pin-camada-acao', '×', () =>
          edit((paint) => {
            paint.stickers.splice(index, 1);
            selected = Math.max(0, Math.min(selected, paint.stickers.length - 1));
          }),
        );
        remove.setAttribute('aria-label', `Remover ${shapeLabel(sticker)}`);
        row.append(
          pick,
          move(1, 'Trazer para cima das outras camadas', '↑'),
          move(-1, 'Mandar para baixo das outras camadas', '↓'),
          remove,
        );
        return row;
      }),
    );
  }

  function sync(): void {
    const paint = host.paint();
    const { stickers } = paint;
    selected = Math.max(0, Math.min(selected, stickers.length - 1));
    if (document.activeElement !== number) number.value = paint.number;
    const placed = stickers.some((sticker) => sticker.shape === 'number');
    numberNote.textContent = !paint.number
      ? 'Digite até três dígitos.'
      : placed
        ? 'O número aparece nos adesivos do tipo Número.'
        : 'Adicione um adesivo do tipo Número para colocá-lo no kart.';
    const full = stickers.length >= MAX_STICKERS;
    for (const button of addButtons) button.disabled = full;
    renderLayers(stickers);
    empty.hidden = stickers.length > 0;
    const sticker = stickers[selected];
    details.hidden = !sticker;
    if (!sticker) return;
    for (const item of surfaceButtons)
      item.button.setAttribute('aria-pressed', String(item.id === sticker.surface));
    mirror.setAttribute('aria-pressed', String(sticker.mirror));
    for (const item of sliders)
      if (document.activeElement !== item.input)
        item.input.value = String(Math.round(item.toInput(sticker[item.key])));
    if (!fromPicker) picker.set(sticker.color);
  }
  sync();

  return { element: root, refresh: sync };
}
