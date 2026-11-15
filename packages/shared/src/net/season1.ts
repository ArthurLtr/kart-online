import type { Rarity } from './catalog.js';

/**
 * Temporada 1 — "Grid de Ignição": os 20 cosméticos oficiais, em 5 categorias
 * e 4 raridades. Cada um vira um item comum do catálogo de posse (`slot:id`),
 * então compra, inventário e kit inicial seguem as mesmas regras de sempre.
 */
export type Season1Category = 'helmet' | 'wheel' | 'paint' | 'suit' | 'trail';

/** Em qual slot do visual equipado cada categoria entra. */
export const SEASON_1_SLOTS: Record<Season1Category, string> = {
  helmet: 'helmetModel',
  wheel: 'rim',
  paint: 'livery',
  suit: 'suit',
  trail: 'trail',
};

export interface Season1Item {
  /** Id oficial do item (ex.: "helm_dragon_gold"). */
  id: string;
  /** Id no catálogo de posse e no banco ("slot:id"). */
  itemId: string;
  category: Season1Category;
  slot: string;
  name: string;
  rarity: Rarity;
  priceCoins: number | null;
  priceGems: number | null;
  /** Kit inicial: entregue a toda conta. */
  isDefault: boolean;
  season: 1;
}

const item = (
  category: Season1Category,
  id: string,
  name: string,
  rarity: Rarity,
  priceCoins: number | null,
  priceGems: number | null,
): Season1Item => {
  const slot = SEASON_1_SLOTS[category];
  return {
    id,
    itemId: `${slot}:${id}`,
    category,
    slot,
    name,
    rarity,
    priceCoins,
    priceGems,
    isDefault: rarity === 'common' && priceCoins === 0,
    season: 1,
  };
};

export const SEASON_1_CATALOG: readonly Season1Item[] = [
  // --- capacetes ---
  item('helmet', 'helm_classic_red', 'Capacete Clássico Pista', 'common', 0, null),
  item('helmet', 'helm_carbon_aero', 'Capacete Fibra Aero', 'rare', 1200, null),
  item('helmet', 'helm_cyber_shark', 'Capacete Tubarão Cyber', 'epic', 3500, 120),
  item('helmet', 'helm_dragon_gold', 'Capacete Dragão Dourado', 'legendary', null, 350),
  // --- rodas e pneus ---
  item('wheel', 'wheel_slick_5spoke', 'Aro 5 Raios Slick', 'common', 0, null),
  item('wheel', 'wheel_chrome_sport', 'Aro Esportivo Cromado', 'rare', 1000, null),
  item('wheel', 'wheel_neon_turbine', 'Turbina Neon Ciano', 'epic', 3000, 100),
  item('wheel', 'wheel_forged_gold', 'Roda Forjada Campeão', 'legendary', null, 300),
  // --- pinturas e chassis ---
  item('paint', 'kart_rookie_red', 'Pintura Vermelho Grid', 'common', 0, null),
  item('paint', 'kart_cobalt_checkered', 'Pintura Azul Quadriculado', 'rare', 1500, null),
  item('paint', 'kart_chameleon_cyber', 'Pintura Camaleão Cyber', 'epic', 4000, 150),
  item('paint', 'kart_obsidian_gold', 'Pintura Obsidiana & Ouro', 'legendary', null, 450),
  // --- macacões ---
  item('suit', 'suit_classic_red', 'Macacão Clássico Piloto', 'common', 0, null),
  item('suit', 'suit_pro_carbon', 'Macacão Pro Carbono', 'rare', 1200, null),
  item('suit', 'suit_tech_neon', 'Macacão Tech-Wear Neon', 'epic', 3200, 110),
  item('suit', 'suit_grand_champion', 'Traje Grande Campeão', 'legendary', null, 380),
  // --- trilhas de drift ---
  item('trail', 'trail_white_smoke', 'Fumaça de Pneu Padrão', 'common', 0, null),
  item('trail', 'trail_nitro_flame', 'Chama Dupla de Escape', 'rare', 1400, null),
  item('trail', 'trail_plasma_lightning', 'Rastro Plasma Elétrico', 'epic', 3800, 140),
  item('trail', 'trail_phoenix_gold', 'Trilha Fênix Dourada', 'legendary', null, 400),
];

const BY_ID = new Map<string, Season1Item>();
for (const entry of SEASON_1_CATALOG) {
  BY_ID.set(entry.id, entry);
  BY_ID.set(entry.itemId, entry);
}

/** Item da Temporada 1 pelo id oficial ("helm_dragon_gold") ou pelo id de posse ("helmetModel:helm_dragon_gold"). */
export const getCatalogItemById = (id: string): Season1Item | undefined => BY_ID.get(id);

/** Os 5 itens grátis do kit inicial da temporada. */
export const SEASON_1_STARTER_IDS: readonly string[] = SEASON_1_CATALOG.filter(
  (entry) => entry.isDefault,
).map((entry) => entry.itemId);
