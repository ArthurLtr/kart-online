/**
 * Patentes do Ranqueado: única fonte da verdade para servidor e cliente.
 * Os pontos são os de `ratingPoints` (mu − 3·sigma, ×100), que começam em 0.
 */
export type RankTierId = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'legend';

export interface RankTier {
  id: RankTierId;
  /** Nome da divisão (o que aparece em "Divisão Ouro"). */
  name: string;
  /** Apelido da patente. */
  title: string;
  minRating: number;
  /** Último ponto da faixa; `Infinity` na Lenda. */
  maxRating: number;
  iconPath: string;
  /** Cor da borda e do brilho na interface. */
  primaryColor: string;
  /** Moedas para quem termina a temporada nesta patente. */
  seasonRewardCoins: number;
}

const tier = (
  id: RankTierId,
  name: string,
  title: string,
  minRating: number,
  maxRating: number,
  primaryColor: string,
  seasonRewardCoins: number,
): RankTier => ({
  id,
  name,
  title,
  minRating,
  maxRating,
  iconPath: `/assets/ranks/rank_${id}.webp`,
  primaryColor,
  seasonRewardCoins,
});

export const RANK_TIERS: readonly RankTier[] = [
  tier('bronze', 'Bronze', 'Kartista', 0, 799, '#c9824a', 200),
  tier('silver', 'Prata', 'Piloto de Pista', 800, 1299, '#b9c6d8', 400),
  tier('gold', 'Ouro', 'Competidor', 1300, 1799, '#f5c542', 700),
  tier('platinum', 'Platina', 'Turbo', 1800, 2299, '#3ee08f', 1000),
  tier('diamond', 'Diamante', 'Nitro Master', 2300, 2899, '#00e5ff', 1500),
  tier('legend', 'Lenda', 'Campeão do Grid', 2900, Infinity, '#ff5a7a', 2500),
];

export interface RankProgress {
  tier: RankTier;
  /** `null` na Lenda. */
  next: RankTier | null;
  /** Pontos que faltam para a próxima patente; `null` na Lenda. */
  pointsToNext: number | null;
  /** Progresso dentro da patente atual, de 0 a 100. */
  progress: number;
}

export function rankTierOf(rating: number): RankTier {
  let current = RANK_TIERS[0] as RankTier;
  for (const entry of RANK_TIERS) if (rating >= entry.minRating) current = entry;
  return current;
}

export function getRankFromRating(rating: number): RankProgress {
  const points = Math.max(0, Math.floor(Number.isFinite(rating) ? rating : 0));
  const current = rankTierOf(points);
  const next = RANK_TIERS[RANK_TIERS.indexOf(current) + 1] ?? null;
  if (!next) return { tier: current, next: null, pointsToNext: null, progress: 100 };
  const span = next.minRating - current.minRating;
  return {
    tier: current,
    next,
    pointsToNext: next.minRating - points,
    progress: Math.min(100, Math.max(0, ((points - current.minRating) / span) * 100)),
  };
}

/** Patente pelo nome da divisão gravado no banco ("Mestre", das temporadas antigas, vira Diamante). */
export function rankTierByName(name: string | null | undefined): RankTier | null {
  if (!name) return null;
  if (name === 'Mestre') return RANK_TIERS[4] as RankTier;
  return RANK_TIERS.find((entry) => entry.name === name) ?? null;
}

export interface RankChange {
  promoted: boolean;
  demoted: boolean;
}

/**
 * Subiu ou caiu de patente entre duas divisões (`null` = em posicionamento).
 * Sair do posicionamento conta como promoção: é quando a patente aparece.
 */
export function rankChange(before: string | null, after: string | null): RankChange {
  const from = rankTierByName(before);
  const to = rankTierByName(after);
  if (!to) return { promoted: false, demoted: false };
  if (!from) return { promoted: true, demoted: false };
  const delta = RANK_TIERS.indexOf(to) - RANK_TIERS.indexOf(from);
  return { promoted: delta > 0, demoted: delta < 0 };
}
