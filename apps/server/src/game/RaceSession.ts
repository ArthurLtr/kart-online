import type {
  BotPlan,
  Cosmetics,
  CustomPaint,
  InputMessage,
  KartInput,
  KartState,
  RaceState,
  ResultEntry,
  RoomMessage,
  RoomMode,
  RoomPhase,
  RosterEntry,
  SimEnvironment,
  SnapshotMessage,
  Track,
} from '@kart/shared';
import {
  botInput,
  createBotPlan,
  createRace,
  createTrackEnvironment,
  frameAt,
  MAX_KARTS,
  NO_INPUT,
  pointAt,
  RACE_LAPS,
  raceTimeTicks,
  sanitizeInput,
  SIM_DT,
  SIM_HZ,
  speedOf,
  standings,
  stepRace,
} from '@kart/shared';

export interface SessionOptions {
  mode: RoomMode;
  /** Código de convite mostrado aos jogadores. */
  code: string;
  seed: number;
  laps?: number;
  /** Tempo de lobby depois que o primeiro jogador entra, s. */
  lobbySeconds?: number;
  resultSeconds?: number;
  podiumSeconds?: number;
  /** Depois que o primeiro termina, quanto os outros ainda têm para chegar, s. */
  finishGraceSeconds?: number;
  /** Humanos necessários para o lobby começar a contar (sala de fila espera todos). */
  minPlayers?: number;
  /** Nível médio dos bots, 0 a 1 (ausente = grid variado, para sala sem pareamento). */
  botSkill?: number;
}

/** O que a sala grava no banco quando a corrida acaba. */
export interface MatchReportEntry extends ResultEntry {
  /** Conta do jogador; `null` para bot ou quem joga sem conta. */
  userId: string | null;
  abandoned: boolean;
  /** Tempo de cada volta completada, em ticks. */
  laps: number[];
  /** Nível do bot, 0 a 1; `null` para humano. */
  botSkill: number | null;
}

interface Seat {
  id: string;
  name: string;
  bot: boolean;
  connected: boolean;
  ready: boolean;
  cosmetics: Cosmetics | null;
  paint: CustomPaint | null;
  queue: InputMessage[];
  lastInput: KartInput;
  /** Ticks seguidos sem entrada nova. */
  starved: number;
  ack: number;
  /** Limite de taxa (balde de fichas). */
  tokens: number;
  violations: number;
  plan: BotPlan | null;
  userId: string | null;
  laps: number[];
}

const BOT_NAMES = [
  'Faísca',
  'Maresia',
  'Brita',
  'Zebra',
  'Ventania',
  'Grampo',
  'Borracha',
  'Pista',
];
const MAX_QUEUE = 8;
/** Sem entrada nova por este tempo, o kart para de repetir a última e solta os pedais. */
const HOLD_TICKS = 15;
const RATE_PER_SECOND = 80;
const RATE_BURST = 24;
const KICK_AFTER_VIOLATIONS = 600;
/** Nada no jogo passa de ~31 m/s; acima disto o estado está corrompido. */
const IMPOSSIBLE_SPEED = 45;

/**
 * Uma sala de corrida, sem nada de rede: quem entra, o ciclo
 * lobby → corrida → resultado → pódio → lobby, as filas de entrada e a
 * simulação autoritativa. A sala Colyseus só repassa mensagens para cá, e os
 * testes rodam isto direto.
 *
 * Os cosméticos ficam guardados no assento só para serem repassados aos
 * clientes; nenhuma linha da simulação os lê.
 */
export class RaceSession {
  phase: RoomPhase = 'lobby';
  race: RaceState | null = null;
  results: ResultEntry[] | null = null;
  /** Resultado completo da última corrida, para o banco; a sala consome e zera. */
  report: MatchReportEntry[] | null = null;
  /** Jogadores a expulsar por abuso; a sala esvazia esta lista. */
  readonly kicked: string[] = [];

  private seats: Seat[] = [];
  private readonly environment: SimEnvironment;
  private readonly options: Required<Omit<SessionOptions, 'botSkill'>> &
    Pick<SessionOptions, 'botSkill'>;
  private accumulator = 0;
  private phaseSeconds = 0;
  private firstFinishTick: number | null = null;
  private raceCount = 0;

