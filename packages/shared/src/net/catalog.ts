import type { Cosmetics } from './protocol.js';

/**
 * Catálogo de posse: todo cosmético que existe no jogo, com raridade e preço.
 * A aparência de cada item (cores, malhas) fica no cliente; aqui está só o que
 * o servidor precisa para decidir quem pode usar o quê.
 *
 * Cosmético é puramente visual: nada daqui é lido pela simulação.
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'exclusive';

export const RARITIES: readonly { id: Rarity; label: string }[] = [
  { id: 'common', label: 'Comum' },
  { id: 'rare', label: 'Raro' },
  { id: 'epic', label: 'Épico' },
  { id: 'legendary', label: 'Lendário' },
  { id: 'exclusive', label: 'Exclusivo' },
];

export const rarityLabel = (rarity: Rarity): string =>
  RARITIES.find((entry) => entry.id === rarity)?.label ?? rarity;

/** Moedas do jogo: `coins` se ganha correndo; `gems` se compra com dinheiro real. */
export type Currency = 'coins' | 'gems';

export interface CatalogItem {
  /** "slot:chave", igual ao id do banco. */
  id: string;
  /** Slot do visual (livery, suit…) ou parte da pintura livre (finish, pattern, sticker, feature). */
  slot: string;
  key: string;
  name: string;
  rarity: Rarity;
  /** Preço em moedas; `null` = não se compra com moedas. */
  priceCoins: number | null;
  /** Preço em gemas; `null` = não se compra com gemas. */
  priceGems: number | null;
  /** Item básico: pode ser escolhido no kart inicial e é entregue a toda conta. */
  isDefault: boolean;
  /** Nível de carreira exigido para comprar com moedas (0 = sem exigência). Gemas não exigem nível. */
  unlockLevel: number;
}

const base = (slot: string, key: string, name: string): CatalogItem => ({
  id: `${slot}:${key}`,
  slot,
  key,
  name,
  rarity: 'common',
  priceCoins: null,
  priceGems: null,
  isDefault: true,
  unlockLevel: 0,
});

const sold = (
  slot: string,
  key: string,
  name: string,
  rarity: Rarity,
  priceCoins: number | null,
  priceGems: number | null,
  unlockLevel = 0,
): CatalogItem => ({
  ...base(slot, key, name),
  rarity,
  priceCoins,
  priceGems,
  isDefault: false,
  unlockLevel,
});

/**
 * Regra das raridades: comum e raro custam moedas; épico custa moedas (caro)
 * ou gemas; lendário e exclusivo custam só gemas.
 */
