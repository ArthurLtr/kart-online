import type { QueueKind, QueueStatus } from '@kart/shared';
import type { Redis } from 'ioredis';
import type { MatchmakingConfig } from '../config.js';

export interface Ticket {
  userId: string;
  /** Habilidade ao entrar na fila: mu do OpenSkill × 100. */
  skill: number;
  /** Incerteza dessa habilidade: sigma × 100. Jogador novo tem incerteza alta. */
  uncertainty: number;
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

const MATCH_TTL_SECONDS = 60;

/**
 * Fila no Redis, uma por modo: um conjunto ordenado pela habilidade (permite
 * buscar por faixa) e um hash com a entrada de cada jogador.
 */
export class RedisQueueStore implements QueueStore {
  private readonly queueKey: string;
  private readonly entryKey: string;

  constructor(
    private readonly redis: Redis,
    private readonly queue: QueueKind,
  ) {
    this.queueKey = `mm:${queue}:queue`;
    this.entryKey = `mm:${queue}:entry`;
  }

  async add(ticket: Ticket): Promise<void> {
    await this.redis
      .multi()
      .zadd(this.queueKey, ticket.skill, ticket.userId)
      .hset(
        this.entryKey,
        ticket.userId,
        JSON.stringify({ joinedAt: ticket.joinedAt, uncertainty: ticket.uncertainty }),
      )
      .exec();
  }
  async remove(userId: string): Promise<void> {
    await this.redis.multi().zrem(this.queueKey, userId).hdel(this.entryKey, userId).exec();
  }
  private parse(userId: string, skill: string, raw: string | undefined | null): Ticket | null {
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as { joinedAt?: unknown; uncertainty?: unknown };
      const joinedAt = Number(entry.joinedAt);
      if (!Number.isFinite(joinedAt)) return null;
      return {
        userId,
        skill: Number(skill),
        uncertainty: Number(entry.uncertainty) || 0,
        joinedAt,
      };
    } catch {
      return null;
    }
  }
  async get(userId: string): Promise<Ticket | null> {
    const [skill, entry] = await Promise.all([
      this.redis.zscore(this.queueKey, userId),
      this.redis.hget(this.entryKey, userId),
    ]);
    return skill === null ? null : this.parse(userId, skill, entry);
  }
  async all(): Promise<Ticket[]> {
    const [scores, entries] = await Promise.all([
      this.redis.zrange(this.queueKey, 0, -1, 'WITHSCORES'),
      this.redis.hgetall(this.entryKey),
    ]);
    const tickets: Ticket[] = [];
    for (let i = 0; i < scores.length; i += 2) {
      const userId = scores[i] as string;
      const ticket = this.parse(userId, scores[i + 1] as string, entries[userId]);
      if (ticket) tickets.push(ticket);
    }
    return tickets;
  }
  async setMatch(userId: string, reservation: unknown): Promise<void> {
    await this.redis.set(
      `mm:${this.queue}:match:${userId}`,
      JSON.stringify(reservation),
      'EX',
      MATCH_TTL_SECONDS,
    );
  }
  async takeMatch(userId: string): Promise<unknown> {
    const raw = await this.redis.getdel(`mm:${this.queue}:match:${userId}`);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }
}

/**
 * Diferença de habilidade que um jogador aceita. Cresce com a espera (ninguém
 * fica preso na fila) e com a incerteza: de quem o sistema ainda sabe pouco,
 * a faixa já começa mais larga.
 */
export function bandFor(waitedSeconds: number, config: MatchmakingConfig, uncertainty = 0): number {
  const extra = waitedSeconds - config.widenAfterSeconds;
  return Math.round(
    config.baseBand +
      (extra > 0 ? Math.ceil(extra / 10) * config.widenStep : 0) +
      uncertainty * config.uncertaintyBand,
  );
}

/** Distância entre o mais forte e o mais fraco de um grupo. */
export function skillSpread(group: readonly Pick<Ticket, 'skill'>[]): number {
  if (group.length === 0) return 0;
  const skills = group.map((ticket) => ticket.skill);
  return Math.max(...skills) - Math.min(...skills);
}

export const averageSkill = (group: readonly Pick<Ticket, 'skill'>[]): number =>
  group.length === 0 ? 0 : group.reduce((sum, ticket) => sum + ticket.skill, 0) / group.length;

/**
 * Forma as partidas possíveis agora. Quem espera há mais tempo escolhe
 * primeiro e leva os de habilidade mais próxima, desde que os dois lados
 * aceitem a diferença. Partida cheia sai na hora; incompleta só depois de
 * `shortAfterSeconds` e com pelo menos `minPlayers`.
 */
