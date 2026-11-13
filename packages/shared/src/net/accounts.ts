import type { Cosmetics } from './protocol.js';

/** Cosmético que precisa estar no inventário para ser usado. */
export interface CosmeticItemDef {
  /** "slot:chave", igual ao id do banco. */
  id: string;
  slot: string;
  key: string;
  name: string;
  /** Entregue a toda conta nova. */
  starter: boolean;
}

const item = (slot: string, key: string, name: string, starter: boolean): CosmeticItemDef => ({
  id: `${slot}:${key}`,
  slot,
  key,
  name,
  starter,
});

/**
 * Os 12 cosméticos do seed: 3 capacetes, 3 liveries, 2 macacões, 2 aros e
 * 2 trilhas. O que não está aqui (pintura original, luvas, botas, viseira…) é
 * básico e livre para todos.
 */
export const COSMETIC_ITEMS: readonly CosmeticItemDef[] = [
  item('helmetPaint', 'brisa', 'Capacete Brisa', true),
  item('helmetPaint', 'crepusculo', 'Capacete Crepúsculo', true),
  item('helmetPaint', 'bandeira', 'Capacete Bandeira', false),
  item('livery', 'vermelho', 'Pintura vermelha', true),
  item('livery', 'amarelo', 'Pintura amarela', false),
  item('livery', 'verde', 'Pintura verde', false),
  item('suit', 'mare', 'Macacão Maré', true),
  item('suit', 'largada', 'Macacão Largada', false),
  item('rim', 'grafite', 'Aros grafite', true),
  item('rim', 'dourado', 'Aros dourados', false),
  item('trail', 'branca', 'Trilha branca', true),
  item('trail', 'azul', 'Trilha azul', false),
];

const ITEM_IDS = new Set(COSMETIC_ITEMS.map((entry) => entry.id));

/** Tira do loadout os itens de catálogo que o jogador não possui. */
export function filterOwnedCosmetics(cosmetics: Cosmetics, owned: ReadonlySet<string>): Cosmetics {
  const result: Cosmetics = {};
  for (const [slot, key] of Object.entries(cosmetics)) {
    const id = `${slot}:${key}`;
    if (!ITEM_IDS.has(id) || owned.has(id)) result[slot] = key;
  }
  return result;
}

export const DIVISIONS = [
  { name: 'Bronze', min: 0 },
  { name: 'Prata', min: 800 },
  { name: 'Ouro', min: 1300 },
  { name: 'Platina', min: 1800 },
  { name: 'Diamante', min: 2300 },
  { name: 'Mestre', min: 2800 },
  { name: 'Lenda', min: 3300 },
] as const;

/** Partidas de posicionamento antes de a divisão aparecer. */
export const PLACEMENT_MATCHES = 5;

/** Pontos exibidos: estimativa conservadora da habilidade (mu − 3·sigma). */
export function ratingPoints(mu: number, sigma: number): number {
  return Math.max(0, Math.round((mu - 3 * sigma) * 100));
}

export function divisionOf(points: number): string {
  let name: string = DIVISIONS[0].name;
  for (const division of DIVISIONS) if (points >= division.min) name = division.name;
  return name;
}

export interface RatingView {
  points: number;
  /** `null` enquanto está em posicionamento. */
  division: string | null;
  matches: number;
  placementLeft: number;
}

export function ratingView(mu: number, sigma: number, matches: number): RatingView {
  const points = ratingPoints(mu, sigma);
  const placementLeft = Math.max(0, PLACEMENT_MATCHES - matches);
  return {
    points,
    division: placementLeft > 0 ? null : divisionOf(points),
    matches,
    placementLeft,
  };
}

export interface AccountView {
  id: string;
  name: string;
  guest: boolean;
  email: string | null;
  /** Menor de 18: fica fora de qualquer compra futura. */
  minor: boolean;
}

export interface HistoryEntry {
  mode: string;
  position: number;
  karts: number;
  timeTicks: number | null;
  bestLapTicks: number | null;
  pointsDelta: number | null;
  endedAt: string;
}

export interface MeResponse {
  user: AccountView;
  season: { name: string; endsAt: string };
  rating: RatingView;
  /** Ids ("slot:chave") dos cosméticos possuídos. */
  inventory: string[];
  loadout: Cosmetics;
  history: HistoryEntry[];
}

export interface AuthResponse {
  token: string;
  user: AccountView;
}

export interface RankingEntry {
  position: number;
  name: string;
  points: number;
  division: string | null;
  matches: number;
}

export interface QueueStatus {
  state: 'idle' | 'waiting' | 'matched';
  waitedSeconds: number;
  /** Faixa de pontos aceita no momento (cresce com a espera). */
  band: number;
  /** Reserva de vaga do Colyseus, quando a partida foi formada. */
  reservation: unknown;
}
