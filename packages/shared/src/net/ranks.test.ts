import { describe, expect, it } from 'vitest';
import { getRankFromRating, RANK_TIERS, rankChange, rankTierByName } from './ranks.js';

describe('patentes', () => {
  it('faixas contíguas, sem buracos', () => {
    RANK_TIERS.forEach((tier, i) => {
      const next = RANK_TIERS[i + 1];
      if (next) expect(next.minRating).toBe(tier.maxRating + 1);
      expect(tier.iconPath).toBe(`/assets/ranks/rank_${tier.id}.webp`);
    });
  });

  it('patente, próxima, pontos que faltam e progresso', () => {
    expect(getRankFromRating(0)).toMatchObject({
      tier: { id: 'bronze' },
      next: { id: 'silver' },
      pointsToNext: 800,
      progress: 0,
    });
    expect(getRankFromRating(1050)).toMatchObject({
      tier: { id: 'silver' },
      pointsToNext: 250,
      progress: 50,
    });
    expect(getRankFromRating(2899).tier.id).toBe('diamond');
    expect(getRankFromRating(5000)).toMatchObject({
      tier: { id: 'legend' },
      next: null,
      pointsToNext: null,
      progress: 100,
    });
    expect(getRankFromRating(-5).tier.id).toBe('bronze');
  });

  it('promoção e rebaixamento', () => {
    expect(rankChange('Prata', 'Ouro')).toEqual({ promoted: true, demoted: false });
    expect(rankChange('Ouro', 'Prata')).toEqual({ promoted: false, demoted: true });
    expect(rankChange('Ouro', 'Ouro')).toEqual({ promoted: false, demoted: false });
    expect(rankChange(null, 'Bronze')).toEqual({ promoted: true, demoted: false });
    expect(rankChange(null, null)).toEqual({ promoted: false, demoted: false });
    expect(rankTierByName('Mestre')?.id).toBe('diamond');
  });
});