  constructor(
    private readonly track: Track,
    options: SessionOptions,
  ) {
    this.environment = createTrackEnvironment(track);
    this.options = {
      laps: RACE_LAPS,
      lobbySeconds: 12,
      resultSeconds: 8,
      podiumSeconds: 10,
      finishGraceSeconds: 45,
      minPlayers: 1,
      ...options,
    };
  }

  get laps(): number {
    return this.options.laps;
  }

  /** Quem a fila escolheu não apareceu a tempo: a corrida sai com quem está. */
  relaxMinPlayers(): void {
    this.options.minPlayers = 1;
  }

  get humans(): number {
    return this.seats.filter((seat) => !seat.bot).length;
  }

  /** Vaga do jogador, ou -1. */
  slotOf(id: string): number {
    return this.seats.findIndex((seat) => seat.id === id);
  }

  /** Entra no lobby. Devolve a vaga, ou -1 se a sala está cheia ou em corrida. */
  addPlayer(
    id: string,
    name: string,
    cosmetics: Cosmetics,
    userId: string | null = null,
    paint: CustomPaint | null = null,
  ): number {
    if (this.phase !== 'lobby' || this.seats.length >= MAX_KARTS) return -1;
    this.seats.push({
      id,
      name,
      bot: false,
      connected: true,
      ready: false,
      cosmetics,
      paint,
      queue: [],
      lastInput: NO_INPUT,
      starved: 0,
      ack: -1,
      tokens: RATE_BURST,
      violations: 0,
      plan: null,
      userId,
      laps: [],
    });
    return this.seats.length - 1;
  }

  /**
   * Sai da sala. No lobby a vaga some; durante a corrida o kart fica na pista
   * sem piloto (as vagas são os índices da simulação e não podem mudar).
   */
  removePlayer(id: string): void {
    const slot = this.slotOf(id);
    if (slot < 0) return;
    if (this.phase === 'lobby') this.seats.splice(slot, 1);
    else {
      const seat = this.seats[slot] as Seat;
      seat.connected = false;
      seat.id = `saiu:${id}`;
    }
  }

  setConnected(id: string, connected: boolean): void {
    const seat = this.seats[this.slotOf(id)];
    if (seat) seat.connected = connected;
  }

  setReady(id: string, ready: boolean): void {
    const seat = this.seats[this.slotOf(id)];
    if (seat && this.phase === 'lobby') seat.ready = ready;
  }

  /** Recebe uma entrada da rede: valida, aplica o limite de taxa e enfileira. */
  pushInput(id: string, message: unknown): void {
    const seat = this.seats[this.slotOf(id)];
    if (!seat || seat.bot) return;
    if (seat.tokens < 1) {
      seat.violations++;
      if (seat.violations === KICK_AFTER_VIOLATIONS) this.kicked.push(id);
      return;
    }
    seat.tokens -= 1;
    const input = sanitizeInput(message);
    // Entrada repetida ou fora de ordem não entra na fila.
    const newest = seat.queue[seat.queue.length - 1]?.seq ?? seat.ack;
    if (!input || input.seq <= newest) return;
    seat.queue.push(input);
    if (seat.queue.length > MAX_QUEUE) seat.queue.shift();
  }

  /** Avança o tempo real. A simulação anda em ticks fixos de 1/60 s. */
  update(deltaSeconds: number): void {
    this.accumulator = Math.min(this.accumulator + deltaSeconds, 0.25);
    while (this.accumulator >= SIM_DT) {
      this.tick();
      this.accumulator -= SIM_DT;
    }
  }

  /** Um tick de 1/60 s. */
  tick(): void {
    for (const seat of this.seats) {
      seat.tokens = Math.min(RATE_BURST, seat.tokens + RATE_PER_SECOND * SIM_DT);
    }
    this.phaseSeconds += SIM_DT;

    if (this.phase === 'lobby') {
      if (this.humans < this.options.minPlayers) {
        this.phaseSeconds = 0;
        return;
      }
      const everyoneReady = this.seats.every((seat) => seat.ready);
      if (everyoneReady || this.phaseSeconds >= this.options.lobbySeconds) this.startRace();
    } else if (this.phase === 'race') {
      this.tickRace();
    } else if (this.phase === 'results') {
      if (this.phaseSeconds >= this.options.resultSeconds) this.enter('podium');
    } else if (this.phaseSeconds >= this.options.podiumSeconds) {
      this.backToLobby();
    }
  }

