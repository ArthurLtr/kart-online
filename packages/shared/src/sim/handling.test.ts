import { describe, expect, it } from 'vitest';
import { SIM_DT, SIM_HZ } from '../constants.js';
import { getCircuitoDaOrla } from '../track/index.js';
import type { BotPlan, KartInput, KartState, RawInput } from './index.js';
import {
  applyAssists,
  botInput,
  createBotPlan,
  createKartState,
  createRace,
  createTrackEnvironment,
  KEYBOARD_ASSISTS,
  NO_INPUT,
  step,
  stepRace,
} from './index.js';

const track = getCircuitoDaOrla();
const environment = createTrackEnvironment(track);
const TOP_SPEED = 30.2; // ~109 km/h
const onTrack = (kart: KartState): boolean => kart.surface === 'asphalt' || kart.surface === 'curb';
/** Ângulo entre para onde o kart aponta e para onde ele anda, em graus. */
const slideDegrees = (kart: KartState): number =>
  (Math.abs(Math.atan2(kart.vy, Math.max(1, Math.abs(kart.vx)))) * 180) / Math.PI;

/**
 * Piloto de teclado: decide como o bot, mas só tem tecla apertada ou solta
 * (direção −1/0/1, pedais 0/1) e passa pelas assistências de teclado.
 */
function keyboardDriver(plan: BotPlan, kart: KartState, previous: KartInput): RawInput {
  const wanted = botInput({ ...kart, tireTemp: 1 }, track, plan);
  const side = Math.sign(wanted.steer);
  const press =
    Math.abs(wanted.steer) > 0.03 &&
    (side !== Math.sign(previous.steer) || Math.abs(previous.steer) < Math.abs(wanted.steer));
  const brake = wanted.brake > 0.05 ? 1 : 0;
  return {
    steer: press ? side : 0,
    throttle: brake || wanted.throttle <= 0 ? 0 : 1,
    brake,
    drift: false,
  };
}

function raceWithKeyboard(plan: BotPlan): { finished: boolean; offTicks: number; resets: number } {
  let race = createRace(track, { karts: 1, laps: 3, seed: 7 });
  let input: KartInput = NO_INPUT;
  let offTicks = 0;
  for (let i = 0; i < SIM_HZ * 300 && race.phase !== 'finished'; i++) {
    const kart = race.karts[0]!;
    const raw =
      race.tick < race.goTick
        ? { steer: 0, throttle: 0, brake: 0, drift: false }
        : keyboardDriver(plan, kart, input);
    input = applyAssists(input, raw, kart, SIM_DT, KEYBOARD_ASSISTS);
    race = stepRace(race, [input], track, environment);
    if (!onTrack(race.karts[0]!)) offTicks++;
  }
  return { finished: race.phase === 'finished', offTicks, resets: race.progress[0]!.resets };
}

describe('pilotagem no teclado', () => {
  it('no ritmo do bot a 80%, completa 3 voltas sem sair do asfalto', () => {
    expect(raceWithKeyboard(createBotPlan(track, 0.8))).toEqual({
      finished: true,
      offTicks: 0,
      resets: 0,
    });
  }, 30_000);

  it('entrar 10% rápido demais em todas as curvas ainda cabe na pista', () => {
    const plan = createBotPlan(track, 1);
    const hot = { ...plan, speed: plan.speed.map((speed) => Math.min(31, speed * 1.1)) };
    expect(raceWithKeyboard(hot)).toEqual({ finished: true, offTicks: 0, resets: 0 });
  }, 30_000);

  it('soltar o acelerador e virar tudo a 70% da máxima não roda o kart', () => {
    let kart: KartState = { ...createKartState(0, 0, 0), vx: 0.7 * TOP_SPEED, tireTemp: 1 };
    let input: KartInput = { ...NO_INPUT, throttle: 1 };
    let worst = 0;
    for (let i = 0; i < SIM_HZ * 3; i++) {
      const raw = { steer: 1, throttle: 0, brake: 0, drift: false };
      input = applyAssists(input, raw, kart, SIM_DT, KEYBOARD_ASSISTS);
      kart = step(kart, input, SIM_DT);
      worst = Math.max(worst, slideDegrees(kart));
    }
    expect(worst).toBeLessThan(15);
    expect(kart.vx).toBeGreaterThan(5); // segue andando para a frente
  });

  it('frear no fundo com o volante virado não roda o kart', () => {
    let kart: KartState = { ...createKartState(0, 0, 0), vx: 0.7 * TOP_SPEED, tireTemp: 1 };
    let input: KartInput = NO_INPUT;
    let worst = 0;
    for (let i = 0; i < SIM_HZ * 2; i++) {
      const raw = { steer: 1, throttle: 0, brake: 1, drift: false };
      input = applyAssists(input, raw, kart, SIM_DT, KEYBOARD_ASSISTS);
      kart = step(kart, input, SIM_DT);
      worst = Math.max(worst, slideDegrees(kart));
    }
    expect(worst).toBeLessThan(35);
  });

  it.each([
    { s: 60, d: 10, steer: 1 },
    { s: 60, d: -10, steer: -1 },
    { s: 700, d: 10, steer: 1 },
  ])('da grama a 60 km/h (s=$s, d=$d), segurar a direção devolve o kart à pista', (spot) => {
    const sample = track.samples[Math.round(spot.s / track.step)]!;
    let kart: KartState = {
      ...createKartState(
        sample.x + sample.rx * spot.d,
        sample.z + sample.rz * spot.d,
        Math.atan2(sample.fx, sample.fz),
      ),
      vx: 60 / 3.6,
      tireTemp: 1,
    };
    kart = step(kart, NO_INPUT, SIM_DT, environment);
    expect(kart.surface).toBe('grass');
    let input: KartInput = NO_INPUT;
    let worst = 0;
    let ticks = 0;
    while (!onTrack(kart) && ticks < SIM_HZ * 4) {
      const raw = { steer: spot.steer, throttle: 1, brake: 0, drift: false };
      input = applyAssists(input, raw, kart, SIM_DT, KEYBOARD_ASSISTS);
      kart = step(kart, input, SIM_DT, environment);
      worst = Math.max(worst, slideDegrees(kart));
      ticks++;
    }
    expect(onTrack(kart)).toBe(true);
    expect(ticks).toBeLessThan(SIM_HZ * 3);
    expect(worst).toBeLessThan(30);
  });
});
