import type { Prisma, PrismaClient, Rating, Season, User } from '@prisma/client';
import type {
  AccountView,
  AuthResponse,
  Cosmetics,
  CustomPaint,
  MeResponse,
  PresetData,
  QueueKind,
  RankingEntry,
} from '@kart/shared';
import {
  COSMETIC_ITEMS,
  filterOwnedCosmetics,
  levelView,
  ratingView,
  sanitizeCosmetics,
  sanitizeCustomPaint,
  sanitizePresets,
  sanitizeName,
} from '@kart/shared';
import { rating as newRating } from 'openskill';
import { config } from '../config.js';
import {
  ageOn,
  hashPassword,
  HttpError,
  parseRegistration,
  signToken,
  verifyPassword,
  verifyToken,
} from './auth.js';

type UserWithProfile = User & { profile: { nickname: string; xp?: number } | null };

/** Quem está entrando numa sala: identidade e visual vindos do banco, não do cliente. */
export interface PlayerIdentity {
  userId: string;
  name: string;
  guest: boolean;
  cosmetics: Cosmetics;
  paint: CustomPaint | null;
}

/**
 * Chaves do JSON do loadout que não são slots. O "$" não passa em
 * sanitizeCosmetics, então nunca se confundem com um cosmético.
 */
const PAINT_KEY = '$paint';
const PRESETS_KEY = '$presets';

interface StoredLook {
  loadout: Cosmetics;
  /** `undefined` = a conta nunca gravou pintura. */
  paint: CustomPaint | null | undefined;
  presets: PresetData[];
}

/** Contas, perfil, inventário e loadout. */
export class Accounts {
  constructor(private readonly prisma: PrismaClient) {}

  /** Temporada em vigor; cria a próxima quando a anterior acaba. */
  async season(now = new Date()): Promise<Season> {
    const current = await this.prisma.season.findFirst({
      where: { startsAt: { lte: now }, endsAt: { gt: now } },
      orderBy: { startsAt: 'desc' },
    });
    if (current) return current;
    const count = await this.prisma.season.count();
    return this.prisma.season.create({
      data: {
        name: count === 0 ? config.seasonName : `Temporada ${count + 1}`,
        startsAt: now,
        endsAt: new Date(now.getTime() + config.seasonDays * 86_400_000),
      },
    });
  }

  /** Rating do jogador na temporada (cria com os valores iniciais do OpenSkill). */
  async rating(userId: string, seasonId: string): Promise<Rating> {
    const { mu, sigma } = newRating();
    return this.prisma.rating.upsert({
      where: { userId_seasonId: { userId, seasonId } },
      create: { userId, seasonId, mu, sigma },
      update: {},
    });
  }

  /** Habilidade oculta do Casual (criada na primeira consulta). */
  async casualSkill(userId: string): Promise<{ mu: number; sigma: number; matches: number }> {
    const { mu, sigma } = newRating();
    return this.prisma.casualSkill.upsert({
      where: { userId },
      create: { userId, mu, sigma },
      update: {},
    });
  }

  /** Habilidade usada pela fila de um modo. */
  async queueSkill(userId: string, queue: QueueKind): Promise<{ mu: number; sigma: number }> {
    if (queue === 'casual') return this.casualSkill(userId);
    return this.rating(userId, (await this.season()).id);
  }

  private view(user: UserWithProfile): AccountView {
    return {
      id: user.id,
      name: user.profile?.nickname ?? 'Piloto',
      guest: user.isGuest,
      email: user.email,
      minor: user.birthDate ? ageOn(user.birthDate, new Date()) < 18 : false,
    };
  }

  private session(user: UserWithProfile): AuthResponse {
    return { token: signToken(user.id, config.authSecret), user: this.view(user) };
  }

