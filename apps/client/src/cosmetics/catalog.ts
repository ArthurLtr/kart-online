/**
 * Catálogo visual dos cosméticos. São só visuais: nada aqui é lido pela
 * simulação; o servidor guarda apenas os ids equipados. As cores dos macacões e capacetes seguem
 * as imagens de referencias/ (referencia piloto 1 a 6), com marcas fictícias.
 */

export interface LiveryDesign {
  id: string;
  name: string;
  /** Cor que substitui o azul do modelo; `null` mantém a pintura original. */
  color: string | null;
}

export interface SuitDesign {
  id: string;
  name: string;
  base: string;
  /** Ombros e parte de cima do peito. */
  yoke: string;
  /** Faixas laterais do tronco e das pernas. */
  accent: string;
  collar: string;
  belt: string;
  sleeve: string;
  /** Texto fictício no peito. */
  label: string;
  labelColor: string;
}

export interface GlovesDesign {
  id: string;
  name: string;
  color: string;
  cuff: string;
}

export interface BootsDesign {
  id: string;
  name: string;
  color: string;
  sole: string;
}

export interface HelmetModel {
  id: 'integral' | 'aero';
  name: string;
}

export interface HelmetPaint {
  id: string;
  name: string;
  base: string;
  stripe: string;
  accent: string;
  lower: string;
}

export interface VisorDesign {
  id: string;
  name: string;
  color: string;
}

export interface RimDesign {
  id: string;
  name: string;
  /** Cor que tinge as rodas; `null` mantém as originais. */
  color: string | null;
}

export interface TrailDesign {
  id: string;
  name: string;
  /** Cor da trilha luminosa; `null` = sem trilha. */
  color: string | null;
}

export const LIVERIES: readonly LiveryDesign[] = [
  { id: 'azul', name: 'Azul original', color: null },
  { id: 'vermelho', name: 'Vermelho', color: '#d3222a' },
  { id: 'amarelo', name: 'Amarelo', color: '#f0b90f' },
  { id: 'verde', name: 'Verde', color: '#149a52' },
  { id: 'branco', name: 'Branco', color: '#e9e9e4' },
];

export const SUITS: readonly SuitDesign[] = [
  {
    id: 'mare',
    name: 'Maré (grafite e laranja)',
    base: '#1d2433',
    yoke: '#aab9c9',
    accent: '#e8842c',
    collar: '#1d2433',
    belt: '#0f1218',
    sleeve: '#1d2433',
    label: 'MARÉ',
    labelColor: '#ffffff',
  },
  {
    id: 'largada',
    name: 'Largada (preto e vermelho)',
    base: '#18191c',
    yoke: '#d0252a',
    accent: '#d0252a',
    collar: '#18191c',
    belt: '#0c0c0e',
    sleeve: '#d8d8d4',
    label: 'LARGADA',
    labelColor: '#ffffff',
  },
  {
    id: 'orla',
    name: 'Orla (azul e branco)',
    base: '#2e31a6',
    yoke: '#e6e6e2',
    accent: '#27b7c9',
    collar: '#2e31a6',
    belt: '#15162b',
    sleeve: '#e6e6e2',
    label: 'ORLA',
    labelColor: '#2e31a6',
  },
];

export const GLOVES: readonly GlovesDesign[] = [
  { id: 'pretas', name: 'Pretas', color: '#15171b', cuff: '#e8842c' },
  { id: 'brancas', name: 'Brancas', color: '#deded9', cuff: '#d0252a' },
  { id: 'azuis', name: 'Azuis', color: '#2e31a6', cuff: '#e6e6e2' },
];

export const BOOTS: readonly BootsDesign[] = [
  { id: 'pretas', name: 'Pretas e vermelhas', color: '#141518', sole: '#c8282a' },
  { id: 'brancas', name: 'Brancas', color: '#deded9', sole: '#2a2b30' },
];

export const HELMET_MODELS: readonly HelmetModel[] = [
  { id: 'integral', name: 'Integral' },
  { id: 'aero', name: 'Integral com aerofólio' },
];

export const HELMET_PAINTS: readonly HelmetPaint[] = [
  {
    id: 'crepusculo',
    name: 'Crepúsculo (azul)',
    base: '#2c2a8a',
    stripe: '#d0252a',
    accent: '#f0b90f',
    lower: '#1b1a55',
  },
  {
    id: 'bandeira',
    name: 'Bandeira (branco e vermelho)',
    base: '#ececea',
    stripe: '#d0252a',
    accent: '#d0252a',
    lower: '#d0252a',
  },
  {
    id: 'brisa',
    name: 'Brisa (branco e azul)',
    base: '#ececea',
    stripe: '#2456c9',
    accent: '#27b7c9',
    lower: '#2456c9',
  },
];

