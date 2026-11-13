/**
 * Pintura livre do kart: cor e acabamento por zona, mais um padrão por cima.
 * É só visual — nada daqui chega à simulação.
 */
import { isHex } from './color';

/** Zonas pintáveis do modelo. O índice (a partir de 1) é o valor gravado no mapa de zonas. */
export const PAINT_ZONES = [
  { id: 'fairing', label: 'Carenagem', hint: 'Bico e painel dianteiro' },
  { id: 'seat', label: 'Banco', hint: 'Banco do piloto' },
  { id: 'floor', label: 'Assoalho', hint: 'Bandeja sob os pés' },
  { id: 'details', label: 'Detalhes', hint: 'Pedais, coluna e tampas do motor' },
] as const;
export type ZoneId = (typeof PAINT_ZONES)[number]['id'];
export const ZONE_IDS: readonly ZoneId[] = PAINT_ZONES.map((zone) => zone.id);

export const FINISHES = [
  { id: 'gloss', label: 'Brilhante', roughness: 0.22, metalness: 0 },
  { id: 'matte', label: 'Fosco', roughness: 0.85, metalness: 0 },
  { id: 'metallic', label: 'Metálico', roughness: 0.36, metalness: 0.85 },
  { id: 'pearl', label: 'Perolado', roughness: 0.26, metalness: 0.4 },
  { id: 'chrome', label: 'Cromado', roughness: 0.06, metalness: 1 },
  { id: 'carbon', label: 'Carbono', roughness: 0.42, metalness: 0.25 },
] as const;
export type FinishId = (typeof FINISHES)[number]['id'];

export const PATTERNS = [
  { id: 'solid', label: 'Sólido' },
  { id: 'stripes', label: 'Faixas' },
  { id: 'gradient', label: 'Degradê' },
  { id: 'split', label: 'Bicolor' },
  { id: 'chevron', label: 'Geométrico' },
] as const;
export type PatternId = (typeof PATTERNS)[number]['id'];

export interface ZonePaint {
  color: string;
  finish: FinishId;
}

export interface WheelPaint {
  /** Cor do aro (`null` = o aro escolhido no catálogo). */
  color: string | null;
  finish: FinishId;
  /** Cor da faixa na lateral do pneu (`null` = sem faixa). */
  stripe: string | null;
}

export const STICKER_SHAPES = [
  { id: 'number', label: 'Número' },
  { id: 'star', label: 'Estrela' },
  { id: 'bolt', label: 'Raio' },
  { id: 'flame', label: 'Chama' },
  { id: 'arrow', label: 'Seta' },
  { id: 'band', label: 'Faixa' },
  { id: 'circle', label: 'Círculo' },
  { id: 'checker', label: 'Xadrez' },
] as const;
export type StickerShape = (typeof STICKER_SHAPES)[number]['id'];

/** De onde o adesivo é projetado no kart. */
export const STICKER_SURFACES = [
  { id: 'top', label: 'Cima' },
  { id: 'left', label: 'Esquerda' },
  { id: 'right', label: 'Direita' },
  { id: 'front', label: 'Frente' },
] as const;
export type StickerSurface = (typeof STICKER_SURFACES)[number]['id'];

/** Uma camada de adesivo. As camadas são pintadas na ordem da lista (a última fica por cima). */
export interface Sticker {
  shape: StickerShape;
  surface: StickerSurface;
  /** Posição do centro, 0 a 1, dentro da área do kart vista dessa superfície. */
  x: number;
  y: number;
  /** Tamanho, 0 a 1. */
  size: number;
  /** Giro em graus, de -180 a 180. */
  rotation: number;
  /** Repete o adesivo do outro lado do kart. */
  mirror: boolean;
  color: string;
  opacity: number;
}

export const MAX_STICKERS = 8;

export interface KartPaint {
  zones: Record<ZoneId, ZonePaint>;
  pattern: {
    type: PatternId;
    color: string;
    /** Tamanho do desenho, 0 a 1. */
    size: number;
  };
  wheels: WheelPaint;
  stickers: Sticker[];
  /** Número do piloto (até 3 dígitos; vazio = sem número). Aparece nos adesivos do tipo número. */
  number: string;
}

/** Azul da pintura original do modelo. */
export const ORIGINAL_BLUE = '#2b48c9';

