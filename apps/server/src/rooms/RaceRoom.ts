import colyseus from 'colyseus';
import type { Client } from 'colyseus';
import type { JoinOptions, PaintsMessage, PingMessage, RoomMode, RoomPhase } from '@kart/shared';
import {
  getCircuitoDaOrla,
  MAX_KARTS,
  MESSAGES,
  NET_TICK_HZ,
  sanitizeCosmetics,
  sanitizeCustomPaint,
  sanitizeName,
  SIM_HZ,
} from '@kart/shared';
import type { PlayerIdentity } from '../accounts/accounts.js';
import { RaceSession } from '../game/RaceSession.js';
import { recordMatch } from '../ranked/rating.js';
import { getServices } from '../services.js';

// O pacote colyseus Ã© CommonJS: no Node ESM sÃ³ o export default Ã© confiÃ¡vel.
const { Room } = colyseus;

const RECONNECT_SECONDS = 30;
/** Quanto a sala ranqueada espera quem a fila escolheu antes de largar sem ele. */
const RANKED_WAIT_SECONDS = 30;
/** No Casual a espera por quem a fila juntou Ã© curta. */
const CASUAL_WAIT_SECONDS = 12;

interface CreateOptions extends Partial<JoinOptions> {
  serverKey?: string;
  /** Bilhete de uso Ãºnico â†’ conta. SÃ³ o servidor preenche. */
  tickets?: Record<string, string>;
  /** NÃ­vel dos bots escolhido pela fila (0 a 1). */
  botSkill?: number;
}
type AuthOptions = Partial<JoinOptions> & { ticket?: string };
const MODES: readonly RoomMode[] = ['casual', 'private', 'ranked'];

/**
 * Sala de corrida. Ã‰ sÃ³ a ponte entre os clientes e a RaceSession: recebe
 * entradas, roda a simulaÃ§Ã£o a 60 Hz e envia snapshots a 30 Hz. Toda regra
 * (lobby, largada, voltas, resultado) estÃ¡ na sessÃ£o.
 */
export class RaceRoom extends Room {
  override maxClients = MAX_KARTS;
  private session!: RaceSession;
  private lastPhase: RoomPhase = 'lobby';
  private lastSecondsLeft: number | null = null;
  /** Pinturas já enviadas à sala (JSON), para só reenviar quando mudam. */
  private sentPaints = '';
  private mode: RoomMode = 'casual';
  private tickets = new Map<string, string>();
  /** Sala montada pela fila: sÃ³ entra quem tem bilhete. */
  private queued = false;
  private raceStartedAt: Date | undefined;

  override onCreate(options: CreateOptions): void {
    const mode = MODES.includes(options.mode as RoomMode) ? (options.mode as RoomMode) : 'casual';
    this.mode = mode;
    const players = Object.keys(options.tickets ?? {}).length;
    const services = getServices();
    const fromQueue = services !== null && options.serverKey === services.serverKey && players > 0;
    // Sala ranqueada sÃ³ nasce da fila do prÃ³prio servidor; bilhetes de fora nÃ£o valem nada.
    if (mode === 'ranked' && !fromQueue) {
      throw new Error('Sala ranqueada sÃ³ pode ser criada pela fila.');
    }
    if (fromQueue && mode !== 'private') {
      this.queued = true;
      this.tickets = new Map(Object.entries(options.tickets ?? {}));
      this.maxClients = players;
      const wait = mode === 'ranked' ? RANKED_WAIT_SECONDS : CASUAL_WAIT_SECONDS;
      this.setSeatReservationTime(wait);
      void this.setPrivate(true);
      this.clock.setTimeout(() => this.session.relaxMinPlayers(), wait * 1000);
    }
    // Sala privada nÃ£o aparece no matchmaking: sÃ³ entra quem tem o cÃ³digo.
    if (mode === 'private') void this.setPrivate(true);
    this.session = new RaceSession(getCircuitoDaOrla(), {
      mode,
      code: this.roomId,
      seed: Math.floor(Math.random() * 2 ** 31),
      minPlayers: this.queued ? players : 1,
      ...(this.queued && typeof options.botSkill === 'number'
        ? { botSkill: Math.min(1, Math.max(0, options.botSkill)) }
        : {}),
      // Quem veio da fila jÃ¡ esperou: o lobby Ã© sÃ³ o tempo de todos carregarem.
      ...(this.queued && mode === 'casual' ? { lobbySeconds: 6 } : {}),
    });

    this.onMessage(MESSAGES.input, (client, message: unknown) => {
      this.session.pushInput(client.sessionId, message);
    });
    this.onMessage(MESSAGES.ready, (client, message: { ready?: unknown }) => {
      this.session.setReady(client.sessionId, message?.ready === true);
      this.broadcastRoom();
    });
    this.onMessage(MESSAGES.ping, (client, message: PingMessage) => {
      client.send(MESSAGES.pong, { t: Number(message?.t) || 0 });
    });

    this.setSimulationInterval((deltaMs) => this.update(deltaMs / 1000), 1000 / SIM_HZ);
    this.clock.setInterval(() => this.sendSnapshots(), 1000 / NET_TICK_HZ);
    console.log(`[sala ${this.roomId}] criada (${mode})`);
  }