export const VISORS: readonly VisorDesign[] = [
  { id: 'fume', name: 'Fumê', color: '#20242b' },
  { id: 'dourada', name: 'Espelhada dourada', color: '#c9963a' },
  { id: 'azul', name: 'Espelhada azul', color: '#2f6fd6' },
];

export const RIMS: readonly RimDesign[] = [
  { id: 'padrao', name: 'Originais', color: null },
  { id: 'grafite', name: 'Grafite', color: '#5b606b' },
  { id: 'dourado', name: 'Dourados', color: '#e0b23c' },
];

export const TRAILS: readonly TrailDesign[] = [
  { id: 'nenhuma', name: 'Sem trilha', color: null },
  { id: 'branca', name: 'Branca', color: '#f1f3f5' },
  { id: 'azul', name: 'Azul', color: '#3d8bff' },
];

/** O que o jogador tem equipado. Guarda só ids do catálogo. */
export interface Loadout {
  livery: string;
  suit: string;
  gloves: string;
  boots: string;
  helmetModel: string;
  helmetPaint: string;
  visor: string;
  rim: string;
  trail: string;
}

export const DEFAULT_LOADOUT: Loadout = {
  livery: 'azul',
  suit: 'orla',
  gloves: 'azuis',
  boots: 'pretas',
  helmetModel: 'integral',
  helmetPaint: 'brisa',
  visor: 'fume',
  rim: 'padrao',
  trail: 'nenhuma',
};

export const CATALOG = {
  livery: LIVERIES,
  suit: SUITS,
  gloves: GLOVES,
  boots: BOOTS,
  helmetModel: HELMET_MODELS,
  helmetPaint: HELMET_PAINTS,
  visor: VISORS,
  rim: RIMS,
  trail: TRAILS,
} as const satisfies Record<keyof Loadout, readonly { id: string; name: string }[]>;

export const SLOT_LABELS: Record<keyof Loadout, string> = {
  livery: 'Pintura do kart',
  suit: 'Macacão',
  gloves: 'Luvas',
  boots: 'Botas',
  helmetModel: 'Modelo do capacete',
  helmetPaint: 'Pintura do capacete',
  visor: 'Viseira',
  rim: 'Aros',
  trail: 'Trilha',
};

export function findDesign<K extends keyof Loadout>(
  slot: K,
  id: string,
): (typeof CATALOG)[K][number] {
  const list = CATALOG[slot] as readonly { id: string }[];
  return (list.find((item) => item.id === id) ?? list[0]) as (typeof CATALOG)[K][number];
}

const STORAGE_KEY = 'kart-online.loadout';

/** Loadout completo a partir de dados de qualquer origem: id desconhecido vira o padrão. */
export function normalizeLoadout(value: unknown): Loadout {
  const saved = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const loadout = { ...DEFAULT_LOADOUT };
  for (const slot of Object.keys(loadout) as (keyof Loadout)[]) {
    const id = saved[slot];
    if (typeof id === 'string' && CATALOG[slot].some((item) => item.id === id)) loadout[slot] = id;
  }
  return loadout;
}

/** Loadout aplicado neste navegador; com conta, o do servidor é copiado para cá. */
export function loadLoadout(): Loadout {
  try {
    return normalizeLoadout(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_LOADOUT };
  }
}

export function saveLoadout(loadout: Loadout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout));
  } catch {
    // Sem armazenamento (aba privada): o loadout vale só nesta sessão.
  }
}

/** Loadouts variados para os outros karts do grid (determinístico pelo índice). */
export function sampleLoadout(index: number): Loadout {
  const pick = <T extends { id: string }>(list: readonly T[], step: number): string =>
    (list[(index + step) % list.length] as T).id;
  return {
    livery: pick(LIVERIES, 1),
    suit: pick(SUITS, 2),
    gloves: pick(GLOVES, 1),
    boots: pick(BOOTS, 1),
    helmetModel: pick(HELMET_MODELS, 1),
    helmetPaint: pick(HELMET_PAINTS, 1),
    visor: pick(VISORS, 2),
    rim: 'padrao',
    trail: 'nenhuma',
  };
}
