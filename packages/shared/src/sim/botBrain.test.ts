import { describe, expect, it } from 'vitest';
import { getCircuitoDaOrla } from '../track/index.js';
import type { BotDriver, BotPersonality } from './botBrain.js';
import { createBotContext, createBotDriver, driveBot, updateBotContext } from './botBrain.js';
import { createRace, stepRace } from './race.js';
import type { RaceState } from './race.js';
import type { KartInput, KartState } from './types.js';
import { createKartState, createTrackEnvironment, NO_INPUT } from './types.js';

const track = getCircuitoDaOrla();
const environment = createTrackEnvironment(track);
const n = track.samples.length;

const CALM: BotPersonality = {
  aggression: 0.5,
  consistency: 1,
  defense: 1,
  tireCare: 0.5,
  reactionTicks: 6,
  style: 'teste',
};

/** Kart parado na amostra `index`, `d` metros à direita do centro, andando a `speed` m/s. */
function kartAt(index: number, d: number, speed: number): KartState {
  const i = ((index % n) + n) % n;
  const sample = track.samples[i] as (typeof track.samples)[number];
  const heading = Math.atan2(sample.fx, sample.fz);
  return {
    ...createKartState(sample.x + sample.rx * d, sample.z + sample.rz * d, heading, sample.y),
    vx: speed,
    tireTemp: 1,
    s: sample.s,
    d,
    trackIndex: i,
  };
}

/** Corrida em andamento (passada a largada) com os karts dados, todos na volta 1. */
function raceWith(karts: KartState[]): RaceState {
  const base = createRace(track, { karts: karts.length, laps: 3, seed: 7 });
  return {
    ...base,
    tick: base.goTick + 60 * 20,
    phase: 'racing',
    karts,
    progress: base.progress.map((p) => ({ ...p, lap: 1 })),
  };
}

/** Uma amostra numa reta, longe de curvas (mais de 150 m da próxima). */
function straightIndex(): number {
  for (let i = 0; i < n; i++) {
    const far = track.corners.every((corner) => {
      const ahead = (((corner.from - i) % n) + n) % n;
      const inside =
        corner.from <= corner.to
          ? i >= corner.from && i <= corner.to
          : i >= corner.from || i <= corner.to;
      return !inside && ahead * track.step > 150;
    });
    if (far) return i;
  }
  throw new Error('pista sem reta longa');
}

/** Amostra ~70 m antes da entrada de uma curva. */
function beforeCorner(): { index: number; corner: (typeof track.corners)[number] } {
  const corner = track.corners[0] as (typeof track.corners)[number];
  return { index: corner.from - Math.round(70 / track.step), corner };
}

function drive(driver: BotDriver, race: RaceState, ticks: number): KartInput {
  const ctx = createBotContext(race.karts.length);
  let input: KartInput = NO_INPUT;
  for (let t = 0; t < ticks; t++) {
    const now = { ...race, tick: race.tick + t };
    updateBotContext(ctx, now, track);
    input = { ...driveBot(driver, now, track, ctx) };
  }
  return input;
}

describe('bots: percepção', () => {
  it('classifica a corrida pela distância e mede a folga do líder', () => {
    const at = straightIndex();
    const race = raceWith([kartAt(at, 0, 25), kartAt(at + 40, 0, 25), kartAt(at + 10, 2, 25)]);
    const ctx = createBotContext(3);
    updateBotContext(ctx, race, track);
    expect(Array.from(ctx.rank)).toEqual([2, 0, 1]);
    expect(ctx.leaderGap).toBeGreaterThan(25);
    expect(ctx.d[2]).toBeCloseTo(2, 5);
  });
});

describe('bots: estados de corrida', () => {
  it('kart lento logo à frente: persegue ou ataca, e nunca segue reto para a traseira dele', () => {
    const at = straightIndex();
    const race = raceWith([kartAt(at, 0, 26), kartAt(at + Math.round(9 / track.step), 0, 18)]);
    const driver = createBotDriver(track, race, 0, 0.8, { seed: 1, personality: CALM });
    const input = drive(driver, race, 90);
    expect(['perseguindo', 'atacando']).toContain(driver.mode);
    // Com o kart parado à frente (posições fixas no teste), ele precisa aliviar ou desviar.
    expect(input.throttle < 0.5 || Math.abs(input.steer) > 0.02 || input.brake > 0).toBe(true);
  });

  it('alguém emparelhado: vai para lado-a-lado e se afasta dele', () => {
    const at = straightIndex();
    const race = raceWith([kartAt(at, -0.5, 25), kartAt(at, 1.0, 25)]);
    const driver = createBotDriver(track, race, 0, 0.8, { seed: 2, personality: CALM });
    const input = drive(driver, race, 45);
    expect(driver.mode).toBe('lado-a-lado');
    // O outro está à direita (+d): o bot vira para a esquerda (steer positivo na simulação).
    expect(input.steer).toBeGreaterThan(0);
  });

  it('na grama: entra em recuperação', () => {
    const at = straightIndex();
    const grass = { ...kartAt(at, track.halfWidth + 3, 15), surface: 'grass' as const };
    const race = raceWith([grass, kartAt(at + 200, 0, 25)]);
    const driver = createBotDriver(track, race, 0, 0.8, { seed: 3, personality: CALM });
    drive(driver, race, 5);
    expect(driver.mode).toBe('recuperando');
  });
});

