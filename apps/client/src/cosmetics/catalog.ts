import { catalogItem } from '@kart/shared';

/**
 * Catálogo visual dos cosméticos. São só visuais: nada aqui é lido pela
 * simulação; o servidor guarda apenas os ids equipados. As cores dos macacões e capacetes seguem
 * as imagens de referencias/ (referencia piloto 1 a 6), com marcas fictícias.
 */

/**
 * Material de um item da temporada. Também é o visual de reserva enquanto o
 * modelo .glb próprio do item não existe: a malha padrão recebe este material.
 */
export interface MaterialPreset {
  metalness?: number;
  roughness?: number;
  /** Brilho próprio (neon); só as partes claras da textura acendem. */
  emissive?: string;
  emissiveIntensity?: number;
}

/** Marca dos itens da Temporada 1 e onde fica o .glb próprio (quando houver). */
export interface SeasonInfo {
  season?: 1;
  /** `public/assets/cosmetics/s1/<id>.glb`; sem o arquivo, vale a malha padrão. */
  glb?: string;
  preset?: MaterialPreset;
}

const S1_GLB = (id: string): string => `/assets/cosmetics/s1/${id}.glb`;

export interface LiveryDesign extends SeasonInfo {
  id: string;
  name: string;
  /** Cor que substitui o azul do modelo; `null` mantém a pintura original. */
  color: string | null;
}

