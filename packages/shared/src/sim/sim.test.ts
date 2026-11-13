import { describe, expect, it } from 'vitest';
import { SIM_DT, SIM_HZ } from '../constants.js';
import { getCircuitoDaOrla } from '../track/index.js';
import {
  advanceProgress,
  applyAssists,
  botInput,
  createBotPlan,
  createKartState,
  createRace,
  createTrackEnvironment,
  KEYBOARD_ASSISTS,
  NO_INPUT,
  RACE_RULES,
  raceTimeTicks,
  resolveKartCollisions,
  speedOf,
  standings,
  startLights,
  step,
  stepRace,
  TUNING,
} from './index.js';
import type { KartInput, KartState, RaceState } from './index.js';

const KMH = 3.6;
const track = getCircuitoDaOrla();
const environment = createTrackEnvironment(track);

/** Kart com pneus na temperatura, andando em linha reta no plano. */
function rolling(speed: number): KartState {
  return { ...createKartState(0, 0, 0), vx: speed, tireTemp: 1 };
}

function simulate(
  start: KartState,
  input: KartInput | ((state: KartState, tick: number) => KartInput),
  seconds: number,
): { final: KartState; maxSpeed: number; distance: number } {
  let state = start;
  let maxSpeed = speedOf(state);
  let distance = 0;
  for (let tick = 0; tick < seconds * SIM_HZ; tick++) {
    const next = step(state, typeof input === 'function' ? input(state, tick) : input, SIM_DT);
    distance += Math.hypot(next.x - state.x, next.z - state.z);
    state = next;
    maxSpeed = Math.max(maxSpeed, speedOf(state));
  }
  return { final: state, maxSpeed, distance };
}

const FULL: KartInput = { steer: 0, throttle: 1, brake: 0, drift: false };