  private async grantStarters(userId: string): Promise<void> {
    await this.prisma.inventory.createMany({
      data: COSMETIC_ITEMS.filter((item) => item.starter).map((item) => ({
        userId,
        itemId: item.id,
        source: 'starter',
      })),
      skipDuplicates: true,
    });
  }

  /** Login como convidado: só um apelido. */
  async guest(name: unknown): Promise<AuthResponse> {
    const user = await this.prisma.user.create({
      data: { isGuest: true, profile: { create: { nickname: sanitizeName(name) } } },
      include: { profile: true },
    });
    await this.grantStarters(user.id);
    return this.session(user);
  }

  /**
   * Cria conta com e-mail. Se quem pede já é convidado, a conta de convidado é
   * promovida e mantém histórico e inventário.
   */
  async register(
    body: Record<string, unknown>,
    currentUserId: string | null,
  ): Promise<AuthResponse> {
    const { email, password, birthDate } = parseRegistration(body);
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new HttpError(409, 'Já existe uma conta com este e-mail.');
    }
    const nickname = sanitizeName(body.name);
    const account = { email, passwordHash: hashPassword(password), birthDate, isGuest: false };
    const current = currentUserId
      ? await this.prisma.user.findUnique({ where: { id: currentUserId } })
      : null;
    const user = current?.isGuest
      ? await this.prisma.user.update({
          where: { id: current.id },
          data: { ...account, profile: { update: { nickname } } },
          include: { profile: true },
        })
      : await this.prisma.user.create({
          data: { ...account, profile: { create: { nickname } } },
          include: { profile: true },
        });
    await this.grantStarters(user.id);
    return this.session(user);
  }

  async login(body: Record<string, unknown>): Promise<AuthResponse> {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { profile: true },
    });
    // Mesma resposta para e-mail inexistente e senha errada.
    if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    }
    return this.session(user);
  }

  /** Id do usuário dono do token, ou `null`. */
  userIdOf(token: unknown): string | null {
    return verifyToken(token, config.authSecret);
  }

  private async owned(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.inventory.findMany({
      where: { userId },
      select: { itemId: true },
    });
    return new Set(rows.map((row) => row.itemId));
  }

  private async look(userId: string, owned: ReadonlySet<string>): Promise<StoredLook> {
    const row = await this.prisma.equippedLoadout.findUnique({ where: { userId } });
    const data = (
      typeof row?.data === 'object' && row.data !== null && !Array.isArray(row.data) ? row.data : {}
    ) as Record<string, unknown>;
    return {
      loadout: filterOwnedCosmetics(sanitizeCosmetics(data), owned),
      paint: PAINT_KEY in data ? sanitizeCustomPaint(data[PAINT_KEY]) : undefined,
      presets: sanitizePresets(data[PRESETS_KEY]).map((preset) => ({
        ...preset,
        loadout: filterOwnedCosmetics(preset.loadout, owned),
      })),
    };
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new HttpError(401, 'Sessão inválida.');
    const season = await this.season();
    const [rating, owned, stats, records, results] = await Promise.all([
      this.rating(userId, season.id),
      this.owned(userId),
      this.prisma.playerStats.findMany({ where: { userId } }),
      this.prisma.trackRecord.findMany({ where: { userId } }),
      this.prisma.matchResult.findMany({
        where: { userId },
        orderBy: { match: { endedAt: 'desc' } },
        take: 10,
        include: { match: { include: { _count: { select: { results: true } } } } },
      }),
    ]);
    const stored = await this.look(userId, owned);
    return {
      user: this.view(user),
      season: { name: season.name, endsAt: season.endsAt.toISOString() },
      rating: ratingView(rating.mu, rating.sigma, rating.matches),
      level: levelView(user.profile?.xp ?? 0),
      stats: stats.map((row) => ({
        mode: row.mode,
        matches: row.matches,
        wins: row.wins,
        podiums: row.podiums,
        finishes: row.finishes,
        averagePosition: row.matches > 0 ? row.positionSum / row.matches : 0,
        bestLapTicks: row.bestLapTicks,
      })),
      records: records.map((row) => ({
        track: row.track,
        bestLapTicks: row.bestLapTicks,
        bestRaceTicks: row.bestRaceTicks,
      })),
      inventory: [...owned],
      loadout: stored.loadout,
      ...(stored.paint === undefined ? {} : { paint: stored.paint }),
      presets: stored.presets,
      history: results.map((result) => ({
        mode: result.match.mode,
        position: result.position,
        karts: result.match._count.results,
        timeTicks: result.timeTicks,
        bestLapTicks: result.bestLapTicks,
        pointsDelta: result.pointsDelta,
        xp: result.xpGained,
        endedAt: result.match.endedAt.toISOString(),
      })),
    };
  }

  /**
   * Salva o visual equipado: loadout, pintura livre e presets. Item de catálogo
   * que o jogador não possui é recusado. Pintura e presets que não vierem no
   * corpo ficam como estavam.
   */
  async setLoadout(userId: string, body: Record<string, unknown>): Promise<Cosmetics> {
    const owned = await this.owned(userId);
    const wanted = sanitizeCosmetics(body.loadout);
    const allowed = filterOwnedCosmetics(wanted, owned);
    const refused = Object.keys(wanted).filter((slot) => !(slot in allowed));
    if (refused.length > 0) {
      throw new HttpError(403, `Você não possui o item equipado em: ${refused.join(', ')}.`);
    }
    const stored = await this.look(userId, owned);
    const paint = 'paint' in body ? sanitizeCustomPaint(body.paint) : stored.paint;
    const presets =
      'presets' in body
        ? sanitizePresets(body.presets).map((preset) => ({
            ...preset,
            loadout: filterOwnedCosmetics(preset.loadout, owned),
          }))
        : stored.presets;
    const data = JSON.parse(
      JSON.stringify({
        ...allowed,
        ...(paint === undefined ? {} : { [PAINT_KEY]: paint }),
        [PRESETS_KEY]: presets,
      }),
    ) as Prisma.InputJsonObject;
    await this.prisma.equippedLoadout.upsert({
      where: { userId },
      create: { userId, data },
      update: { data },
    });
    return allowed;
  }

  /** Identidade para a sala de corrida. */
  async player(userId: string): Promise<PlayerIdentity | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) return null;
    const { loadout, paint } = await this.look(userId, await this.owned(userId));
    return {
      userId,
      name: user.profile?.nickname ?? 'Piloto',
      guest: user.isGuest,
      cosmetics: loadout,
      paint: paint ?? null,
    };
  }

  /** Concessão por administrador (não há loja nesta etapa). */
  async grant(target: unknown, itemId: unknown, source = 'admin'): Promise<void> {
    if (typeof target !== 'string' || typeof itemId !== 'string') {
      throw new HttpError(400, 'Informe user (id ou e-mail) e item.');
    }
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ id: target }, { email: target }] },
    });
    const item = await this.prisma.cosmeticItem.findUnique({ where: { id: itemId } });
    if (!user || !item) throw new HttpError(404, 'Usuário ou item não encontrado.');
    await this.prisma.inventory.upsert({
      where: { userId_itemId: { userId: user.id, itemId } },
      create: { userId: user.id, itemId, source },
      update: {},
    });
  }

  /** Os 20 melhores da temporada, só quem já saiu do posicionamento aparece com divisão. */
  async ranking(): Promise<RankingEntry[]> {
    const season = await this.season();
    const rows = await this.prisma.rating.findMany({
      where: { seasonId: season.id, matches: { gt: 0 } },
      orderBy: { points: 'desc' },
      take: 20,
      include: { user: { include: { profile: true } } },
    });
    return rows.map((row, i) => ({
      position: i + 1,
      name: row.user.profile?.nickname ?? 'Piloto',
      ...ratingView(row.mu, row.sigma, row.matches),
    }));
  }
}
