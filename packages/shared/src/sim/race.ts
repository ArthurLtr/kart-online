import { SIM_DT } from '../constants.js';
import type { Track } from '../track/track.js';
import { frameAt, pointAt, wrapS } from '../track/track.js';
import { resolveKartCollisions } from './collisions.js';
import { step } from './step.js';
import { RACE_RULES as R } from './tuning.js';
import type { KartInput, KartState, SimEnvironment } from './types.js';
import { createKartState, NO_INPUT, speedOf } from './types.js';

export type RacePhase = 'countdown' | 'racing' | 'finished';

/** Andamento de um kart na corrida. Tempos em ticks de 1/60 s. */
export interface RacerProgress {
  /** 0 antes de cruzar a linha pela primeira vez; depois, a volta em andamento. */
  lap: number;
  /** Próximo checkpoint que precisa ser cruzado, em ordem. */
  nextCheckpoint: number;
  lapStartTick: number;
  lastLapTicks: number | null;
  bestLapTicks: number | null;
  /** Tick em que completou a última volta da corrida. */
  finishTick: number | null;
  jumpStart: boolean;
  penaltyTicks: number;
  offTrackTicks: number;
  stuckTicks: number;
  /** Quantas vezes foi reposicionado. */
  resets: number;
}

export interface RaceState {
  tick: number;
  /** Tick em que as luzes apagam. */
  goTick: number;
  /** Voltas da corrida; 0 = treino livre, sem fim. */
  laps: number;
  phase: RacePhase;
  karts: readonly KartState[];
  progress: readonly RacerProgress[];
}

export interface RaceOptions {
  karts: number;
  laps: number;
  /** Sorteia quanto tempo as 5 luzes ficam acesas antes de apagar. */
  seed: number;
}