  private enter(phase: RoomPhase): void {
    this.phase = phase;
    this.phaseSeconds = 0;
  }

  private startRace(): void {
    // No Casual os bots completam o grid; nas outras salas correm só os humanos.
    if (this.options.mode === 'casual') {
      for (let i = 0; this.seats.length < MAX_KARTS; i++) {
        // Variação determinística entre os bots, para o grid não andar em bloco.
        const spread = ((i * 37 + this.raceCount * 11) % 60) / 100;
        const level = this.options.botSkill;
        // Com pareamento, os bots ficam em volta do nível do grupo (±0,12).
        const skill =
          level === undefined
            ? 0.35 + spread
            : Math.min(1, Math.max(0, level + (spread - 0.3) * 0.4));
        this.seats.push({
          id: `bot:${i}`,
          name: BOT_NAMES[i % BOT_NAMES.length] as string,
          bot: true,
          connected: true,
          ready: true,
          cosmetics: null,
          paint: null,
          queue: [],
          lastInput: NO_INPUT,
          starved: 0,
          ack: -1,
          tokens: 0,
          violations: 0,
          plan: createBotPlan(this.track, skill),
          userId: null,
          laps: [],
        });
      }
    }
    for (const seat of this.seats) {
      seat.queue = [];
      seat.lastInput = NO_INPUT;
      seat.starved = 0;
      seat.laps = [];
    }
    this.race = createRace(this.track, {
      karts: this.seats.length,
      laps: this.options.laps,
      seed: this.options.seed + this.raceCount,
    });
    this.raceCount++;
    this.firstFinishTick = null;
    this.results = null;
    this.enter('race');
  }

  private inputFor(seat: Seat, kart: KartState, race: RaceState): KartInput {
    if (seat.bot && seat.plan) {
      return race.tick < race.goTick ? NO_INPUT : botInput(kart, this.track, seat.plan);
    }
    const next = seat.queue.shift();
    if (next) {
      seat.ack = next.seq;
      seat.lastInput = next;
      seat.starved = 0;
      return next;
    }
    // Rede atrasou: repete a última entrada por um instante, depois solta os pedais.
    seat.starved++;
    if (!seat.connected || seat.starved > HOLD_TICKS) return NO_INPUT;
    return seat.lastInput;
  }

  private tickRace(): void {
    const race = this.race;
    if (!race) return;
    const inputs = this.seats.map((seat, i) =>
      this.inputFor(seat, race.karts[i] as KartState, race),
    );
    let next = stepRace(race, inputs, this.track, this.environment);
    next = this.guard(next);
    this.race = next;
    this.seats.forEach((seat, i) => {
      const now = next.progress[i];
      const before = race.progress[i];
      if (!now || !before || now.lastLapTicks === null) return;
      // Fechou uma volta: começou outra, ou cruzou a linha pela última vez.
      const closedLap =
        now.lapStartTick !== before.lapStartTick ||
        (now.finishTick !== null && before.finishTick === null);
      if (closedLap) seat.laps.push(now.lastLapTicks);
    });

    if (this.firstFinishTick === null && next.progress.some((p) => p.finishTick !== null)) {
      this.firstFinishTick = next.tick;
    }
    const humansDone = this.seats.every(
      (seat, i) => seat.bot || !seat.connected || next.progress[i]?.finishTick != null,
    );
    const graceOver =
      this.firstFinishTick !== null &&
      next.tick - this.firstFinishTick >= this.options.finishGraceSeconds * SIM_HZ;
    if (next.phase === 'finished' || humansDone || graceOver) this.finishRace(next);
  }