  /**
   * Quem Ã© este jogador. Com conta, nome e cosmÃ©ticos vÃªm do banco (o cliente
   * nÃ£o escolhe o que nÃ£o possui). No Ranqueado sÃ³ entra quem tem bilhete da fila.
   */
  override async onAuth(_client: Client, options: AuthOptions): Promise<PlayerIdentity | true> {
    const services = getServices();
    if (this.queued) {
      const userId = this.tickets.get(String(options?.ticket));
      const player = userId ? await services?.accounts.player(userId) : null;
      if (!player) throw new Error('Bilhete de partida invÃ¡lido.');
      this.tickets.delete(String(options.ticket));
      return player;
    }
    // Sem conta nÃ£o se joga online: nÃ£o existe mais jogador anÃ´nimo nem convidado.
    const userId = options?.token ? services?.accounts.userIdOf(options.token) : null;
    const player = userId ? await services?.accounts.player(userId) : null;
    if (!player) throw new Error('Entre na sua conta para correr online.');
    if (player.guest) throw new Error('Conclua o cadastro da sua conta para correr online.');
    return player;
  }

  override onJoin(
    client: Client,
    options: Partial<JoinOptions>,
    auth?: PlayerIdentity | true,
  ): void {
    const account = typeof auth === 'object' ? auth : null;
    const slot = this.session.addPlayer(
      client.sessionId,
      account?.name ?? sanitizeName(options.name),
      account?.cosmetics ?? sanitizeCosmetics(options.cosmetics),
      account?.userId ?? null,
      account ? account.paint : sanitizeCustomPaint(options.paint),
    );
    if (slot < 0) {
      client.leave(4000, 'Sala cheia ou corrida em andamento');
      return;
    }
    this.sentPaints = '';
    this.broadcastRoom();
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const racing = this.session.phase !== 'lobby';
    if (!consented && racing) {
      // Queda de conexÃ£o no meio da prova: a vaga fica guardada por 30 s.
      this.session.setConnected(client.sessionId, false);
      this.broadcastRoom();
      try {
        await this.allowReconnection(client, RECONNECT_SECONDS);
        this.session.setConnected(client.sessionId, true);
        this.sentPaints = '';
        this.broadcastRoom();
        return;
      } catch {
        // NÃ£o voltou a tempo.
      }
    }
    this.session.removePlayer(client.sessionId);
    this.broadcastRoom();
  }

  private update(deltaSeconds: number): void {
    this.session.update(deltaSeconds);
    for (const id of this.session.kicked.splice(0)) {
      this.clients.find((client) => client.sessionId === id)?.leave(4001, 'Excesso de mensagens');
    }

    const phase = this.session.phase;
    const secondsLeft = this.clients[0]
      ? this.session.roomMessage(this.clients[0].sessionId).secondsLeft
      : null;
    if (phase !== this.lastPhase) {
      // Com a corrida rolando ninguÃ©m novo entra; no lobby a sala reabre.
      if (phase === 'results') this.saveMatch();
      // Partida ranqueada Ã© Ãºnica: acabou o pÃ³dio, todos voltam para a fila.
      if (phase === 'lobby' && this.queued) void this.disconnect();
      else if (phase === 'lobby') void this.unlock();
      else if (this.lastPhase === 'lobby') {
        this.raceStartedAt = new Date();
        void this.lock();
      }
      this.lastPhase = phase;
      this.sendSnapshots();
      this.broadcastRoom();
    } else if (secondsLeft !== this.lastSecondsLeft) {
      this.broadcastRoom();
    }
    this.lastSecondsLeft = secondsLeft;
  }

  /** Grava a partida no banco. O resultado vem da simulaÃ§Ã£o; o cliente nÃ£o participa. */
  private saveMatch(): void {
    const services = getServices();
    const report = this.session.report;
    this.session.report = null;
    if (!services || !report) return;
    recordMatch(services.prisma, services.accounts, {
      mode: this.mode,
      track: 'circuito-da-orla',
      laps: this.session.laps,
      report,
      roomId: this.roomId,
      matched: this.queued,
      ...(this.raceStartedAt ? { startedAt: this.raceStartedAt } : {}),
    }).catch((error: unknown) =>
      console.error(`[sala ${this.roomId}] erro ao gravar partida`, error),
    );
  }

  private broadcastRoom(): void {
    // As pinturas vão antes da sala, e só quando mudam (ou alguém acabou de entrar).
    const paints = this.session.paints();
    const key = JSON.stringify(paints);
    if (key !== this.sentPaints) {
      this.sentPaints = key;
      this.broadcast(MESSAGES.paints, { paints } satisfies PaintsMessage);
    }
    for (const client of this.clients) {
      client.send(MESSAGES.room, this.session.roomMessage(client.sessionId));
    }
  }

  private sendSnapshots(): void {
    if (this.session.phase !== 'race') return;
    for (const client of this.clients) {
      const snapshot = this.session.snapshot(client.sessionId);
      if (snapshot) client.send(MESSAGES.snapshot, snapshot);
    }
  }
}
