import { divisionOf, PLACEMENT_MATCHES, ratingPoints, ratingView } from '@kart/shared';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { rating } from 'openskill';
import { describe, expect, it } from 'vitest';
import { config } from '../config.js';
import type { QueueStore, Ticket } from './matchmaking.js';
import {
  bandFor,
  formMatches,
  Matchmaker,
  MemoryQueueStore,
  RedisQueueStore,
} from './matchmaking.js';
import { rateRace } from './rating.js';

const mm = { ...config.matchmaking, size: 9, minPlayers: 2 };
const ticket = (userId: string, points: number, waitedSeconds = 0): Ticket => ({
  userId,
  points,
  joinedAt: 1_000_000 - waitedSeconds * 1000,
});
const NOW = 1_000_000;

describe('rating OpenSkill', () => {
  it('9 colocados: quem chega na frente sobe, quem chega atrás desce', () => {
    const before = Array.from({ length: 9 }, () => rating());
    const after = rateRace(before);
    expect(after).toHaveLength(9);
    for (let i = 1; i < 9; i++) expect(after[i]!.mu).toBeLessThan(after[i - 1]!.mu);
    expect(after[0]!.mu).toBeGreaterThan(before[0]!.mu);
    expect(after[8]!.mu).toBeLessThan(before[8]!.mu);
    // A incerteza cai para todos depois de uma partida.
    for (const skill of after) expect(skill.sigma).toBeLessThan(before[0]!.sigma);
  });

  it('zebra vale mais: vencer um favorito rende mais que vencer um igual', () => {
    const rookie = { mu: 25, sigma: 4 };
    const [vsEqual] = rateRace([rookie, { mu: 25, sigma: 4 }]);
    const [vsFavorite] = rateRace([rookie, { mu: 35, sigma: 4 }]);
    expect(vsFavorite!.mu - rookie.mu).toBeGreaterThan(vsEqual!.mu - rookie.mu);
  });

  it('corrida de um só não mexe no rating', () => {
    expect(rateRace([{ mu: 30, sigma: 5 }])).toEqual([{ mu: 30, sigma: 5 }]);
  });

  it('divisões e posicionamento', () => {
    expect(divisionOf(0)).toBe('Bronze');
    expect(divisionOf(799)).toBe('Bronze');
    expect(divisionOf(800)).toBe('Prata');
    expect(divisionOf(1300)).toBe('Ouro');
    expect(divisionOf(1800)).toBe('Platina');
    expect(divisionOf(2300)).toBe('Diamante');
    expect(divisionOf(2800)).toBe('Mestre');
    expect(divisionOf(9999)).toBe('Lenda');
    expect(ratingPoints(25, 25 / 3)).toBe(0);
    // Durante as 5 partidas de posicionamento a divisão não aparece.
    expect(ratingView(30, 5, PLACEMENT_MATCHES - 1)).toMatchObject({
      division: null,
      placementLeft: 1,
    });
    expect(ratingView(30, 5, PLACEMENT_MATCHES)).toMatchObject({
      division: 'Ouro',
      placementLeft: 0,
    });
  });
});

describe('matchmaking por faixa de rating', () => {
  it('a faixa só cresce depois de 30 s', () => {
    expect(bandFor(0, mm)).toBe(mm.baseBand);
    expect(bandFor(30, mm)).toBe(mm.baseBand);
    expect(bandFor(31, mm)).toBe(mm.baseBand + mm.widenStep);
    expect(bandFor(55, mm)).toBe(mm.baseBand + 3 * mm.widenStep);
  });

  it('9 jogadores na mesma faixa formam partida na hora', () => {
    const tickets = Array.from({ length: 9 }, (_, i) => ticket(`u${i}`, 1000 + i * 10));
    const matches = formMatches(tickets, NOW, mm);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toHaveLength(9);
  });

  it('menos de 9 esperam; depois de 60 s sai com quem tem', () => {
    const fresh = [ticket('a', 1000, 5), ticket('b', 1050, 5)];
    expect(formMatches(fresh, NOW, mm)).toHaveLength(0);
    const patient = [ticket('a', 1000, 61), ticket('b', 1050, 5)];
    expect(formMatches(patient, NOW, mm)[0]!.map((t) => t.userId)).toEqual(['a', 'b']);
  });

  it('ratings distantes não se enfrentam até a faixa dos dois abrir', () => {
    const far = (waited: number) => [ticket('a', 500, waited), ticket('b', 1500, waited)];
    expect(formMatches(far(61), NOW, mm)).toHaveLength(0);
    // 1000 pontos de distância: 200 + 6 × 150 = 1100 aos 90 s.
    expect(formMatches(far(85), NOW, mm)).toHaveLength(1);
  });

  it('com 12 na fila, os 9 mais próximos de quem espera há mais tempo correm', () => {
    const tickets = Array.from({ length: 12 }, (_, i) => ticket(`u${i}`, 1000 + i * 15, 12 - i));
    const matches = formMatches(tickets, NOW, mm);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.map((t) => t.userId).sort()).toEqual(
      ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'].sort(),
    );
  });
});

const stores: [string, () => QueueStore][] = [
  ['memória', () => new MemoryQueueStore()],
  ['Redis', () => new RedisQueueStore(new RedisMock() as unknown as Redis)],
];

describe.each(stores)('fila em %s', (_name, create) => {
  it('entra, forma a partida, entrega a reserva uma única vez', async () => {
    const created: string[][] = [];
    const matchmaker = new Matchmaker(create(), { ...mm, size: 3 }, async (userIds) => {
      created.push(userIds);
      return new Map(userIds.map((id) => [id, { room: 'sala', seat: id }]));
    });
    await matchmaker.join('a', 1000, NOW);
    await matchmaker.join('b', 1100, NOW);
    await matchmaker.join('a', 1000, NOW + 5000); // entrar de novo não reinicia a espera
    expect(await matchmaker.status('a', NOW + 8000)).toMatchObject({
      state: 'waiting',
      waitedSeconds: 8,
    });
    expect(await matchmaker.tick(NOW + 8000)).toBe(0);

    await matchmaker.join('c', 1050, NOW + 9000);
    expect(await matchmaker.tick(NOW + 9000)).toBe(1);
    expect(created[0]!.sort()).toEqual(['a', 'b', 'c']);
    expect(await matchmaker.status('b')).toMatchObject({
      state: 'matched',
      reservation: { room: 'sala', seat: 'b' },
    });
    expect((await matchmaker.status('b')).state).toBe('idle');
  });

  it('quem sai da fila não é chamado', async () => {
    const matchmaker = new Matchmaker(create(), { ...mm, size: 2 }, async () => new Map());
    await matchmaker.join('a', 1000, NOW);
    await matchmaker.leave('a');
    await matchmaker.join('b', 1000, NOW);
    expect(await matchmaker.tick(NOW)).toBe(0);
    expect((await matchmaker.status('a')).state).toBe('idle');
  });
});