describe('bots: defesa com um movimento só', () => {
  it('fecha o lado de dentro uma vez antes da curva e não muda de novo', () => {
    const { index, corner } = beforeCorner();
    const gap = Math.round(7 / track.step);
    // Os dois andam a 24 m/s em direção à curva, o atacante 7 m atrás.
    const at = (t: number, attackerD: number): RaceState => {
      const moved = Math.round((24 * t) / 60 / track.step);
      const race = raceWith([
        kartAt(index + moved, 0, 24),
        kartAt(index - gap + moved, attackerD, 24),
      ]);
      return { ...race, tick: race.tick + t };
    };
    const driver = createBotDriver(track, at(0, 0), 0, 0.8, { seed: 4, personality: CALM });
    const ctx = createBotContext(2);
    for (let t = 0; t < 45; t++) {
      const now = at(t, 0);
      updateBotContext(ctx, now, track);
      driveBot(driver, now, track, ctx);
    }
    expect(driver.mode).toBe('defendendo');
    expect(driver.movedForCorner).toBe(corner.id);
    const firstMove = driver.desired;
    // O atacante troca de lado: o defensor não faz um segundo movimento.
    for (let t = 45; t < 75; t++) {
      const now = at(t, -2.5);
      updateBotContext(ctx, now, track);
      driveBot(driver, now, track, ctx);
    }
    expect(driver.movedForCorner).toBe(corner.id);
    expect(Object.is(driver.desired, firstMove)).toBe(true);
  });
});

/** Corrida curta só de bots; devolve um resumo tick a tick (posições e comandos). */
function botRace(seed: number, ticks: number): { trace: number[]; inputs: KartInput[] } {
  let race = createRace(track, { karts: 4, laps: 1, seed });
  const drivers = [0.4, 0.6, 0.75, 0.9].map((skill, i) =>
    createBotDriver(track, race, i, skill, { seed }),
  );
  const ctx = createBotContext(4);
  const trace: number[] = [];
  const all: KartInput[] = [];
  for (let t = 0; t < ticks; t++) {
    updateBotContext(ctx, race, track);
    const inputs = drivers.map((driver) => ({ ...driveBot(driver, race, track, ctx) }));
    all.push(...inputs);
    race = stepRace(race, inputs, track, environment);
    for (const kart of race.karts) trace.push(kart.x, kart.z, kart.heading);
  }
  return { trace, inputs: all };
}

describe('bots: determinismo e regras', () => {
  it('mesma semente, mesma corrida (tick a tick)', () => {
    const a = botRace(42, 1500);
    const b = botRace(42, 1500);
    expect(b.trace).toEqual(a.trace);
  });

  it('só produz comandos válidos de jogador (nada de força extra)', () => {
    const { inputs } = botRace(9, 1500);
    for (const input of inputs) {
      expect(Number.isFinite(input.steer)).toBe(true);
      expect(input.steer).toBeGreaterThanOrEqual(-1);
      expect(input.steer).toBeLessThanOrEqual(1);
      expect(input.throttle).toBeGreaterThanOrEqual(0);
      expect(input.throttle).toBeLessThanOrEqual(1);
      expect(input.brake).toBeGreaterThanOrEqual(0);
      expect(input.brake).toBeLessThanOrEqual(1);
      expect(typeof input.drift).toBe('boolean');
    }
  });

  it('nunca queima a largada: pedais soltos até o verde', () => {
    const race = createRace(track, { karts: 2, laps: 1, seed: 3 });
    const driver = createBotDriver(track, race, 0, 0.9, { seed: 3 });
    const ctx = createBotContext(2);
    for (let tick = 0; tick < race.goTick; tick += 10) {
      const now = { ...race, tick };
      updateBotContext(ctx, now, track);
      expect(driveBot(driver, now, track, ctx).throttle).toBe(0);
    }
  });

  it('cabe no orçamento: 8 bots custam bem menos de 0,4 ms por tick', () => {
    const at = straightIndex();
    const karts = Array.from({ length: 8 }, (_, i) =>
      kartAt(at + i * Math.round(6 / track.step), (i % 3) - 1, 24),
    );
    const race = raceWith(karts);
    const drivers = karts.map((_, i) => createBotDriver(track, race, i, 0.7, { seed: i }));
    const ctx = createBotContext(8);
    const ticks = 2000;
    const started = performance.now();
    for (let t = 0; t < ticks; t++) {
      const now = { ...race, tick: race.tick + t };
      updateBotContext(ctx, now, track);
      for (const driver of drivers) driveBot(driver, now, track, ctx);
    }
    const perTick = (performance.now() - started) / ticks;
    expect(perTick).toBeLessThan(0.4);
  });
});