export interface SuitDesign extends SeasonInfo {
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

/** Formas de capacete que existem em código (malha padrão dos capacetes da temporada). */
export type HelmetMesh = 'integral' | 'aero';

export interface HelmetModel extends SeasonInfo {
  id: string;
  name: string;
  /** Malha usada enquanto não houver o .glb próprio. */
  mesh: HelmetMesh;
  /** Capacete completo da temporada: já vem com pintura e viseira próprias. */
  look?: { paint: HelmetPaint; visor: string; visorGlow?: number };
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

export interface RimDesign extends SeasonInfo {
  id: string;
  name: string;
  /** Cor que tinge as rodas; `null` mantém as originais. */
  color: string | null;
}

export interface TrailDesign extends SeasonInfo {
  id: string;
  name: string;
  /** Cor da trilha luminosa; `null` = sem trilha. */
  color: string | null;
  /** Cor na ponta da trilha (degradê); sem ela, a trilha tem uma cor só. */
  tail?: string;
  /** Largura relativa (1 = padrão). */
  width?: number;
  /** Tremulação 0–1 (fogo e eletricidade). */
  flicker?: number;
  /** Intensidade 0–1 (fumaça é mais suave que neon). */
  strength?: number;
}

export const LIVERIES: readonly LiveryDesign[] = [
  { id: 'azul', name: 'Azul original', color: null },
  { id: 'vermelho', name: 'Vermelho', color: '#d3222a' },
  { id: 'amarelo', name: 'Amarelo', color: '#f0b90f' },
  { id: 'verde', name: 'Verde', color: '#149a52' },
  { id: 'branco', name: 'Branco', color: '#e9e9e4' },
  // --- Temporada 1 ---
  {
    id: 'kart_rookie_red',
    name: 'Vermelho Grid',
    color: '#c8102e',
    season: 1,
    preset: { metalness: 0.1, roughness: 0.32 },
  },
  {
    id: 'kart_cobalt_checkered',
    name: 'Azul Quadriculado',
    color: '#1f4fd6',
    season: 1,
    preset: { metalness: 0.55, roughness: 0.28 },
  },
  {
    id: 'kart_chameleon_cyber',
    name: 'Camaleão Cyber',
    color: '#7a3cff',
    season: 1,
    preset: { metalness: 0.6, roughness: 0.22, emissive: '#00e5ff', emissiveIntensity: 0.18 },
  },
  {
    id: 'kart_obsidian_gold',
    name: 'Obsidiana & Ouro',
    color: '#17171a',
    season: 1,
    preset: { metalness: 0.9, roughness: 0.65, emissive: '#e0b23c', emissiveIntensity: 0.12 },
  },
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
  // --- Temporada 1 ---
  {
    id: 'suit_classic_red',
    name: 'Clássico Piloto',
    base: '#c8102e',
    yoke: '#f2f2ee',
    accent: '#1b1c20',
    collar: '#c8102e',
    belt: '#111214',
    sleeve: '#c8102e',
    label: 'GRID',
    labelColor: '#ffffff',
    season: 1,
    preset: { roughness: 0.75 },
  },
  {
    id: 'suit_pro_carbon',
    name: 'Pro Carbono',
    base: '#1b1c1f',
    yoke: '#9aa3ad',
    accent: '#c9ced6',
    collar: '#1b1c1f',
    belt: '#0b0b0c',
    sleeve: '#2a2c30',
    label: 'PRO',
    labelColor: '#c9ced6',
    season: 1,
    preset: { metalness: 0.35, roughness: 0.4 },
  },
  {
    id: 'suit_tech_neon',
    name: 'Tech-Wear Neon',
    base: '#101218',
    yoke: '#1c2030',
    accent: '#00e5ff',
    collar: '#101218',
    belt: '#00e5ff',
    sleeve: '#101218',
    label: 'TECH',
    labelColor: '#00e5ff',
    season: 1,
    preset: { roughness: 0.55, emissive: '#00e5ff', emissiveIntensity: 0.7 },
  },
  {
    id: 'suit_grand_champion',
    name: 'Grande Campeão',
    base: '#f4f1ea',
    yoke: '#d4a537',
    accent: '#e8c766',
    collar: '#d4a537',
    belt: '#b8892a',
    sleeve: '#f4f1ea',
    label: 'CAMPEÃO',
    labelColor: '#b8892a',
    season: 1,
    preset: { metalness: 0.3, roughness: 0.3, emissive: '#e8c766', emissiveIntensity: 0.08 },
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

/** Pinturas próprias dos capacetes da Temporada 1 (não aparecem na lista de pinturas). */
const S1_HELMET_PAINT = (
  id: string,
  base: string,
  stripe: string,
  accent: string,
  lower: string,
): HelmetPaint => ({ id: `s1-${id}`, name: id, base, stripe, accent, lower });

export const HELMET_MODELS: readonly HelmetModel[] = [
  { id: 'integral', name: 'Integral', mesh: 'integral' },
  { id: 'aero', name: 'Integral com aerofólio', mesh: 'aero' },
  // --- Temporada 1: capacetes completos (malha, pintura e viseira) ---
  {
    id: 'helm_classic_red',
    name: 'Clássico Pista',
    mesh: 'integral',
    season: 1,
    glb: S1_GLB('helm_classic_red'),
    preset: { metalness: 0.1, roughness: 0.3 },
    look: {
      paint: S1_HELMET_PAINT('classic', '#f2f2ee', '#d0252a', '#d0252a', '#f2f2ee'),
      visor: '#2a2e35',
    },
  },
  {
    id: 'helm_carbon_aero',
    name: 'Fibra Aero',
    mesh: 'aero',
    season: 1,
    glb: S1_GLB('helm_carbon_aero'),
    preset: { metalness: 0.5, roughness: 0.28 },
    look: {
      paint: S1_HELMET_PAINT('carbon', '#1d1f23', '#3a3e45', '#9aa3ad', '#141518'),
      visor: '#5b2a8c',
    },
  },
  {
    id: 'helm_cyber_shark',
    name: 'Tubarão Cyber',
    mesh: 'aero',
    season: 1,
    glb: S1_GLB('helm_cyber_shark'),
    preset: { metalness: 0.3, roughness: 0.3, emissive: '#00e5ff', emissiveIntensity: 0.55 },
    look: {
      paint: S1_HELMET_PAINT('shark', '#15122a', '#00e5ff', '#ff2fb1', '#0d0b1c'),
      visor: '#00e5ff',
      visorGlow: 0.9,
    },
  },
  {
    id: 'helm_dragon_gold',
    name: 'Dragão Dourado',
    mesh: 'aero',
    season: 1,
    glb: S1_GLB('helm_dragon_gold'),
    preset: { metalness: 0.9, roughness: 0.22, emissive: '#e0b23c', emissiveIntensity: 0.1 },
    look: {
      paint: S1_HELMET_PAINT('dragon', '#d4a537', '#f6d57a', '#8a5a12', '#b7891f'),
      visor: '#2ef2ff',
      visorGlow: 1.2,
    },
  },
];

/** Forma em código do capacete (para os da temporada, enquanto não há .glb). */
export const helmetMesh = (id: string | undefined): HelmetMesh =>
  HELMET_MODELS.find((model) => model.id === id)?.mesh ?? 'integral';

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
  // --- Temporada 1 ---
  {
    id: 'wheel_slick_5spoke',
    name: '5 Raios Slick',
    color: '#8d939c',
    season: 1,
    glb: S1_GLB('wheel_slick_5spoke'),
    preset: { metalness: 0.7, roughness: 0.45 },
  },
  {
    id: 'wheel_chrome_sport',
    name: 'Esportivo Cromado',
    color: '#eef1f5',
    season: 1,
    glb: S1_GLB('wheel_chrome_sport'),
    preset: { metalness: 1, roughness: 0.1, emissive: '#d0252a', emissiveIntensity: 0.05 },
  },
  {
    id: 'wheel_neon_turbine',
    name: 'Turbina Neon Ciano',
    color: '#1b2633',
    season: 1,
    glb: S1_GLB('wheel_neon_turbine'),
    preset: { metalness: 0.5, roughness: 0.3, emissive: '#00e5ff', emissiveIntensity: 1.4 },
  },
  {
    id: 'wheel_forged_gold',
    name: 'Forjada Campeão',
    color: '#d6a531',
    season: 1,
    glb: S1_GLB('wheel_forged_gold'),
    preset: { metalness: 0.95, roughness: 0.2, emissive: '#ff7a1a', emissiveIntensity: 0.3 },
  },
];

export const TRAILS: readonly TrailDesign[] = [
  { id: 'nenhuma', name: 'Sem trilha', color: null },
  { id: 'branca', name: 'Branca', color: '#f1f3f5' },
  { id: 'azul', name: 'Azul', color: '#3d8bff' },
  // --- Temporada 1 ---
  {
    id: 'trail_white_smoke',
    name: 'Fumaça de Pneu Padrão',
    color: '#d9dde2',
    tail: '#5a5f66',
    width: 1.35,
    strength: 0.45,
    season: 1,
  },
  {
    id: 'trail_nitro_flame',
    name: 'Chama Dupla de Escape',
    color: '#ff8a1e',
    tail: '#2f6bff',
    flicker: 0.45,
    season: 1,
  },
  {
    id: 'trail_plasma_lightning',
    name: 'Rastro Plasma Elétrico',
    color: '#00e5ff',
    tail: '#7a3cff',
    width: 0.8,
    flicker: 0.8,
    season: 1,
  },
  {
    id: 'trail_phoenix_gold',
    name: 'Trilha Fênix Dourada',
    color: '#ffd76a',
    tail: '#ff6a00',
    width: 1.25,
    flicker: 0.35,
    season: 1,
  },
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
  livery: 'kart_rookie_red',
  suit: 'suit_classic_red',
  gloves: 'pretas',
  boots: 'pretas',
  helmetModel: 'helm_classic_red',
  helmetPaint: 'brisa',
  visor: 'fume',
  rim: 'wheel_slick_5spoke',
  trail: 'trail_white_smoke',
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

const RARITY_ORDER: Record<string, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  exclusive: 4,
};

/**
 * Itens de um slot em ordem crescente de raridade (comum → lendário); dentro
 * da mesma raridade, a ordem do catálogo. A raridade vem do catálogo de posse.
 */
export function byRarity<T extends { id: string }>(slot: keyof Loadout, items: readonly T[]): T[] {
  const rank = (item: T): number =>
    RARITY_ORDER[catalogItem(`${slot}:${item.id}`)?.rarity ?? 'common'] ?? 0;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/** Item lançado na Temporada 1 (selo nos cartões da Garagem). */
export const isSeason1 = (slot: keyof Loadout, id: string): boolean =>
  (CATALOG[slot] as readonly (SeasonInfo & { id: string })[]).some(
    (item) => item.id === id && item.season === 1,
  );
