import type { PrismaClient, Rating, Season, User } from '@prisma/client';
import type { AccountView, AuthResponse, Cosmetics, MeResponse, RankingEntry } from '@kart/shared';
import {
  COSMETIC_ITEMS,
  filterOwnedCosmetics,
  ratingView,
  sanitizeCosmetics,
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

type UserWithProfile = User & { profile: { nickname: string } | null };

/** Quem está entrando numa sala: identidade e visual vindos do banco, não do cliente. */
export interface PlayerIdentity {
  userId: string;
  name: string;
  guest: boolean;
  cosmetics: Cosmetics;
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

  private async loadout(userId: string, owned: ReadonlySet<string>): Promise<Cosmetics> {
    const row = await this.prisma.equippedLoadout.findUnique({ where: { userId } });
    return filterOwnedCosmetics(sanitizeCosmetics(row?.data), owned);
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new HttpError(401, 'Sessão inválida.');
    const season = await this.season();
    const [rating, owned, results] = await Promise.all([
      this.rating(userId, season.id),
      this.owned(userId),
      this.prisma.matchResult.findMany({
        where: { userId },
        orderBy: { match: { endedAt: 'desc' } },
        take: 10,
        include: { match: { include: { _count: { select: { results: true } } } } },
      }),
    ]);
    return {
      user: this.view(user),
      season: { name: season.name, endsAt: season.endsAt.toISOString() },
      rating: ratingView(rating.mu, rating.sigma, rating.matches),
      inventory: [...owned],
      loadout: await this.loadout(userId, owned),
      history: results.map((result) => ({
        mode: result.match.mode,
        position: result.position,
        karts: result.match._count.results,
        timeTicks: result.timeTicks,
        bestLapTicks: result.bestLapTicks,
        pointsDelta: result.pointsDelta,
        endedAt: result.match.endedAt.toISOString(),
      })),
    };
  }

  /** Salva o loadout equipado; item de catálogo que o jogador não possui é recusado. */
  async setLoadout(userId: string, raw: unknown): Promise<Cosmetics> {
    const wanted = sanitizeCosmetics(raw);
    const allowed = filterOwnedCosmetics(wanted, await this.owned(userId));
    const refused = Object.keys(wanted).filter((slot) => !(slot in allowed));
    if (refused.length > 0) {
      throw new HttpError(403, `Você não possui o item equipado em: ${refused.join(', ')}.`);
    }
    await this.prisma.equippedLoadout.upsert({
      where: { userId },
      create: { userId, data: allowed },
      update: { data: allowed },
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
    return {
      userId,
      name: user.profile?.nickname ?? 'Piloto',
      guest: user.isGuest,
      cosmetics: await this.loadout(userId, await this.owned(userId)),
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