export const CATALOG_ITEMS: readonly CatalogItem[] = [
  // --- pintura pronta do kart ---
  base('livery', 'azul', 'Pintura azul original'),
  base('livery', 'vermelho', 'Pintura vermelha'),
  base('livery', 'branco', 'Pintura branca'),
  sold('livery', 'amarelo', 'Pintura amarela', 'rare', 300, null, 2),
  sold('livery', 'verde', 'Pintura verde', 'rare', 1000, null, 8),
  // --- piloto ---
  base('suit', 'orla', 'Macacão Orla'),
  sold('suit', 'mare', 'Macacão Maré', 'common', 200, null),
  sold('suit', 'largada', 'Macacão Largada', 'rare', 700, null, 5),
  base('gloves', 'azuis', 'Luvas azuis'),
  base('gloves', 'pretas', 'Luvas pretas'),
  sold('gloves', 'brancas', 'Luvas brancas', 'common', 150, null),
  base('boots', 'pretas', 'Botas pretas e vermelhas'),
  sold('boots', 'brancas', 'Botas brancas', 'common', 150, null),
  base('helmetModel', 'integral', 'Capacete integral'),
  sold('helmetModel', 'aero', 'Capacete com aerofólio', 'legendary', null, 400),
  base('helmetPaint', 'brisa', 'Capacete Brisa'),
  sold('helmetPaint', 'crepusculo', 'Capacete Crepúsculo', 'common', 250, null),
  sold('helmetPaint', 'bandeira', 'Capacete Bandeira', 'epic', 2200, 150, 16),
  base('visor', 'fume', 'Viseira fumê'),
  sold('visor', 'azul', 'Viseira espelhada azul', 'rare', 500, null),
  sold('visor', 'dourada', 'Viseira espelhada dourada', 'epic', 1800, 120),
  // --- kart ---
  base('rim', 'padrao', 'Aros originais'),
  sold('rim', 'grafite', 'Aros grafite', 'common', 250, null),
  sold('rim', 'dourado', 'Aros dourados', 'epic', 1500, 100, 12),
  base('trail', 'nenhuma', 'Sem trilha'),
  sold('trail', 'branca', 'Trilha branca', 'rare', 450, null, 3),
  sold('trail', 'azul', 'Trilha azul', 'legendary', null, 250),
  // --- pintura livre: acabamentos ---
  base('finish', 'gloss', 'Acabamento brilhante'),
  base('finish', 'matte', 'Acabamento fosco'),
  sold('finish', 'metallic', 'Acabamento metálico', 'rare', 600, null),
  sold('finish', 'pearl', 'Acabamento perolado', 'epic', 1600, 110),
  sold('finish', 'carbon', 'Acabamento carbono', 'epic', 2000, 140),
  sold('finish', 'chrome', 'Acabamento cromado', 'legendary', null, 350),
  // --- pintura livre: padrões ---
  base('pattern', 'solid', 'Padrão sólido'),
  sold('pattern', 'stripes', 'Padrão faixas', 'common', 200, null),
  sold('pattern', 'split', 'Padrão bicolor', 'common', 200, null),
  sold('pattern', 'gradient', 'Padrão degradê', 'rare', 500, null),
  sold('pattern', 'chevron', 'Padrão geométrico', 'rare', 600, null),
  // --- pintura livre: adesivos ---
  base('sticker', 'number', 'Adesivo número'),
  base('sticker', 'band', 'Adesivo faixa'),
  base('sticker', 'circle', 'Adesivo círculo'),
  sold('sticker', 'star', 'Adesivo estrela', 'common', 150, null),
  sold('sticker', 'arrow', 'Adesivo seta', 'common', 150, null),
  sold('sticker', 'bolt', 'Adesivo raio', 'rare', 400, null),
  sold('sticker', 'checker', 'Adesivo xadrez', 'rare', 450, null),
  sold('sticker', 'flame', 'Adesivo chama', 'epic', 1200, 90),
  // --- espaços extras ---
  sold('feature', 'presetSlots', 'Mais 3 visuais salvos', 'exclusive', null, 200),
  sold('feature', 'stickerSlots', 'Mais 4 camadas de adesivo', 'exclusive', null, 200),
];

const BY_ID = new Map(CATALOG_ITEMS.map((item) => [item.id, item]));

export const catalogItem = (id: string): CatalogItem | undefined => BY_ID.get(id);
export const itemId = (slot: string, key: string): string => `${slot}:${key}`;

/** Ids dos itens básicos, entregues a toda conta ao confirmar o kart inicial. */
export const DEFAULT_ITEM_IDS: readonly string[] = CATALOG_ITEMS.filter(
  (item) => item.isDefault,
).map((item) => item.id);

/** Slots do visual equipado (o resto do catálogo são partes da pintura livre). */
export const LOADOUT_SLOTS = [
  'livery',
  'suit',
  'gloves',
  'boots',
  'helmetModel',
  'helmetPaint',
  'visor',
  'rim',
  'trail',
] as const;

/** Visuais salvos e camadas de adesivo: o básico e o total com o espaço extra comprado. */
export const BASE_PRESETS = 3;
export const EXTRA_PRESETS = 3;
export const BASE_STICKERS = 4;
export const EXTRA_STICKERS = 4;
export const PRESET_SLOTS_ITEM = 'feature:presetSlots';
export const STICKER_SLOTS_ITEM = 'feature:stickerSlots';

type Owned = ReadonlySet<string> | readonly string[];
const has = (owned: Owned, id: string): boolean =>
  Array.isArray(owned) ? owned.includes(id) : (owned as ReadonlySet<string>).has(id);

export const presetLimit = (owned: Owned): number =>
  BASE_PRESETS + (has(owned, PRESET_SLOTS_ITEM) ? EXTRA_PRESETS : 0);
export const stickerLimit = (owned: Owned): number =>
  BASE_STICKERS + (has(owned, STICKER_SLOTS_ITEM) ? EXTRA_STICKERS : 0);

