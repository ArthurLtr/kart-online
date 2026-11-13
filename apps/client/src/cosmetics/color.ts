/** Conversões de cor usadas pela pintura e pelo seletor de cor. Tudo em sRGB. */

export type Rgb = readonly [number, number, number];
/** Matiz 0–360, saturação e valor 0–1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const HEX = /^#[0-9a-f]{6}$/i;

export const isHex = (value: unknown): value is string =>
  typeof value === 'string' && HEX.test(value);

/** Aceita "#abc", "abc", "#aabbcc" ou "aabbcc"; devolve "#aabbcc" ou `null`. */
export function parseHex(text: string): string | null {
  const raw = text.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((c) => c + c).join('')}`;
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (channel: number): string =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function rgbToHsv([r, g, b]: Rgb): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max / 255 };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

export const hexToHsv = (hex: string): Hsv => rgbToHsv(hexToRgb(hex));
export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv));

/** Gira o matiz de uma cor (graus). */
export function shiftHue(rgb: Rgb, degrees: number): Rgb {
  const hsv = rgbToHsv(rgb);
  return hsvToRgb({ ...hsv, h: (hsv.h + degrees + 360) % 360 });
}