describe('física do kart', () => {
  it('é determinística e não altera o estado recebido', () => {
    const start = Object.freeze(rolling(15));
    const input = Object.freeze({ steer: 0.4, throttle: 0.8, brake: 0, drift: true });
    const a = step(start, input, SIM_DT);
    const b = step(start, input, SIM_DT);
    expect(a).toEqual(b);
    expect(a).not.toBe(start);
    expect(start.vx).toBe(15);

    // Sequência longa repetida: o mesmo resultado, campo a campo.
    const drive = (_: KartState, tick: number): KartInput => ({
      steer: Math.sin(tick * 0.05) * 0.6,
      throttle: tick % 90 < 70 ? 1 : 0,
      brake: tick % 90 >= 80 ? 1 : 0,
      drift: tick % 200 > 150,
    });
    expect(simulate(start, drive, 20).final).toEqual(simulate(start, drive, 20).final);
  });

  it('chega a ~110 km/h de velocidade máxima', () => {
    const { final } = simulate(rolling(20), FULL, 40);
    expect(final.vx * KMH).toBeGreaterThan(105);
    expect(final.vx * KMH).toBeLessThan(114);
    expect(final.rpm).toBeLessThanOrEqual(TUNING.maxRpm);
  });

  it('acelera de 0 a 100 km/h num tempo de kart de competição', () => {
    let state = { ...createKartState(0, 0, 0), tireTemp: 1 };
    let ticks = 0;
    while (state.vx * KMH < 100 && ticks < 30 * SIM_HZ) {
      state = step(state, FULL, SIM_DT);
      ticks++;
    }
    expect(ticks / SIM_HZ).toBeGreaterThan(4);
    expect(ticks / SIM_HZ).toBeLessThan(9);
  });

  it('freia de 100 km/h até parar em distância realista, só com o eixo traseiro', () => {
    const { final, distance } = simulate(rolling(100 / KMH), { ...NO_INPUT, brake: 0.75 }, 8);
    expect(final.vx).toBeLessThan(0.5);
    expect(distance).toBeGreaterThan(40);
    expect(distance).toBeLessThan(110);
  });

  it('drift não aumenta a velocidade: em reta e em curva ele só perde', () => {
    const start = rolling(80 / KMH);
    for (const steer of [0, 0.25, 0.5, 0.9]) {
      const grip = simulate(start, { steer, throttle: 1, brake: 0, drift: false }, 6);
      const drift = simulate(start, { steer, throttle: 1, brake: 0, drift: true }, 6);
      expect(drift.maxSpeed).toBeLessThanOrEqual(grip.maxSpeed + 1e-6);
      expect(speedOf(drift.final)).toBeLessThanOrEqual(speedOf(grip.final) + 1e-6);
      expect(drift.distance).toBeLessThanOrEqual(grip.distance + 1e-6);
    }
    // Apertar e soltar o botão (o gesto do "mini-turbo" dos arcades) também não rende nada.
    const pumping = simulate(
      start,
      (_, tick) => ({ steer: 0.5, throttle: 1, brake: 0, drift: tick % 60 < 40 }),
      10,
    );
    const steady = simulate(start, { steer: 0.5, throttle: 1, brake: 0, drift: false }, 10);
    expect(pumping.maxSpeed).toBeLessThanOrEqual(steady.maxSpeed + 1e-6);
    expect(speedOf(pumping.final)).toBeLessThanOrEqual(speedOf(steady.final) + 1e-6);

    // Nada no jogo passa da velocidade máxima do motor.
    const top = simulate(rolling(20), FULL, 40).final.vx;
    expect(simulate(rolling(top), { ...FULL, drift: true }, 10).maxSpeed).toBeLessThanOrEqual(
      top + 0.05,
    );
  });

  it('aliviar o acelerador numa curva rápida não roda o kart', () => {
    const fast = simulate(
      rolling(100 / KMH),
      { steer: 0.1, throttle: 1, brake: 0, drift: false },
      2,
    );
    let worst = 0;
    const lifted = simulate(
      fast.final,
      (state) => {
        worst = Math.max(worst, state.rearSlide);
        return { steer: 0.1, throttle: 0, brake: 0, drift: false };
      },
      3,
    );
    expect(worst).toBeLessThan(0.5);
    expect(lifted.final.vx).toBeGreaterThan(15);
  });

  it('o botão de drift solta a traseira', () => {
    const start = rolling(60 / KMH);
    const turn = { steer: 0.55, throttle: 0.6, brake: 0 };
    const grip = simulate(start, { ...turn, drift: false }, 1.5).final;
    const drift = simulate(start, { ...turn, drift: true }, 1.5).final;
    expect(drift.rearSlide).toBeGreaterThan(grip.rearSlide);
    expect(Math.abs(drift.vy)).toBeGreaterThan(Math.abs(grip.vy));
  });

  it('na largada, o pneu frio aguenta o acelerador no fundo, sem impulso extra', () => {
    const grid = createKartState(0, 0, 0); // pneus frios, como no grid
    let spun = 0;
    const full = simulate(
      grid,
      (state) => {
        spun = Math.max(spun, state.wheelSlip);
        return FULL;
      },
      2.5,
    );
    const dosed = simulate(grid, { ...FULL, throttle: 0.9 }, 2.5);
    // Largar é simples: pé no fundo não patina e é a melhor saída.
    expect(spun).toBeLessThan(0.2);
    expect(full.distance).toBeGreaterThan(dosed.distance);
    // Não existe impulso de largada: ninguém sai mais rápido do que o motor permite.
    const peakForce =
      (24 * TUNING.gearRatio * TUNING.drivetrainEfficiency) / TUNING.wheelRadius / TUNING.mass;
    expect(full.final.vx).toBeLessThan(peakForce * 2.5);
  });

  it('fora do asfalto o kart perde velocidade', () => {
    const start = pointOnTrack(60, 10); // grama, ao lado da reta principal
    const coasting = { ...start, vx: 20, tireTemp: 1 };
    let state = coasting;
    for (let i = 0; i < SIM_HZ; i++) state = step(state, FULL, SIM_DT, environment);
    expect(state.surface).toBe('grass');
    expect(state.vx).toBeLessThan(20);
  });

  it('bate no guard-rail, desliza ao longo dele e não atravessa', () => {
    // Vindo na reta principal apontado ~30° para a parede da direita.
    const start = pointOnTrack(60, 12);
    let state: KartState = { ...start, heading: start.heading - 0.5, vx: 22, tireTemp: 1 };
    let impact = 0;
    for (let i = 0; i < SIM_HZ * 2; i++) {
      state = step(state, NO_INPUT, SIM_DT, environment);
      impact = Math.max(impact, state.impact);
      expect(Math.abs(state.d)).toBeLessThanOrEqual(16 - TUNING.wallMinGap + 1e-6);
    }
    expect(impact).toBeGreaterThan(3);
    expect(state.s).toBeGreaterThan(70); // continuou andando para a frente
    expect(speedOf(state)).toBeGreaterThan(3);
  });
});

