import type { PrismaClient } from '@prisma/client';
import type { RoomMode } from '@kart/shared';
import { ratingPoints } from '@kart/shared';
import { rate, rating } from 'openskill';
import type { Accounts } from '../accounts/accounts.js';
import type { MatchReportEntry } from '../game/RaceSession.js';

export interface Skill {
  mu: number;
  sigma: number;
}

/**
 * Novo rating de cada piloto depois de uma corrida. `finishers` vem na ordem
 * de chegada (1º primeiro); cada piloto é um "time" de um no OpenSkill.
 */
export function rateRace(finishers: readonly Skill[]): Skill[] {
  if (finishers.length < 2) return finishers.map((skill) => ({ ...skill }));
  const teams = finishers.map((skill) => [rating(skill)]);
  const rank = finishers.map((_, i) => i + 1);
  return rate(teams, { rank }).map((team) => {
    const updated = team[0] as Skill;
    return { mu: updated.mu, sigma: updated.sigma };
  });
}

export interface MatchRecord {
  mode: RoomMode;
  track: string;
  laps: number;
  /** Na ordem de chegada. */
  report: readonly MatchReportEntry[];
}

/**
 * Grava a partida (resultado e voltas vêm só da simulação do servidor) e, no
 * Ranqueado, atualiza o rating de quem correu.
 */
export async function recordMatch(
  prisma: PrismaClient,
  accounts: Accounts,
  record: MatchRecord,
): Promise<void> {
  const ranked = record.mode === 'ranked';
  const season = ranked ? await accounts.season() : null;
  const match = await prisma.match.create({
    data: {
      mode: record.mode,
      track: record.track,
      laps: record.laps,
      seasonId: season?.id ?? null,
    },
  });

  const deltas = new Map<string, number>();
  const racers = record.report.filter((entry) => entry.userId !== null);
  if (season && racers.length >= 2) {
    const before = await Promise.all(
      racers.map((entry) => accounts.rating(entry.userId as string, season.id)),
    );
    const after = rateRace(before);
    await prisma.$transaction(
      after.map((skill, i) => {
        const userId = racers[i]?.userId as string;
        const previous = before[i] as Skill;
        const points = ratingPoints(skill.mu, skill.sigma);
        deltas.set(userId, points - ratingPoints(previous.mu, previous.sigma));
        return prisma.rating.update({
          where: { userId_seasonId: { userId, seasonId: season.id } },
          data: { mu: skill.mu, sigma: skill.sigma, points, matches: { increment: 1 } },
        });
      }),
    );
  }

  for (const entry of record.report) {
    await prisma.matchResult.create({
      data: {
        matchId: match.id,
        userId: entry.userId,
        name: entry.name,
        isBot: entry.bot,
        slot: entry.slot,
        position: entry.position,
        finished: entry.finished,
        abandoned: entry.abandoned,
        timeTicks: entry.timeTicks,
        bestLapTicks: entry.bestLapTicks,
        penaltyTicks: entry.penaltyTicks,
        pointsDelta: entry.userId ? (deltas.get(entry.userId) ?? null) : null,
        laps: { create: entry.laps.map((ticks, i) => ({ lap: i + 1, ticks })) },
      },
    });
  }
}
