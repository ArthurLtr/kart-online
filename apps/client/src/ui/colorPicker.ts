import type { Hsv } from '../cosmetics/color';
import { hexToHsv, hsvToHex, isHex, parseHex } from '../cosmetics/color';
import { btn, el } from './dom';

/** Cores prontas do seletor. */
export const PALETTE = [
  '#f2f2ee',
  '#9aa0aa',
  '#2a2d34',
  '#0d0e11',
  '#d3222a',
  '#ff5a1f',
  '#f0b90f',
  '#dcff2e',
  '#149a52',
  '#12b5a6',
  '#2b48c9',
  '#3d8bff',
  '#6a35d9',
  '#c22fb0',
  '#ff6fae',
  '#7a4a2b',
] as const;

const RECENT_KEY = 'kart-online.cores';
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter(isHex).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export interface ColorPicker {
  element: HTMLElement;
  /** Mostra uma cor sem avisar ninguém. */
  set(hex: string): void;
}

/**
 * Seletor de cor: campo de saturação e brilho, barra de matiz, código hex,
 * paleta pronta e cores recentes.
 * @param onChange `final` é falso enquanto o jogador arrasta
 */
export function createColorPicker(onChange: (hex: string, final: boolean) => void): ColorPicker {
  const root = el('div', 'cor');
  let hsv: Hsv = { h: 0, s: 0, v: 1 };
  let recent = loadRecent();

  const field = el('div', 'cor-campo');
  field.tabIndex = 0;
  field.setAttribute('role', 'slider');
  field.setAttribute('aria-label', 'Saturação e brilho (use as setas)');
  const thumb = el('span', 'cor-ponto');
  field.append(thumb);

  const hue = el('input', 'cor-matiz');
  hue.type = 'range';
  hue.min = '0';
  hue.max = '359';
  hue.setAttribute('aria-label', 'Matiz');

  const row = el('div', 'cor-linha');
  const sample = el('span', 'cor-amostra');
  const hex = el('input', 'cor-hex');
  hex.type = 'text';
  hex.maxLength = 7;
  hex.spellcheck = false;
  hex.setAttribute('aria-label', 'Código hex da cor');
  row.append(sample, hex);

  const palette = el('div', 'cor-paleta');
  const recents = el('div', 'cor-paleta');
  const recentTitle = el('p', 'cor-rotulo', 'Recentes');

  const swatch = (color: string): HTMLButtonElement => {
    const button = btn('cor-opcao', '', () => {
      hsv = hexToHsv(color);
      draw();
      commit(true);
    });
    button.style.background = color;
    button.title = color;
    button.setAttribute('aria-label', `Cor ${color}`);
    return button;
  };
  palette.append(...PALETTE.map(swatch));

  function drawRecent(): void {
    recents.replaceChildren(...recent.map(swatch));
    recentTitle.hidden = recents.hidden = recent.length === 0;
  }

  function draw(): void {
    const color = hsvToHex(hsv);
    field.style.setProperty('--matiz', `hsl(${hsv.h} 100% 50%)`);
    thumb.style.left = `${hsv.s * 100}%`;
    thumb.style.top = `${(1 - hsv.v) * 100}%`;
    thumb.style.background = color;
    sample.style.background = color;
    hue.value = String(Math.round(hsv.h));
    if (document.activeElement !== hex) hex.value = color.toUpperCase();
    field.setAttribute('aria-valuetext', color);
  }

  function commit(final: boolean): void {
    const color = hsvToHex(hsv);
    if (final) {
      recent = [color, ...recent.filter((other) => other !== color)].slice(0, RECENT_MAX);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
      } catch {
        // Sem armazenamento: as recentes valem só nesta sessão.
      }
      drawRecent();
    }
    onChange(color, final);
  }

  const pick = (event: PointerEvent): void => {
    const box = field.getBoundingClientRect();
    hsv = {
      h: hsv.h,
      s: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      v: 1 - Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
    draw();
    commit(false);
  };
  field.addEventListener('pointerdown', (event) => {
    field.setPointerCapture(event.pointerId);
    pick(event);
  });
  field.addEventListener('pointermove', (event) => {
    if (field.hasPointerCapture(event.pointerId)) pick(event);
  });
  field.addEventListener('pointerup', () => commit(true));
  field.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const delta = move[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    hsv = {
      h: hsv.h,
      s: Math.min(1, Math.max(0, hsv.s + delta[0])),
      v: Math.min(1, Math.max(0, hsv.v + delta[1])),
    };
    draw();
    commit(true);
  });
  hue.addEventListener('input', () => {
    hsv = { ...hsv, h: Number(hue.value) };
    draw();
    commit(false);
  });
  hue.addEventListener('change', () => commit(true));
  hex.addEventListener('input', () => {
    const parsed = hex.value.length >= 6 ? parseHex(hex.value) : null;
    hex.dataset.invalido = String(parsed === null);
    if (!parsed) return;
    hsv = hexToHsv(parsed);
    draw();
    commit(true);
  });
  hex.addEventListener('blur', () => {
    hex.dataset.invalido = 'false';
    draw();
  });

  root.append(field, hue, row, el('p', 'cor-rotulo', 'Paleta'), palette, recentTitle, recents);
  drawRecent();
  draw();

  return {
    element: root,
    set(color) {
      // Cinzas não têm matiz: mantém o que estava na barra.
      const next = hexToHsv(color);
      hsv = next.s === 0 ? { ...next, h: hsv.h } : next;
      draw();
    },
  };
}