/** Pintura de partida: uma cor só, brilhante, sem padrão, sem adesivos. */
export function solidPaint(color: string = ORIGINAL_BLUE): KartPaint {
  const zones = {} as Record<ZoneId, ZonePaint>;
  for (const id of ZONE_IDS) zones[id] = { color, finish: 'gloss' };
  return {
    zones,
    pattern: { type: 'solid', color: '#f2f2ee', size: 0.5 },
    wheels: { color: null, finish: 'gloss', stripe: null },
    stickers: [],
    number: '',
  };
}

/** Adesivo novo, já num lugar visível da superfície escolhida. */
export function newSticker(shape: StickerShape, surface: StickerSurface = 'top'): Sticker {
  return {
    shape,
    surface,
    x: 0.5,
    y: surface === 'top' ? 0.16 : surface === 'front' ? 0.4 : 0.16,
    size: 0.3,
    rotation: 0,
    mirror: false,
    color: '#f2f2ee',
    opacity: 1,
  };
}

const isFinish = (value: unknown): value is FinishId =>
  FINISHES.some((finish) => finish.id === value);
const isPattern = (value: unknown): value is PatternId =>
  PATTERNS.some((pattern) => pattern.id === value);
const isShape = (value: unknown): value is StickerShape =>
  STICKER_SHAPES.some((shape) => shape.id === value);
const isSurface = (value: unknown): value is StickerSurface =>
  STICKER_SURFACES.some((surface) => surface.id === value);
const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

function sanitizeSticker(value: unknown): Sticker | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<Sticker>;
  if (!isShape(raw.shape)) return null;
  const base = newSticker(raw.shape, isSurface(raw.surface) ? raw.surface : 'top');
  return {
    ...base,
    x: clamp(raw.x, 0, 1, base.x),
    y: clamp(raw.y, 0, 1, base.y),
    size: clamp(raw.size, 0, 1, base.size),
    rotation: clamp(raw.rotation, -180, 180, 0),
    mirror: raw.mirror === true,
    color: isHex(raw.color) ? raw.color.toLowerCase() : base.color,
    opacity: clamp(raw.opacity, 0, 1, 1),
  };
}

/** Só dígitos, no máximo três. */
export const sanitizeNumber = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\D/g, '').slice(0, 3) : '';

/** Valida uma pintura vinda do armazenamento; qualquer campo inválido vira o padrão. */
export function sanitizePaint(value: unknown): KartPaint | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { zones?: Record<string, Partial<ZonePaint>>; pattern?: unknown };
  const paint = solidPaint();
  for (const id of ZONE_IDS) {
    const zone = raw.zones?.[id];
    if (isHex(zone?.color)) paint.zones[id].color = zone.color.toLowerCase();
    if (isFinish(zone?.finish)) paint.zones[id].finish = zone.finish;
  }
  const pattern = (raw.pattern ?? {}) as Partial<KartPaint['pattern']>;
  if (isPattern(pattern.type)) paint.pattern.type = pattern.type;
  if (isHex(pattern.color)) paint.pattern.color = pattern.color.toLowerCase();
  if (typeof pattern.size === 'number' && Number.isFinite(pattern.size))
    paint.pattern.size = Math.min(1, Math.max(0, pattern.size));
  const full = value as { wheels?: Partial<WheelPaint>; stickers?: unknown; number?: unknown };
  if (isHex(full.wheels?.color)) paint.wheels.color = full.wheels.color.toLowerCase();
  if (isFinish(full.wheels?.finish)) paint.wheels.finish = full.wheels.finish;
  if (isHex(full.wheels?.stripe)) paint.wheels.stripe = full.wheels.stripe.toLowerCase();
  if (Array.isArray(full.stickers))
    paint.stickers = full.stickers
      .map(sanitizeSticker)
      .filter((sticker): sticker is Sticker => sticker !== null)
      .slice(0, MAX_STICKERS);
  paint.number = sanitizeNumber(full.number);
  return paint;
}

/** Limites (em metros, no espaço do kart) da área que recebe adesivos. */
export interface StickerBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/**
 * Se uma face do kart está voltada para a superfície do adesivo. Sem isso a
 * projeção atravessaria o kart e pintaria também o assoalho e o lado de dentro.
 * @param nx normal da face (qualquer escala), no espaço do kart
 * @param copy 0 = o adesivo; 1 = a cópia espelhada do outro lado
 */
