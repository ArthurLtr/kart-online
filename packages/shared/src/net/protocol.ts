import type { RacePhase, RacerProgress } from '../sim/race.js';
import type { KartInput, KartState } from '../sim/types.js';

/** Nome da sala no servidor Colyseus. */
export const ROOM_NAME = 'race';

export type RoomMode = 'casual' | 'private' | 'ranked';
/** Ciclo da sala: lobby → corrida (contagem + prova) → resultado → pódio → lobby. */
export type RoomPhase = 'lobby' | 'race' | 'results' | 'podium';

/**
 * Cosméticos de um jogador: ids do catálogo do cliente. O servidor só guarda
 * e repassa para os outros clientes desenharem; a simulação nunca os lê.
 */
export type Cosmetics = Record<string, string>;

export interface JoinOptions {
  name: string;
  mode: RoomMode;
  cosmetics?: Cosmetics;
  /** Sessão da conta. Com ela, nome e cosméticos vêm do servidor. */
  token?: string;
}

export interface RosterEntry {
  /** Posição no grid e índice do kart na simulação. */
  slot: number;
  name: string;
  bot: boolean;
  connected: boolean;
  ready: boolean;
  cosmetics: Cosmetics | null;
}

export interface ResultEntry {
  slot: number;
  name: string;
  bot: boolean;
  /** 1 = vencedor. */
  position: number;
  finished: boolean;
  /** Tempo de prova com punições, em ticks; `null` para quem não terminou. */
  timeTicks: number | null;
  bestLapTicks: number | null;
  penaltyTicks: number;
}

/** Servidor → cliente, sempre que a sala muda. */
export interface RoomMessage {
  phase: RoomPhase;
  mode: RoomMode;
  /** Código de convite (id da sala). */
  code: string;
  roster: RosterEntry[];
  /** Vaga deste cliente. */
  you: number;
  /** Segundos até a próxima fase começar sozinha; `null` se está esperando jogadores. */
  secondsLeft: number | null;
  results: ResultEntry[] | null;
}

/** Cliente → servidor, um por tick de simulação. É a única coisa que o cliente manda da corrida. */
export interface InputMessage extends KartInput {
  /** Número de sequência crescente. */
  seq: number;
}

/** Servidor → cliente, 30 vezes por segundo durante a corrida. */
export interface SnapshotMessage {
  tick: number;
  goTick: number;
  laps: number;
  racePhase: RacePhase;
  /** Última entrada deste cliente que o servidor já processou. */
  ack: number;
  /** Estado de todos os karts, indexado pela vaga. */
  karts: KartState[];
  progress: RacerProgress[];
}

export interface PingMessage {
  /** Relógio do cliente, devolvido intacto no pong. */
  t: number;
}

export const MESSAGES = {
  input: 'input',
  ready: 'ready',
  ping: 'ping',
  pong: 'pong',
  room: 'room',
  snapshot: 'snapshot',
} as const;

const finite = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Valida uma entrada vinda da rede: nada de NaN, infinito ou valores fora da faixa. */
export function sanitizeInput(message: unknown): InputMessage | null {
  if (typeof message !== 'object' || message === null) return null;
  const raw = message as Record<string, unknown>;
  const seq = finite(raw.seq);
  if (!Number.isInteger(seq) || seq < 0) return null;
  return {
    seq,
    steer: clamp(finite(raw.steer), -1, 1),
    throttle: clamp(finite(raw.throttle), 0, 1),
    brake: clamp(finite(raw.brake), 0, 1),
    drift: raw.drift === true,
  };
}

/** Limita os cosméticos a um punhado de ids curtos: o servidor não confia no que recebe. */
export function sanitizeCosmetics(value: unknown): Cosmetics {
  const result: Cosmetics = {};
  if (typeof value !== 'object' || value === null) return result;
  for (const [key, id] of Object.entries(value as Record<string, unknown>).slice(0, 16)) {
    if (typeof id === 'string' && /^[\w-]{1,32}$/.test(key) && /^[\w-]{1,32}$/.test(id)) {
      result[key] = id;
    }
  }
  return result;
}

export function sanitizeName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/[^\p{L}\p{N} _.-]/gu, '').trim() : '';
  return name.slice(0, 16) || 'Piloto';
}
