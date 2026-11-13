import type { Prisma, PrismaClient } from '@prisma/client';
import type { RoomMode } from '@kart/shared';
import {
  botMu,
  divisionOf,
  levelView,
  PLACEMENT_MATCHES,
  raceXp,
  ratingPoints,
  rewardsBetween,
  START_MU,
  START_SIGMA,
  totalXp,
} from '@kart/shared';
import { rate, rating } from 'openskill';
import type { Accounts } from '../accounts/accounts.js';
import type { MatchReportEntry } from '../game/RaceSession.js';

export interface Skill {
  mu: number;
  sigma: number;
}

/** Incerteza de um bot na conta do rating: baixa, porque o nível dele é conhecido. */
const BOT_SIGMA = 1.5;

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

/** Quem entra na conta do rating de uma corrida, na ordem de chegada. */
export interface Rated {
  /** Conta do jogador; `null` para bot. */
  userId: string | null;
  skill: Skill;
}

/**
 * Rating do Casual: os humanos com conta são avaliados contra todos, inclusive
 * os bots, que entram com a habilidade fixa do nível deles. Assim quem corre
 * só contra bots também tem a habilidade medida, e a próxima corrida vem com
 * bots (e adversários) do tamanho certo. O rating dos bots é descartado.
 */
export function rateWithBots(order: readonly Rated[]): Map<string, Skill> {
  const after = rateRace(order.map((entry) => entry.skill));
  const result = new Map<string, Skill>();
  order.forEach((entry, i) => {
    if (entry.userId) result.set(entry.userId, after[i] as Skill);
  });
  return result;
}

export interface MatchRecord {
  mode: RoomMode;
  track: string;
  laps: number;
  /** Na ordem de chegada. */
  report: readonly MatchReportEntry[];
  roomId?: string;
  /** A sala foi montada pela fila. */
  matched?: boolean;
  startedAt?: Date;
}

const divisionFor = (skill: Skill, matches: number): string | null =>
  matches < PLACEMENT_MATCHES ? null : divisionOf(ratingPoints(skill.mu, skill.sigma));

/** O que mudou para um jogador com conta nesta corrida. */
interface Change {
  before: Skill;
  after: Skill;
  pointsDelta: number | null;
  divisionBefore: string | null;
  divisionAfter: string | null;
}

/**
 * Grava a partida (resultado e voltas vêm só da simulação do servidor),
 * atualiza a habilidade de quem correu (rating visível no Ranqueado, oculto no
 * Casual), a carreira, os recordes de pista e a experiência.
 */
export async function recordMatch(
  prisma: PrismaClient,
  accounts: Accounts,
  record: MatchRecord,
): Promise<string> {
  const { mode, report } = record;
  const season = mode === 'ranked' ? await accounts.season() : null;
  const racers = report.filter((entry) => entry.userId !== null);
  const humans = report.filter((entry) => !entry.bot).length;
  const bots = report.length - humans;
  const changes = new Map<string, Change>();
  const updates: Prisma.PrismaPromise<unknown>[] = [];

  if (season && racers.length >= 2) {
    const rows = await Promise.all(
      racers.map((entry) => accounts.rating(entry.userId as string, season.id)),
    );
    const after = rateRace(rows);
    after.forEach((skill, i) => {
      const userId = racers[i]?.userId as string;
      const row = rows[i]!;
      const points = ratingPoints(skill.mu, skill.sigma);
      changes.set(userId, {
        before: { mu: row.mu, sigma: row.sigma },
        after: skill,
        pointsDelta: points - ratingPoints(row.mu, row.sigma),
        divisionBefore: divisionFor(row, row.matches),
        divisionAfter: divisionFor(skill, row.matches + 1),
      });
      updates.push(
        prisma.rating.update({
          where: { userId_seasonId: { userId, seasonId: season.id } },
          data: { mu: skill.mu, sigma: skill.sigma, points, matches: { increment: 1 } },
        }),
      );
    });
  } else if (mode === 'casual' && racers.length >= 1 && report.length >= 2) {
    const skills = new Map<string, Skill>();
    for (const entry of racers) {
      skills.set(entry.userId as string, await accounts.casualSkill(entry.userId as string));
    }
    // Humano sem conta entra como desconhecido (habilidade inicial).
    const order: Rated[] = report.map((entry) => ({
      userId: entry.userId,
      skill: entry.userId
        ? (skills.get(entry.userId) as Skill)
        : entry.bot
          ? { mu: botMu(entry.botSkill ?? 0.5), sigma: BOT_SIGMA }
          : { mu: START_MU, sigma: START_SIGMA },
    }));
    for (const [userId, skill] of rateWithBots(order)) {
      const before = skills.get(userId) as Skill;
      changes.set(userId, {
        before: { mu: before.mu, sigma: before.sigma },
        after: skill,
        pointsDelta: null,
        divisionBefore: null,
        divisionAfter: null,
      });
      updates.push(
        prisma.casualSkill.update({
          where: { userId },
          data: { mu: skill.mu, sigma: skill.sigma, matches: { increment: 1 } },
        }),
      );
    }
  }
  if (updates.length > 0) await prisma.$transaction(updates);

  const known = [...changes.values()].map((change) => change.before.mu);
  const botLevels = report.flatMap((entry) => (entry.bot ? [entry.botSkill ?? 0.5] : []));
  const durationTicks = report.reduce((max, entry) => Math.max(max, entry.timeTicks ?? 0), 0);
  const match = await prisma.match.create({
    data: {
      mode,
      track: record.track,
      laps: record.laps,
      seasonId: season?.id ?? null,
      roomId: record.roomId ?? null,
      matched: record.matched ?? false,
      startedAt: record.startedAt ?? null,
      durationTicks: durationTicks > 0 ? durationTicks : null,
      humans,
      bots,
      avgSkill: known.length > 0 ? known.reduce((sum, mu) => sum + mu, 0) / known.length : null,
      skillSpread: known.length > 0 ? Math.max(...known) - Math.min(...known) : null,
      botSkill:
        botLevels.length > 0
          ? botLevels.reduce((sum, level) => sum + level, 0) / botLevels.length
          : null,
    },
  });

  for (const entry of report) {
    const userId = entry.userId;
    const change = userId ? changes.get(userId) : undefined;
    let xp = 0;
    if (userId) {
      const previous = await prisma.trackRecord.findUnique({
        where: { userId_track: { userId, track: record.track } },
      });
      const lap = entry.bestLapTicks;
      const personalBest =
        lap !== null && previous?.bestLapTicks != null && lap < previous.bestLapTicks;
      xp = totalXp(
        raceXp({
          mode,
          position: entry.position,
          karts: report.length,
          humans,
          finished: entry.finished,
          abandoned: entry.abandoned,
          penaltyTicks: entry.penaltyTicks,
          personalBest,
        }),
      );
      await saveCareer(prisma, userId, mode, record.track, entry, previous, xp);
    }
    await prisma.matchResult.create({
      data: {
        matchId: match.id,
        userId,
        name: entry.name,
        isBot: entry.bot,
        slot: entry.slot,
        position: entry.position,
        finished: entry.finished,
        abandoned: entry.abandoned,
        timeTicks: entry.timeTicks,
        bestLapTicks: entry.bestLapTicks,
        penaltyTicks: entry.penaltyTicks,
        pointsDelta: change?.pointsDelta ?? null,
        muBefore: change?.before.mu ?? null,
        sigmaBefore: change?.before.sigma ?? null,
        muAfter: change?.after.mu ?? null,
        sigmaAfter: change?.after.sigma ?? null,
        divisionBefore: change?.divisionBefore ?? null,
        divisionAfter: change?.divisionAfter ?? null,
        xpGained: xp,
        laps: { create: entry.laps.map((ticks, i) => ({ lap: i + 1, ticks })) },
      },
    });
  }

  // Liga as passagens pela fila à corrida que saiu delas.
  if (record.roomId && record.matched) {
    await prisma.matchmakingTicket.updateMany({
      where: { roomId: record.roomId, matchId: null },
      data: { matchId: match.id },
    });
  }
  return match.id;
}

