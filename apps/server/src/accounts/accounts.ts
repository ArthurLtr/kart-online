import type { Prisma, PrismaClient, Rating, Season, User } from '@prisma/client';
import type {
  AccountView,
  AuthResponse,
  Cosmetics,
  Currency,
  CustomPaint,
  GoogleProfileNeeded,
  MeResponse,
  PresetData,
  QueueKind,
  RankingEntry,
} from '@kart/shared';
import {
  buyBlock,
  catalogItem,
  DEFAULT_ITEM_IDS,
  filterOwnedCosmetics,
  LOADOUT_SLOTS,
  missingItems,
  paintRequirements,
  presetLimit,
  priceIn,
  levelView,
  ratingView,
  sanitizeCosmetics,
  sanitizeCustomPaint,
  sanitizePresets,
  WELCOME_COINS,
  sanitizeName,
} from '@kart/shared';
import { rating as newRating } from 'openskill';
import { config } from '../config.js';
import {
  ageOn,
  hashPassword,
  HttpError,
  parseBirthDate,
  parseRegistration,
  signToken,
  verifyPassword,
  verifyToken,
} from './auth.js';
import type { GoogleIdentity } from './google.js';

type UserWithProfile = User & {
  profile: { nickname: string; xp?: number; coins?: number } | null;
};

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
      // Sem data de nascimento não dá para saber a idade: vale a regra mais restrita.
      minor: user.birthDate ? ageOn(user.birthDate, new Date()) < 18 : true,
      onboarded: user.hasCompletedOnboarding,
    };
  }

  private session(user: UserWithProfile): AuthResponse {
    return { token: signToken(user.id, config.authSecret), user: this.view(user) };
  }

  /** Moedas de boas-vindas de uma conta recém-criada. Os itens básicos vêm no kart inicial. */
  private async welcome(userId: string): Promise<void> {
    const already = await this.prisma.coinEntry.findFirst({
      where: { userId, reason: 'welcome' },
    });
    if (already) return;
    await this.prisma.$transaction([
      this.prisma.profile.update({
        where: { userId },
        data: { coins: { increment: WELCOME_COINS } },
      }),
      this.prisma.coinEntry.create({
        data: { userId, amount: WELCOME_COINS, reason: 'welcome' },
      }),
    ]);
  }

  /**
   * Entrar com Google. O token já chega verificado (`identity`). Conta que já
   * existe com o mesmo e-mail é ligada ao Google; conta nova pede apelido e
   * data de nascimento antes de ser criada.
   */
  async google(
    identity: GoogleIdentity,
    body: Record<string, unknown>,
    currentUserId: string | null,
  ): Promise<AuthResponse | GoogleProfileNeeded> {
    const linked = await this.prisma.user.findUnique({
      where: { googleId: identity.sub },
      include: { profile: true },
    });
    if (linked) return this.session(linked);

    const sameEmail = await this.prisma.user.findUnique({
      where: { email: identity.email },
      include: { profile: true },
    });
    if (sameEmail) {
      // O Google confirmou que o e-mail é da pessoa: é a mesma conta.
      const user = await this.prisma.user.update({
        where: { id: sameEmail.id },
        data: { googleId: identity.sub },
        include: { profile: true },
      });
      return this.session(user);
    }

    if (typeof body.birthDate !== 'string' || typeof body.name !== 'string') {
      return { needsProfile: true, suggestedName: sanitizeName(identity.name) };
    }
    const birthDate = parseBirthDate(body.birthDate);
    const nickname = sanitizeName(body.name);
    const account = { email: identity.email, googleId: identity.sub, birthDate, isGuest: false };
    const current = currentUserId
      ? await this.prisma.user.findUnique({ where: { id: currentUserId } })
      : null;
    // Conta antiga de convidado é promovida e mantém histórico e inventário.
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
    await this.welcome(user.id);
    return this.session(user);
  }

  /**
   * Kart inicial (primeiro acesso): o jogador monta o visual só com itens
   * básicos. O servidor confere isso, entrega todos os itens básicos, grava o
   * visual e marca a conta como pronta. Só vale uma vez.
   */
  async onboarding(userId: string, body: Record<string, unknown>): Promise<Cosmetics> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(401, 'Sessão inválida.');
    if (user.hasCompletedOnboarding) {
      throw new HttpError(409, 'O kart inicial já foi confirmado.');
    }
    const loadout = sanitizeCosmetics(body.loadout);
    const paint = sanitizeCustomPaint(body.paint);
    const defaults = new Set(DEFAULT_ITEM_IDS);
    for (const slot of LOADOUT_SLOTS) {
      if (!loadout[slot]) throw new HttpError(400, `Escolha um item para: ${slot}.`);
    }
    const extra = missingItems(loadout, paint, defaults);
    if (extra.length > 0) {
      const names = extra.map((id) => catalogItem(id)?.name ?? id).join(', ');
      throw new HttpError(403, `O kart inicial só pode usar itens básicos. Tire: ${names}.`);
    }
    const data = JSON.parse(
      JSON.stringify({ ...loadout, [PAINT_KEY]: paint, [PRESETS_KEY]: [] }),
    ) as Prisma.InputJsonObject;
    await this.prisma.$transaction(async (tx) => {
      // Só passa quem ainda não confirmou: dois pedidos ao mesmo tempo não entregam duas vezes.
      const marked = await tx.user.updateMany({
        where: { id: userId, hasCompletedOnboarding: false },
        data: { hasCompletedOnboarding: true },
      });
      if (marked.count !== 1) throw new HttpError(409, 'O kart inicial já foi confirmado.');
      await tx.inventory.createMany({
        data: DEFAULT_ITEM_IDS.map((itemId) => ({ userId, itemId, source: 'starter' })),
        skipDuplicates: true,
      });
      await tx.equippedLoadout.upsert({
        where: { userId },
        create: { userId, data },
        update: { data },
      });
    });
    return loadout;
  }

  /**
   * Compra um item com moedas ou gemas. Tudo numa transação: o saldo só baixa
   * se ainda cobrir o preço (duas compras ao mesmo tempo não o deixam negativo),
   * a movimentação entra no extrato e o item vai para o inventário.
   */
  async purchase(
    userId: string,
    rawItem: unknown,
    rawCurrency: unknown,
  ): Promise<{ coins: number; gems: number; inventory: string[] }> {
    const item = typeof rawItem === 'string' ? catalogItem(rawItem) : undefined;
    if (!item) throw new HttpError(404, 'Este item não existe.');
    if (rawCurrency !== 'coins' && rawCurrency !== 'gems') {
      throw new HttpError(400, 'Escolha pagar com moedas ou com gemas.');
    }
    const currency: Currency = rawCurrency;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user?.profile) throw new HttpError(401, 'Sessão inválida.');
    if (!user.hasCompletedOnboarding) {
      throw new HttpError(403, 'Confirme o seu kart inicial antes de comprar.');
    }
    const balance = currency === 'coins' ? user.profile.coins : user.gems;
    const price = priceIn(item, currency);
    const unit = currency === 'coins' ? 'moedas' : 'gemas';
    const block = buyBlock(
      item.id,
      currency,
      user.profile.level,
      balance,
      await this.owned(userId),
    );
    if (block === 'owned') throw new HttpError(409, 'Você já tem este item.');
    if (block === 'currency' || price === null) {
      throw new HttpError(
        400,
        item.isDefault ? 'Item básico não é vendido.' : `${item.name} não é vendido por ${unit}.`,
      );
    }
    if (block === 'level') {
      throw new HttpError(403, `Com moedas, este item libera no nível ${item.unlockLevel}.`);
    }
    if (block === 'balance') throw new HttpError(403, `Faltam ${price - balance} ${unit}.`);

    await this.prisma.$transaction(async (tx) => {
      if (currency === 'coins') {
        const paid = await tx.profile.updateMany({
          where: { userId, coins: { gte: price } },
          data: { coins: { decrement: price } },
        });
        if (paid.count !== 1) throw new HttpError(403, 'Moedas insuficientes.');
        await tx.coinEntry.create({
          data: { userId, amount: -price, reason: 'purchase', ref: item.id },
        });
      } else {
        const paid = await tx.user.updateMany({
          where: { id: userId, gems: { gte: price } },
          data: { gems: { decrement: price } },
        });
        if (paid.count !== 1) throw new HttpError(403, 'Gemas insuficientes.');
        await tx.gemLedger.create({
          data: { userId, amount: -price, type: 'spend', referenceId: item.id },
        });
      }
      // A chave (usuário, item) é única: a mesma compra duas vezes desfaz a segunda.
      await tx.inventory.create({
        data: { userId, itemId: item.id, source: `purchase:${currency}` },
      });
    });
    const after = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    return {
      coins: after?.profile?.coins ?? 0,
      gems: after?.gems ?? 0,
      inventory: [...(await this.owned(userId))],
    };
  }

  /**
   * Cria conta com e-mail. Conta antiga de convidado (de quando existia esse
   * modo) é promovida e mantém histórico e inventário.
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
    await this.welcome(user.id);
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
    // Pintura que usa algo que a conta não possui (mais) não é devolvida nem vai para a pista.
    const paint = PAINT_KEY in data ? sanitizeCustomPaint(data[PAINT_KEY]) : undefined;
    return {
      loadout: filterOwnedCosmetics(sanitizeCosmetics(data), owned),
      paint: paint && !paintRequirements(paint).every((id) => owned.has(id)) ? null : paint,
      presets: this.ownedPresets(sanitizePresets(data[PRESETS_KEY]), owned),
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
      coins: user.profile?.coins ?? 0,
      gems: user.gems,
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
        coins: result.coinsGained,
        endedAt: result.match.endedAt.toISOString(),
      })),
    };
  }

  /**
   * Salva o visual equipado: loadout, pintura livre e presets. A posse é
   * conferida aqui, item por item: os do visual e também os que a pintura livre
   * usa (acabamentos, padrão, adesivos, espaço extra). Faltando qualquer um,
   * nada é gravado. Pintura e presets que não vierem no corpo ficam como estavam.
   */
  async setLoadout(userId: string, body: Record<string, unknown>): Promise<Cosmetics> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(401, 'Sessão inválida.');
    if (!user.hasCompletedOnboarding) {
      throw new HttpError(403, 'Confirme o seu kart inicial primeiro.');
    }
    const owned = await this.owned(userId);
    const wanted = sanitizeCosmetics(body.loadout);
    const stored = await this.look(userId, owned);
    const paint = 'paint' in body ? sanitizeCustomPaint(body.paint) : stored.paint;
    const missing = missingItems(wanted, paint ?? null, owned);
    if (missing.length > 0) {
      const names = missing.map((id) => catalogItem(id)?.name ?? id).join(', ');
      throw new HttpError(403, `Você não possui: ${names}.`);
    }
    const presets =
      'presets' in body ? this.ownedPresets(sanitizePresets(body.presets), owned) : stored.presets;
    const data = JSON.parse(
      JSON.stringify({
        ...wanted,
        ...(paint === undefined ? {} : { [PAINT_KEY]: paint }),
        [PRESETS_KEY]: presets,
      }),
    ) as Prisma.InputJsonObject;
    await this.prisma.equippedLoadout.upsert({
      where: { userId },
      create: { userId, data },
      update: { data },
    });
    return wanted;
  }

  /** Presets dentro do limite da conta e só com o que ela possui. */
  private ownedPresets(presets: PresetData[], owned: ReadonlySet<string>): PresetData[] {
    return presets.slice(0, presetLimit(owned)).map((preset) => ({
      ...preset,
      loadout: filterOwnedCosmetics(preset.loadout, owned),
      paint: paintRequirements(preset.paint).every((id) => owned.has(id)) ? preset.paint : null,
    }));
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
      guest: user.isGuest || !user.hasCompletedOnboarding,
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