describe('parede com o contorno do kart (Rapier)', () => {
  it('raspando de lado, o kart fica a meia largura do trilho, não só o eixo', () => {
    const start = pointOnTrack(60, 13);
    let state: KartState = { ...start, heading: start.heading - 0.12, vx: 18, tireTemp: 1 };
    let closest = 0;
    for (let i = 0; i < SIM_HZ * 2; i++) {
      state = step(state, NO_INPUT, SIM_DT, environment);
      closest = Math.max(closest, Math.abs(state.d));
    }
    // A rede de segurança deixaria chegar a 16 − wallMinGap; o contorno para antes.
    expect(closest).toBeLessThan(16 - TUNING.bodyHalfWidth + 0.12);
    expect(closest).toBeGreaterThan(16 - TUNING.bodyHalfWidth - 0.4);
  });

  it('o mesmo estado e as mesmas entradas dão o mesmo resultado, bit a bit', () => {
    const run = (): KartState => {
      const start = pointOnTrack(60, 12);
      let state: KartState = { ...start, heading: start.heading - 0.5, vx: 22, tireTemp: 1 };
      for (let i = 0; i < SIM_HZ; i++) state = step(state, NO_INPUT, SIM_DT, environment);
      return state;
    };
    expect(run()).toEqual(run());
  });
});

function pointOnTrack(s: number, d: number): KartState {
  const sample = track.samples[Math.round(s / track.step)]!;
  const state = createKartState(
    sample.x + sample.rx * d,
    sample.z + sample.rz * d,
    Math.atan2(sample.fx, sample.fz),
  );
  return step(state, NO_INPUT, SIM_DT, environment);
}

describe('colisão entre karts', () => {
  it('separa os karts e troca velocidade com impulso limitado', () => {
    const behind = { ...createKartState(0, 0, 0), vx: 20, tireTemp: 1 };
    const ahead = { ...createKartState(0, 1.7, 0), vx: 5, tireTemp: 1 };
    const [a, b] = resolveKartCollisions([behind, ahead]) as [KartState, KartState];
    expect(b.z - a.z).toBeGreaterThan(ahead.z - behind.z); // desencostaram
    expect(a.vx).toBeLessThan(20);
    expect(b.vx).toBeGreaterThan(5);
    expect(20 - a.vx).toBeLessThanOrEqual(TUNING.kartMaxImpulseSpeed + 1e-9);
    expect(a.vx + b.vx).toBeCloseTo(25, 6); // a quantidade de movimento se conserva
    expect(a.impact).toBeGreaterThan(0);
    expect(behind.vx).toBe(20); // entrada intacta
  });

  it('toque fora do centro gira os dois karts (no mesmo sentido, como numa batida real)', () => {
    const behind = { ...createKartState(0.5, 0, 0), vx: 20, tireTemp: 1 };
    const ahead = { ...createKartState(0, 1.7, 0), vx: 5, tireTemp: 1 };
    const [a, b] = resolveKartCollisions([behind, ahead]) as [KartState, KartState];
    expect(Math.abs(a.yawRate)).toBeGreaterThan(0.01);
    expect(Math.sign(a.yawRate)).toBe(Math.sign(b.yawRate));
  });

  it('lado a lado na largura do kart não é batida', () => {
    const karts = [
      createKartState(0, 0, 0),
      createKartState(2 * TUNING.bodyHalfWidth + 0.02, 0, 0),
    ];
    expect(resolveKartCollisions(karts)).toEqual(karts);
  });

  it('não mexe em karts afastados', () => {
    const karts = [createKartState(0, 0, 0), createKartState(3, 0, 0)];
    expect(resolveKartCollisions(karts)).toEqual(karts);
  });
});