/** Tira do visual os itens que o jogador não possui (ou que não existem no catálogo). */
export function filterOwnedCosmetics(cosmetics: Cosmetics, owned: Owned): Cosmetics {
  const result: Cosmetics = {};
  for (const [slot, key] of Object.entries(cosmetics)) {
    const id = itemId(slot, key);
    if (BY_ID.has(id) && has(owned, id)) result[slot] = key;
  }
  return result;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Itens do catálogo que uma pintura livre usa: acabamentos, padrão, formas de
 * adesivo e, passando do limite básico, o espaço extra de camadas. Lê a
 * pintura como dado solto (o servidor não confia no formato).
 */
export function paintRequirements(paint: unknown): string[] {
  if (typeof paint !== 'object' || paint === null) return [];
  const data = record(paint);
  const needed = new Set<string>();
  const finish = (value: unknown): void => {
    const key = text(record(value).finish);
    if (key) needed.add(itemId('finish', key));
  };
  for (const zone of Object.values(record(data.zones))) finish(zone);
  const wheels = record(data.wheels);
  // O acabamento do aro só conta quando o aro tem cor livre.
  if (wheels.color) finish(wheels);
  const pattern = text(record(data.pattern).type);
  if (pattern) needed.add(itemId('pattern', pattern));
  const stickers = Array.isArray(data.stickers) ? data.stickers : [];
  for (const sticker of stickers) {
    const shape = text(record(sticker).shape);
    if (shape) needed.add(itemId('sticker', shape));
  }
  if (stickers.length > BASE_STICKERS) needed.add(STICKER_SLOTS_ITEM);
  return [...needed];
}

/** O que falta no inventário para usar este visual (ids do catálogo; vazio = pode usar). */
export function missingItems(cosmetics: Cosmetics, paint: unknown, owned: Owned): string[] {
  const missing: string[] = [];
  for (const [slot, key] of Object.entries(cosmetics)) {
    const id = itemId(slot, key);
    // Com pintura livre, a pintura pronta escolhida por baixo não aparece: não é exigida.
    if (slot === 'livery' && paint) continue;
    if (!has(owned, id)) missing.push(id);
  }
  for (const id of paintRequirements(paint)) if (!has(owned, id)) missing.push(id);
  return missing;
}

export type BuyBlock = 'owned' | 'level' | 'balance' | 'currency' | 'unknown';

/** Preço de um item na moeda pedida (`null` = não é vendido nela). */
export const priceIn = (item: CatalogItem, currency: Currency): number | null =>
  currency === 'coins' ? item.priceCoins : item.priceGems;

/**
 * Por que uma compra não pode ser feita (`null` = pode).
 * @param balance saldo na moeda escolhida
 */
export function buyBlock(
  id: string,
  currency: Currency,
  level: number,
  balance: number,
  owned: Owned,
): BuyBlock | null {
  const item = BY_ID.get(id);
  if (!item) return 'unknown';
  if (has(owned, id)) return 'owned';
  const price = priceIn(item, currency);
  if (price === null) return 'currency';
  // Nível só vale para moedas: gemas compram direto.
  if (currency === 'coins' && level < item.unlockLevel) return 'level';
  if (balance < price) return 'balance';
  return null;
}

// --- gemas -----------------------------------------------------------------------

/** Pacote de gemas vendido por Pix. Preço em centavos de real. */
export interface GemPackage {
  id: string;
  name: string;
  gems: number;
  /** Moedas de bônus que vêm junto. */
  coins: number;
  amountCents: number;
  /** Arte do pacote em /assets/currency/<art>.webp. */
  art: 'bundle_starter' | 'bundle_mid' | 'bundle_mega';
  /** Selo de destaque na vitrine. */
  badge?: 'popular' | 'best';
}

export const GEM_PACKAGES: readonly GemPackage[] = [
  {
    id: 'bundle-starter',
    name: 'Pacote Piloto Iniciante',
    gems: 100,
    coins: 500,
    amountCents: 490,
    art: 'bundle_starter',
  },
  {
    id: 'bundle-mid',
    name: 'Pacote Turbo Nitro',
    gems: 550,
    coins: 2500,
    amountCents: 1990,
    art: 'bundle_mid',
    badge: 'popular',
  },
  {
    id: 'bundle-mega',
    name: 'Pacote Campeão de Box',
    gems: 1300,
    coins: 6000,
    amountCents: 3990,
    art: 'bundle_mega',
    badge: 'best',
  },
];

export const gemPackage = (id: string): GemPackage | undefined =>
  GEM_PACKAGES.find((entry) => entry.id === id);

/** 2490 → "R$ 24,90". */
export const formatBrl = (cents: number): string =>
  `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

export type PaymentStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'REFUNDED';

/** Pedido de gemas como o cliente vê. */
export interface OrderView {
  orderId: string;
  status: PaymentStatus;
  gems: number;
  /** Moedas de bônus do pacote. */
  coins: number;
  amountCents: number;
  /** Código "copia e cola" do Pix e a imagem do QR em base64 (PNG). */
  qrCode: string;
  qrCodeBase64: string;
  expiresAt: string;
}