const lower = (current: number | null | undefined, next: number | null): number | null =>
  next === null ? (current ?? null) : current == null ? next : Math.min(current, next);

/** Carreira, recordes de pista, experiência e recompensas de nível de um jogador. */
async function saveCareer(
  prisma: PrismaClient,
  userId: string,
  mode: RoomMode,
  track: string,
  entry: MatchReportEntry,
  previous: { bestLapTicks: number | null; bestRaceTicks: number | null } | null,
  xp: number,
): Promise<void> {
  const raceTicks = entry.finished ? entry.timeTicks : null;
  const stats = await prisma.playerStats.findUnique({
    where: { userId_mode: { userId, mode } },
  });
  const counts = {
    matches: 1,
    wins: entry.finished && entry.position === 1 ? 1 : 0,
    podiums: entry.finished && entry.position <= 3 ? 1 : 0,
    finishes: entry.finished ? 1 : 0,
    abandons: entry.abandoned ? 1 : 0,
    positionSum: entry.position,
    totalTicks: entry.timeTicks ?? 0,
  };
  await prisma.playerStats.upsert({
    where: { userId_mode: { userId, mode } },
    create: { userId, mode, ...counts, bestLapTicks: entry.bestLapTicks },
    update: {
      matches: { increment: counts.matches },
      wins: { increment: counts.wins },
      podiums: { increment: counts.podiums },
      finishes: { increment: counts.finishes },
      abandons: { increment: counts.abandons },
      positionSum: { increment: counts.positionSum },
      totalTicks: { increment: counts.totalTicks },
      bestLapTicks: lower(stats?.bestLapTicks, entry.bestLapTicks),
      lastPlayedAt: new Date(),
    },
  });

  const bestLapTicks = lower(previous?.bestLapTicks, entry.bestLapTicks);
  const bestRaceTicks = lower(previous?.bestRaceTicks, raceTicks);
  if (bestLapTicks !== null || bestRaceTicks !== null) {
    await prisma.trackRecord.upsert({
      where: { userId_track: { userId, track } },
      create: { userId, track, bestLapTicks, bestRaceTicks },
      update: { bestLapTicks, bestRaceTicks },
    });
  }

  if (xp <= 0) return;
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return;
  const next = levelView(profile.xp + xp);
  await prisma.profile.update({
    where: { userId },
    data: { xp: next.xp, level: next.level },
  });
  const rewards = rewardsBetween(profile.level, next.level);
  if (rewards.length > 0) {
    await prisma.inventory.createMany({
      data: rewards.map((itemId) => ({ userId, itemId, source: 'level' })),
      skipDuplicates: true,
    });
  }
}