describe('largada', () => {
  const race = createRace(track, { karts: 2, laps: 3, seed: 7 });

  it('acende 5 luzes, uma por segundo, e apaga depois de um tempo sorteado', () => {
    expect(startLights({ tick: 0, goTick: race.goTick })).toBe(0);
    expect(startLights({ tick: 61, goTick: race.goTick })).toBe(1);
    expect(startLights({ tick: 300, goTick: race.goTick })).toBe(5);
    expect(startLights({ tick: race.goTick, goTick: race.goTick })).toBe(0);
    expect(race.goTick).toBeGreaterThanOrEqual(300 + RACE_RULES.holdMinTicks);
    expect(race.goTick).toBeLessThan(300 + RACE_RULES.holdMaxTicks);
    expect(createRace(track, { karts: 1, laps: 3, seed: 7 }).goTick).toBe(race.goTick);
    expect(createRace(track, { karts: 1, laps: 3, seed: 8 }).goTick).not.toBe(race.goTick);
  });

  it('acelerar antes de as luzes apagarem dá 3 s de punição e o kart não sai do lugar', () => {
    let state: RaceState = race;
    for (let i = 0; i < race.goTick; i++) {
      // O kart 0 queima a largada; o kart 1 espera.
      state = stepRace(state, [i === 200 ? FULL : NO_INPUT, NO_INPUT], track, environment);
    }
    expect(state.progress[0]!.jumpStart).toBe(true);
    expect(state.progress[0]!.penaltyTicks).toBe(3 * SIM_HZ);
    expect(state.progress[1]!.jumpStart).toBe(false);
    expect(state.progress[1]!.penaltyTicks).toBe(0);
    expect(state.karts[0]!.x).toBe(race.karts[0]!.x);
    expect(state.karts[0]!.vx).toBe(0);

    // Segurar o acelerador não soma punição duas vezes.
    let held: RaceState = race;
    for (let i = 0; i < race.goTick; i++)
      held = stepRace(held, [FULL, NO_INPUT], track, environment);
    expect(held.progress[0]!.penaltyTicks).toBe(3 * SIM_HZ);
  });
});

describe('validação de volta', () => {
  const fresh = createRace(track, { karts: 1, laps: 3, seed: 1 }).progress[0]!;
  const gap = track.length / track.checkpoints.length;

  /** Anda de `from` a `to` em passos pequenos, como um kart de verdade. */
  function drive(progress: typeof fresh, from: number, to: number, tick: number): typeof fresh {
    let current = progress;
    for (let s = from; s < to; s += 5) {
      current = advanceProgress(
        current,
        track,
        ((s % track.length) + track.length) % track.length,
        (((s + 5) % track.length) + track.length) % track.length,
        tick,
        3,
      );
    }
    return current;
  }

  it('conta a volta ao cruzar todos os checkpoints em ordem', () => {
    let progress = drive(fresh, -20, 10, 100); // sai do grid e cruza a linha
    expect(progress.lap).toBe(1);
    expect(progress.lastLapTicks).toBeNull();
    progress = drive(progress, 10, track.length + 10, 4000);
    expect(progress.lap).toBe(2);
    expect(progress.lastLapTicks).toBe(4000 - fresh.lapStartTick);
    expect(progress.bestLapTicks).toBe(progress.lastLapTicks);
  });

  it('atalho não conta: pular checkpoints trava a volta', () => {
    let progress = drive(fresh, -20, 10, 100);
    progress = drive(progress, 10, gap * 3 + 5, 500); // checkpoints 1, 2 e 3
    expect(progress.nextCheckpoint).toBe(4);
    // "Teleporte" para perto do fim da volta, pulando os checkpoints 4 a 15.
    progress = advanceProgress(progress, track, gap * 3 + 5, track.length - 30, 600, 3);
    progress = drive(progress, track.length - 30, track.length + 20, 700);
    expect(progress.lap).toBe(1);
    expect(progress.lastLapTicks).toBeNull();
    expect(progress.nextCheckpoint).toBe(4);
  });

  it('andar na contramão não conta', () => {
    let progress = drive(fresh, -20, 10, 100);
    for (let s = 10; s > -track.length; s -= 5) {
      const wrap = (v: number): number => ((v % track.length) + track.length) % track.length;
      progress = advanceProgress(progress, track, wrap(s), wrap(s - 5), 900, 3);
    }
    expect(progress.lap).toBe(1);
    expect(progress.nextCheckpoint).toBe(1);
  });

  it('termina a corrida ao completar a última volta', () => {
    let progress = drive(fresh, -20, 10, 100);
    progress = drive(progress, 10, track.length * 3 + 10, 9000);
    expect(progress.finishTick).toBe(9000);
    expect(progress.lap).toBe(3);
    // Depois de terminar, nada mais muda.
    expect(drive(progress, 10, track.length + 10, 9999)).toBe(progress);
  });
});