export function stickerFaces(
  sticker: Sticker,
  nx: number,
  ny: number,
  nz: number,
  copy: 0 | 1 = 0,
): boolean {
  const length = Math.hypot(nx, ny, nz) || 1;
  const facing =
    sticker.surface === 'top'
      ? ny
      : sticker.surface === 'front'
        ? nz
        : (sticker.surface === 'left') === (copy === 0)
          ? nx
          : -nx;
  return facing / length > 0.3;
}

/** Lado do adesivo em metros. */
export const stickerMetres = (size: number): number => 0.05 + size * 0.55;

/**
 * Onde um ponto do kart cai dentro do adesivo: [u, v] de 0 a 1 (u para a direita
 * e v para cima, vistos de fora do kart), ou `null` se o ponto fica fora dele.
 * @param copy 0 = o adesivo; 1 = a cópia espelhada do outro lado
 */
export function stickerUv(
  sticker: Sticker,
  bounds: StickerBounds,
  x: number,
  y: number,
  z: number,
  copy: 0 | 1 = 0,
): [number, number] | null {
  const { min, max } = bounds;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  let du: number;
  let dv: number;
  let flip = false;
  if (sticker.surface === 'left' || sticker.surface === 'right') {
    // Lateral: x do adesivo corre da traseira para o bico; a cópia vai para o outro lado.
    const left = (sticker.surface === 'left') === (copy === 0);
    if (left ? x < 0 : x > 0) return null;
    du = (z - lerp(min[2], max[2], sticker.x)) * (left ? -1 : 1);
    dv = y - lerp(min[1], max[1], sticker.y);
  } else {
    // De cima ou de frente: a cópia é o reflexo no plano central do kart.
    // Os dois são lidos por quem está na frente do kart: +x fica à direita e,
    // visto de cima, a traseira fica no alto do adesivo.
    const top = sticker.surface === 'top';
    let centre = lerp(min[0], max[0], sticker.x);
    if (copy === 1) {
      centre = -centre;
      flip = true;
    }
    du = x - centre;
    dv = top ? lerp(max[2], min[2], sticker.y) - z : y - lerp(min[1], max[1], sticker.y);
  }
  const angle = (sticker.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const side = stickerMetres(sticker.size);
  let u = (du * cos + dv * sin) / side;
  const v = (-du * sin + dv * cos) / side + 0.5;
  if (flip) u = -u;
  u += 0.5;
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : [u, v];
}

export const clonePaint = (paint: KartPaint): KartPaint =>
  sanitizePaint(JSON.parse(JSON.stringify(paint))) as KartPaint;

export const samePaint = (a: KartPaint | null, b: KartPaint | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const smooth = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Quanto da cor do padrão entra num ponto do kart (0 = cor da zona, 1 = cor do padrão).
 * Coordenadas em metros no espaço do kart: x para a esquerda, y para cima, z para a frente,
 * origem no chão, no centro do eixo traseiro.
 */
export function patternMix(type: PatternId, size: number, x: number, y: number, z: number): number {
  switch (type) {
    case 'stripes': {
      // Duas faixas ao longo do kart, uma de cada lado do centro.
      const width = 0.025 + size * 0.07;
      const offset = Math.abs(Math.abs(x) - (0.03 + width / 2 + size * 0.03));
      return offset < width / 2 ? 1 : 0;
    }
    case 'gradient': {
      // Da traseira (cor da zona) para o bico (cor do padrão).
      const middle = 0.2 + size * 0.9;
      return smooth(middle - 0.45, middle + 0.45, z);
    }
    case 'split':
      // Metade de baixo na cor do padrão; a linha sobe com o tamanho.
      return y < 0.16 + size * 0.34 ? 1 : 0;
    case 'chevron': {
      // Faixas em V apontando para a frente.
      const period = 0.12 + size * 0.3;
      const phase = (z + Math.abs(x) * 1.1) / period;
      return phase - Math.floor(phase) < 0.5 ? 1 : 0;
    }
    default:
      return 0;
  }
}

const STORAGE_KEY = 'kart-online.pintura';

/** Pintura livre aplicada neste navegador (`null` = usa a pintura pronta do catálogo). */
export function loadPaint(): KartPaint | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitizePaint(JSON.parse(stored) as unknown) : null;
  } catch {
    return null;
  }
}

export function savePaint(paint: KartPaint | null): void {
  try {
    if (paint) localStorage.setItem(STORAGE_KEY, JSON.stringify(paint));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Sem armazenamento (aba privada): a pintura vale só nesta sessão.
  }
}