  /** Rede de segurança: estado impossível (NaN, velocidade absurda) volta para o meio da pista. */
  private guard(race: RaceState): RaceState {
    let karts: KartState[] | null = null;
    race.karts.forEach((kart, i) => {
      const sane =
        Number.isFinite(kart.x) &&
        Number.isFinite(kart.z) &&
        Number.isFinite(kart.heading) &&
        speedOf(kart) < IMPOSSIBLE_SPEED;
      if (sane) return;
      const previous = this.race?.karts[i] as KartState;
      const frame = frameAt(this.track, previous.s);
      const point = pointAt(this.track, previous.s, 0);
      karts ??= [...race.karts];
      karts[i] = {
        ...previous,
        x: point.x,
        y: point.y,
        z: point.z,
        heading: Math.atan2(frame.fx, frame.fz),
        vx: 0,
        vy: 0,
        yawRate: 0,
        d: 0,
      };
      console.warn(`[sessão ${this.options.code}] estado impossível no kart ${i}; reposicionado`);
    });
    return karts ? { ...race, karts } : race;
  }

  /** A classificação sai só da simulação do servidor; o cliente nunca informa resultado. */
  private finishRace(race: RaceState): void {
    const ranked = this.options.mode === 'ranked';
    const gone = (slot: number): boolean => (this.seats[slot] as Seat).id.startsWith('saiu:');
    let order = standings(race, this.track);
    // No Ranqueado, quem abandonou fica em último, não importa onde estava.
    if (ranked) order = [...order.filter((slot) => !gone(slot)), ...order.filter(gone)];
    this.report = order.map((slot, i) => {
      const seat = this.seats[slot] as Seat;
      const progress = race.progress[slot];
      const dropped = ranked && gone(slot);
      return {
        userId: seat.userId,
        abandoned: gone(slot),
        laps: [...seat.laps],
        botSkill: seat.bot ? (seat.plan?.skill ?? null) : null,
        slot,
        name: seat.name,
        bot: seat.bot,
        position: i + 1,
        finished: !dropped && progress?.finishTick != null,
        timeTicks: dropped ? null : raceTimeTicks(race, slot),
        bestLapTicks: progress?.bestLapTicks ?? null,
        penaltyTicks: progress?.penaltyTicks ?? 0,
      };
    });
    this.results = this.report.map((entry) => ({
      slot: entry.slot,
      name: entry.name,
      bot: entry.bot,
      position: entry.position,
      finished: entry.finished,
      timeTicks: entry.timeTicks,
      bestLapTicks: entry.bestLapTicks,
      penaltyTicks: entry.penaltyTicks,
    }));
    this.enter('results');
  }

  private backToLobby(): void {
    // Saem os bots e quem abandonou; os humanos continuam para a próxima.
    this.seats = this.seats.filter((seat) => !seat.bot && !seat.id.startsWith('saiu:'));
    for (const seat of this.seats) seat.ready = false;
    this.race = null;
    this.results = null;
    this.enter('lobby');
  }

  roster(): RosterEntry[] {
    return this.seats.map((seat, slot) => ({
      slot,
      name: seat.name,
      bot: seat.bot,
      connected: seat.connected,
      ready: seat.ready,
      cosmetics: seat.cosmetics,
    }));
  }

  /** Pintura livre de cada vaga (cosmético: a simulação nunca lê). */
  paints(): (CustomPaint | null)[] {
    return this.seats.map((seat) => seat.paint);
  }

  roomMessage(id: string): RoomMessage {
    const limits: Record<RoomPhase, number | null> = {
      lobby: this.humans > 0 ? this.options.lobbySeconds : null,
      race: null,
      results: this.options.resultSeconds,
      podium: this.options.podiumSeconds,
    };
    const limit = limits[this.phase];
    return {
      phase: this.phase,
      mode: this.options.mode,
      code: this.options.code,
      roster: this.roster(),
      you: this.slotOf(id),
      secondsLeft: limit === null ? null : Math.max(0, Math.ceil(limit - this.phaseSeconds)),
      results: this.results,
    };
  }

  /** Snapshot para um cliente; só o `ack` muda de um cliente para outro. */
  snapshot(id: string): SnapshotMessage | null {
    const race = this.race;
    if (!race) return null;
    return {
      tick: race.tick,
      goTick: race.goTick,
      laps: race.laps,
      racePhase: race.phase,
      ack: this.seats[this.slotOf(id)]?.ack ?? -1,
      karts: race.karts as KartState[],
      progress: race.progress as SnapshotMessage['progress'],
    };
  }
}