export function formMatches(
  tickets: readonly Ticket[],
  now: number,
  config: MatchmakingConfig,
): Ticket[][] {
  const waited = (ticket: Ticket): number => (now - ticket.joinedAt) / 1000;
  const band = (ticket: Ticket): number => bandFor(waited(ticket), config, ticket.uncertainty);
  const free = [...tickets].sort((a, b) => a.joinedAt - b.joinedAt);
  const matches: Ticket[][] = [];
  for (let i = 0; i < free.length;) {
    const anchor = free[i] as Ticket;
    const anchorBand = band(anchor);
    const near = free
      .filter((other) => {
        const gap = Math.abs(other.skill - anchor.skill);
        return other !== anchor && gap <= anchorBand && gap <= band(other);
      })
      .sort((a, b) => Math.abs(a.skill - anchor.skill) - Math.abs(b.skill - anchor.skill))
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

/** Sala criada para um grupo: o id dela e a reserva de vaga de cada jogador. */
export interface CreatedMatch {
  roomId: string;
  reservations: Map<string, unknown>;
}

/** Cria a sala da partida para o grupo que a fila formou. */
export type MatchCreator = (group: readonly Ticket[]) => Promise<CreatedMatch>;

/** Registro das passagens pela fila (banco). Falha aqui nunca derruba a fila. */
export interface QueueAudit {
  joined(queue: QueueKind, ticket: Ticket): Promise<void>;
  left(queue: QueueKind, userId: string, now: number): Promise<void>;
  matched(
    queue: QueueKind,
    group: readonly Ticket[],
    roomId: string,
    bands: readonly number[],
    now: number,
  ): Promise<void>;
}

/** Fila de um modo: entra, sai, consulta e o laço que forma as partidas. */
export class Matchmaker {
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(
    readonly queue: QueueKind,
    private readonly store: QueueStore,
    private readonly config: MatchmakingConfig,
    private readonly createMatch: MatchCreator,
    private readonly audit: QueueAudit | null = null,
  ) {}

  private record(action: Promise<void> | undefined): void {
    action?.catch((error: unknown) => console.error(`[fila ${this.queue}] auditoria`, error));
  }

  async join(userId: string, skill: number, uncertainty = 0, now = Date.now()): Promise<void> {
    await this.store.takeMatch(userId);
    if (await this.store.get(userId)) return;
    const ticket: Ticket = { userId, skill, uncertainty, joinedAt: now };
    await this.store.add(ticket);
    this.record(this.audit?.joined(this.queue, ticket));
  }

  async leave(userId: string, now = Date.now()): Promise<void> {
    if (!(await this.store.get(userId))) return;
    await this.store.remove(userId);
    this.record(this.audit?.left(this.queue, userId, now));
  }

  /** Verdadeiro se o jogador está esperando ou tem partida formada para buscar. */
  async has(userId: string): Promise<boolean> {
    return (await this.store.get(userId)) !== null;
  }

  async status(userId: string, now = Date.now()): Promise<QueueStatus> {
    const ticket = await this.store.get(userId);
    if (ticket) {
      const waitedSeconds = Math.floor((now - ticket.joinedAt) / 1000);
      return {
        state: 'waiting',
        queue: this.queue,
        waitedSeconds,
        band: bandFor(waitedSeconds, this.config, ticket.uncertainty),
        reservation: null,
      };
    }
    const reservation = await this.store.takeMatch(userId);
    return {
      state: reservation ? 'matched' : 'idle',
      queue: reservation ? this.queue : null,
      waitedSeconds: 0,
      band: 0,
      reservation,
    };
  }

  /** Uma passada: forma as partidas possíveis e tira os jogadores da fila. */
  async tick(now = Date.now()): Promise<number> {
    const groups = formMatches(await this.store.all(), now, this.config);
    for (const group of groups) {
      const created = await this.createMatch(group);
      for (const { userId } of group) {
        await this.store.remove(userId);
        await this.store.setMatch(userId, created.reservations.get(userId) ?? null);
      }
      const bands = group.map((ticket) =>
        bandFor((now - ticket.joinedAt) / 1000, this.config, ticket.uncertainty),
      );
      this.record(this.audit?.matched(this.queue, group, created.roomId, bands, now));
    }
    return groups.length;
  }

  start(intervalMs = 1000): void {
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.tick()
        .catch((error: unknown) =>
          console.error(`[fila ${this.queue}] erro ao formar partida`, error),
        )
        .finally(() => {
          this.busy = false;
        });
    }, intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