describe('corrida completa com piloto automático', () => {
  it('um bot larga, completa 3 voltas limpas e o tempo fecha', () => {
    const plan = createBotPlan(track, 0.8);
    let race = createRace(track, { karts: 1, laps: 3, seed: 3 });
    let topSpeed = 0;
    for (let i = 0; i < SIM_HZ * 240 && race.phase !== 'finished'; i++) {
      const kart = race.karts[0]!;
      // O bot espera as luzes apagarem, como um piloto.
      const input = race.tick < race.goTick ? NO_INPUT : botInput(kart, track, plan);
      race = stepRace(race, [input], track, environment);
      topSpeed = Math.max(topSpeed, speedOf(race.karts[0]!));
    }
    const progress = race.progress[0]!;
    expect(race.phase).toBe('finished');
    expect(progress.jumpStart).toBe(false);
    expect(progress.resets).toBe(0);
    const lapSeconds = progress.bestLapTicks! / SIM_HZ;
    expect(lapSeconds).toBeGreaterThan(48);
    expect(lapSeconds).toBeLessThan(80);
    expect(topSpeed * KMH).toBeLessThan(114);
    expect(raceTimeTicks(race, 0)).toBe(progress.finishTick! - race.goTick);
  }, 30_000);

  it('nove bots correm juntos e a classificação sai da simulação', () => {
    const plans = Array.from({ length: 9 }, (_, i) => createBotPlan(track, 0.55 + i * 0.05));
    let race = createRace(track, { karts: 9, laps: 1, seed: 5 });
    for (let i = 0; i < SIM_HZ * 200 && race.phase !== 'finished'; i++) {
      race = stepRace(
        race,
        race.karts.map((kart, k) =>
          race.tick < race.goTick ? NO_INPUT : botInput(kart, track, plans[k]!),
        ),
        track,
        environment,
      );
    }
    expect(race.phase).toBe('finished');
    const order = standings(race, track);
    expect(new Set(order).size).toBe(9);
    const times = order.map((i) => raceTimeTicks(race, i)!);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
  }, 60_000);
});

describe('assistências de teclado', () => {
  it('suavizam a direção e reduzem o esterço em alta velocidade', () => {
    const raw = { steer: 1, throttle: 1, brake: 0, drift: false };
    const slow = { vx: 2, vy: 0 };
    const first = applyAssists(NO_INPUT, raw, slow, SIM_DT, KEYBOARD_ASSISTS);
    expect(first.steer).toBeGreaterThan(0);
    expect(first.steer).toBeLessThan(0.1); // não vai de 0 a 1 num tick
    expect(first.throttle).toBeLessThan(0.2);

    let low = NO_INPUT;
    let high = NO_INPUT;
    for (let i = 0; i < SIM_HZ; i++) {
      low = applyAssists(low, raw, slow, SIM_DT, KEYBOARD_ASSISTS);
      high = applyAssists(high, raw, { vx: 30, vy: 0 }, SIM_DT, KEYBOARD_ASSISTS);
    }
    expect(low.steer).toBeCloseTo(1, 1);
    expect(high.steer).toBeCloseTo(KEYBOARD_ASSISTS.steerAtTopSpeed, 2);
    expect(low.throttle).toBe(1);
  });

  it('o contra-esterço aponta as rodas para o lado da derrapagem', () => {
    const straight = { steer: 0, throttle: 0, brake: 0, drift: false };
    let input = NO_INPUT;
    for (let i = 0; i < SIM_HZ; i++) {
      input = applyAssists(input, straight, { vx: 15, vy: 4 }, SIM_DT, KEYBOARD_ASSISTS);
    }
    expect(input.steer).toBeGreaterThan(0.1); // andando de lado para a esquerda: vira à esquerda
  });
});
