import type { QueueStatus } from '@kart/shared';
import type { Redis } from 'ioredis';
import type { MatchmakingConfig } from '../config.js';

export interface Ticket {
  userId: string;
  /** Pontos de ranqueada quando entrou na fila. */
  points: number;
  /** Relógio (ms) de quando entrou. */
  joinedAt: number;
}

/** Onde a fila mora. Em produção é o Redis; sem ele, a memória do processo. */
export interface QueueStore {
  add(ticket: Ticket): Promise<void>;
  remove(userId: string): Promise<void>;
  get(userId: string): Promise<Ticket | null>;
  all(): Promise<Ticket[]>;
  /** Guarda a reserva de vaga da partida formada, até o cliente buscar. */
  setMatch(userId: string, reservation: unknown): Promise<void>;
  takeMatch(userId: string): Promise<unknown>;
}

export class MemoryQueueStore implements QueueStore {
  private readonly tickets = new Map<string, Ticket>();
  private readonly matches = new Map<string, unknown>();

  async add(ticket: Ticket): Promise<void> {
    this.tickets.set(ticket.userId, ticket);
  }
  async remove(userId: string): Promise<void> {
    this.tickets.delete(userId);
  }
  async get(userId: string): Promise<Ticket | null> {
    return this.tickets.get(userId) ?? null;
  }
  async all(): Promise<Ticket[]> {
    return [...this.tickets.values()];
  }
  async setMatch(userId: string, reservation: unknown): Promise<void> {
    this.matches.set(userId, reservation);
  }
  async takeMatch(userId: string): Promise<unknown> {
    const reservation = this.matches.get(userId) ?? null;
    this.matches.delete(userId);
    return reservation;
  }
}

const QUEUE_KEY = 'mm:queue';
const JOINED_KEY = 'mm:joined';
const MATCH_TTL_SECONDS = 60;

/**
 * Fila no Redis: um conjunto ordenado pelo rating (permite buscar por faixa)
 * e um hash com o horário de entrada de cada jogador.
 */
export class RedisQueueStore implements QueueStore {
  constructor(private readonly redis: Redis) {}

  async add(ticket: Ticket): Promise<void> {
    await this.redis
      .multi()
      .zadd(QUEUE_KEY, ticket.points, ticket.userId)
      .hset(JOINED_KEY, ticket.userId, String(ticket.joinedAt))
      .exec();
  }
  async remove(userId: string): Promise<void> {
    await this.redis.multi().zrem(QUEUE_KEY, userId).hdel(JOINED_KEY, userId).exec();
  }
  async get(userId: string): Promise<Ticket | null> {
    const [points, joinedAt] = await Promise.all([
      this.redis.zscore(QUEUE_KEY, userId),
      this.redis.hget(JOINED_KEY, userId),
    ]);
    if (points === null || joinedAt === null) return null;
    return { userId, points: Number(points), joinedAt: Number(joinedAt) };
  }
  async all(): Promise<Ticket[]> {
    const [scores, joined] = await Promise.all([
      this.redis.zrange(QUEUE_KEY, 0, -1, 'WITHSCORES'),
      this.redis.hgetall(JOINED_KEY),
    ]);
    const tickets: Ticket[] = [];
    for (let i = 0; i < scores.length; i += 2) {
      const userId = scores[i] as string;
      const joinedAt = Number(joined[userId]);
      if (Number.isFinite(joinedAt))
        tickets.push({ userId, points: Number(scores[i + 1]), joinedAt });
    }
    return tickets;
  }
  async setMatch(userId: string, reservation: unknown): Promise<void> {
    await this.redis.set(
      `mm:match:${userId}`,
      JSON.stringify(reservation),
      'EX',
      MATCH_TTL_SECONDS,
    );
  }
  async takeMatch(userId: string): Promise<unknown> {
    const raw = await this.redis.getdel(`mm:match:${userId}`);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }
}

/** Diferença de pontos que um jogador aceita: cresce depois de 30 s de espera. */
export function bandFor(waitedSeconds: number, config: MatchmakingConfig): number {
  const extra = waitedSeconds - config.widenAfterSeconds;
  return config.baseBand + (extra > 0 ? Math.ceil(extra / 10) * config.widenStep : 0);
}

/**
 * Forma as partidas possíveis agora. Quem espera há mais tempo escolhe
 * primeiro e leva os de rating mais próximo, desde que os dois lados aceitem a
 * diferença. Partida cheia sai na hora; incompleta só depois de
 * `shortAfterSeconds` e com pelo menos `minPlayers`.
 */
export function formMatches(
  tickets: readonly Ticket[],
  now: number,
  config: MatchmakingConfig,
): Ticket[][] {
  const waited = (ticket: Ticket): number => (now - ticket.joinedAt) / 1000;
  const free = [...tickets].sort((a, b) => a.joinedAt - b.joinedAt);
  const matches: Ticket[][] = [];
  for (let i = 0; i < free.length;) {
    const anchor = free[i] as Ticket;
    const anchorBand = bandFor(waited(anchor), config);
    const near = free
      .filter((other) => {
        const gap = Math.abs(other.points - anchor.points);
        return other !== anchor && gap <= anchorBand && gap <= bandFor(waited(other), config);
      })
      .sort((a, b) => Math.abs(a.points - anchor.points) - Math.abs(b.points - anchor.points))
      .slice(0, config.size - 1);
    const group = [anchor, ...near];
    const full = group.length === config.size;
    const enough = group.length >= config.minPlayers && waited(anchor) >= config.shortAfterSeconds;
    if (full || enough) {
      matches.push(group);
      for (const member of group) free.splice(free.indexOf(member), 1);
    } else {
      i++;
    }
  }
  return matches;
}

/** Cria a sala da partida e devolve a reserva de vaga de cada jogador. */
export type MatchCreator = (userIds: string[]) => Promise<Map<string, unknown>>;

/** Fila ranqueada: entra, sai, consulta e o laço que forma as partidas. */
export class Matchmaker {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(
    private readonly store: QueueStore,
    private readonly config: MatchmakingConfig,
    private readonly createMatch: MatchCreator,
  ) {}

  async join(userId: string, points: number, now = Date.now()): Promise<void> {
    await this.store.takeMatch(userId);
    if (!(await this.store.get(userId))) await this.store.add({ userId, points, joinedAt: now });
  }

  leave(userId: string): Promise<void> {
    return this.store.remove(userId);
  }

  async status(userId: string, now = Date.now()): Promise<QueueStatus> {
    const ticket = await this.store.get(userId);
    if (ticket) {
      const waitedSeconds = Math.floor((now - ticket.joinedAt) / 1000);
      return {
        state: 'waiting',
        waitedSeconds,
        band: bandFor(waitedSeconds, this.config),
        reservation: null,
      };
    }
    const reservation = await this.store.takeMatch(userId);
    return { state: reservation ? 'matched' : 'idle', waitedSeconds: 0, band: 0, reservation };
  }

  /** Uma passada: forma as partidas possíveis e tira os jogadores da fila. */
  async tick(now = Date.now()): Promise<number> {
    const groups = formMatches(await this.store.all(), now, this.config);
    for (const group of groups) {
      const userIds = group.map((ticket) => ticket.userId);
      const reservations = await this.createMatch(userIds);
      for (const userId of userIds) {
        await this.store.remove(userId);
        await this.store.setMatch(userId, reservations.get(userId) ?? null);
      }
    }
    return groups.length;
  }

  start(intervalMs = 1000): void {
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.tick()
        .catch((error: unknown) => console.error('[fila] erro ao formar partida', error))
        .finally(() => {
          this.busy = false;
        });
    }, intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