/** PRNG pequeno e determinístico (mulberry32). */
function random(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createRace(track: Track, options: RaceOptions): RaceState {
  const karts: KartState[] = [];
  const progress: RacerProgress[] = [];
  const hold =
    R.holdMinTicks + Math.floor(random(options.seed) * (R.holdMaxTicks - R.holdMinTicks));
  const goTick = R.ticksPerLight * R.lights + hold;
  for (let i = 0; i < options.karts; i++) {
    const slot = track.grid[i];
    if (!slot) throw new Error(`o grid só tem ${track.grid.length} posições`);
    karts.push({
      ...createKartState(slot.x, slot.z, slot.heading, slot.y),
      s: slot.s,
      d: slot.d,
    });
    progress.push({
      lap: 0,
      nextCheckpoint: 0,
      lapStartTick: goTick,
      lastLapTicks: null,
      bestLapTicks: null,
      finishTick: null,
      jumpStart: false,
      penaltyTicks: 0,
      offTrackTicks: 0,
      stuckTicks: 0,
      resets: 0,
    });
  }
  return { tick: 0, goTick, laps: options.laps, phase: 'countdown', karts, progress };
}

/** Quantas luzes do semáforo estão acesas (0 depois da largada). */
export function startLights(race: Pick<RaceState, 'tick' | 'goTick'>): number {
  if (race.tick >= race.goTick) return 0;
  return Math.min(R.lights, Math.floor(race.tick / R.ticksPerLight));
}

/** Avanço ao longo da pista entre dois ticks, pelo caminho mais curto (negativo = para trás). */
function travelled(track: Track, from: number, to: number): number {
  let delta = to - from;
  if (delta > track.length / 2) delta -= track.length;
  else if (delta < -track.length / 2) delta += track.length;
  return delta;
}

/**
 * Validação de volta: os checkpoints têm de ser cruzados em ordem e para a
 * frente. Pular um (atalho, teleporte) trava a contagem até ele ser cruzado.
 */
export function advanceProgress(
  progress: RacerProgress,
  track: Track,
  previousS: number,
  currentS: number,
  tick: number,
  laps: number,
): RacerProgress {
  if (progress.finishTick !== null) return progress;
  const delta = travelled(track, previousS, currentS);
  // Só conta avanço para a frente e contínuo: um salto grande não é cruzar o checkpoint.
  if (delta <= 0 || delta > 30) return progress;

  const checkpoint = track.checkpoints[progress.nextCheckpoint];
  if (!checkpoint) return progress;
  const ahead = wrapS(track, checkpoint.s - previousS);
  if (ahead === 0 || ahead > delta) return progress;

  const next = { ...progress };
  next.nextCheckpoint = (progress.nextCheckpoint + 1) % track.checkpoints.length;
  if (checkpoint.index !== 0) return next;

  // Cruzou a linha de chegada com todos os checkpoints da volta em ordem.
  if (progress.lap > 0) {
    const lapTicks = tick - progress.lapStartTick;
    next.lastLapTicks = lapTicks;
    next.bestLapTicks =
      progress.bestLapTicks === null ? lapTicks : Math.min(progress.bestLapTicks, lapTicks);
    next.lapStartTick = tick;
    if (laps > 0 && progress.lap >= laps) {
      next.finishTick = tick;
      return next;
    }
  }
  next.lap = progress.lap + 1;
  return next;
}

/** Coloca o kart parado no meio da pista, apontando para a frente. */
function reposition(kart: KartState, track: Track): KartState {
  const frame = frameAt(track, kart.s);
  const point = pointAt(track, kart.s, 0);
  return {
    ...createKartState(point.x, point.z, Math.atan2(frame.fx, frame.fz), point.y),
    s: kart.s,
    d: 0,
    trackIndex: kart.trackIndex,
    tireTemp: kart.tireTemp,
  };
}

/**
 * Avança a corrida inteira em um tick: semáforo, queima de largada, física de
 * cada kart, colisões, voltas e reposicionamento. Pura e determinística; é a
 * mesma função no Treino solo, nos bots e no servidor.
 */
export function stepRace(
  race: RaceState,
  inputs: readonly KartInput[],
  track: Track,
  environment: SimEnvironment,
): RaceState {
  const tick = race.tick + 1;
  const racing = tick > race.goTick;

  if (!racing) {
    // Luzes acesas: karts parados. Quem acelerar antes da hora leva a punição.
    const progress = race.progress.map((p, i) => {
      const throttle = inputs[i]?.throttle ?? 0;
      if (p.jumpStart || throttle <= R.jumpStartThrottle) return p;
      return { ...p, jumpStart: true, penaltyTicks: p.penaltyTicks + R.jumpStartPenaltyTicks };
    });
    return { ...race, tick, progress };
  }

  let karts = race.karts.map((kart, i) => {
    const finished = race.progress[i]?.finishTick !== null;
    // Quem já terminou solta o acelerador e freia sozinho.
    const input = finished ? { ...NO_INPUT, brake: 0.4 } : (inputs[i] ?? NO_INPUT);
    return step(kart, input, SIM_DT, environment);
  });
  if (karts.length > 1) karts = resolveKartCollisions(karts);

  const progress = race.progress.map((previous, i) => {
    const before = race.karts[i] as KartState;
    const kart = karts[i] as KartState;
    const next = { ...advanceProgress(previous, track, before.s, kart.s, tick, race.laps) };
    if (next.finishTick !== null) return next;

    const input = inputs[i] ?? NO_INPUT;
    const offTrack =
      kart.surface === 'grass' || kart.surface === 'gravel' || kart.surface === 'out';
    next.offTrackTicks = offTrack ? previous.offTrackTicks + 1 : 0;
    const trying = input.throttle > 0.3 || input.brake > 0.3;
    next.stuckTicks = trying && speedOf(kart) < R.stuckSpeed ? previous.stuckTicks + 1 : 0;
    if (next.offTrackTicks >= R.offTrackResetTicks || next.stuckTicks >= R.resetAfterTicks) {
      karts[i] = reposition(kart, track);
      next.offTrackTicks = 0;
      next.stuckTicks = 0;
      next.resets = previous.resets + 1;
    }
    return next;
  });

  const allFinished = race.laps > 0 && progress.every((p) => p.finishTick !== null);
  return { ...race, tick, karts, progress, phase: allFinished ? 'finished' : 'racing' };
}

/** Tempo total de prova de um kart, com punições, em ticks; `null` se não terminou. */
export function raceTimeTicks(race: RaceState, index: number): number | null {
  const progress = race.progress[index];
  if (!progress || progress.finishTick === null) return null;
  return progress.finishTick - race.goTick + progress.penaltyTicks;
}

/**
 * Classificação: quem terminou vem primeiro, pelo tempo com punições; os
 * outros, por voltas e distância na volta. Devolve os índices dos karts.
 */
export function standings(race: RaceState, track: Track): number[] {
  const score = (i: number): number => {
    const time = raceTimeTicks(race, i);
    if (time !== null) return 1e12 - time;
    const progress = race.progress[i] as RacerProgress;
    const kart = race.karts[i] as KartState;
    // Antes de cruzar a linha pela 1ª vez o kart está "atrás" do zero da pista.
    const along = progress.lap === 0 ? kart.s - track.length : kart.s;
    return progress.lap * track.length + along;
  };
  return race.karts.map((_, i) => i).sort((a, b) => score(b) - score(a) || a - b);
}

/** Converte ticks em segundos. */
export const ticksToSeconds = (ticks: number): number => ticks * SIM_DT;
