import type { Track } from '../track/track.js';
import { pointAt } from '../track/track.js';
import { SURFACES, TUNING as T } from './tuning.js';
import type { KartInput, KartState } from './types.js';
import { speedOf } from './types.js';

/** Plano de volta de um bot: desvio do traçado e velocidade-alvo por amostra da pista. */
export interface BotPlan {
  /** 0 (cauteloso) a 1 (no limite). */
  skill: number;
  offset: Float32Array;
  speed: Float32Array;
}

/** Traçado ideal simples: por dentro das curvas, suavizado. Desvio lateral por amostra. */
export function racingLine(track: Track, maxOffset = 3.4): Float32Array {
  const n = track.samples.length;
  const raw = track.samples.map((p) =>
    Math.max(-maxOffset, Math.min(maxOffset, p.curvature * 220)),
  );
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -25; k <= 25; k++) sum += raw[(i + k + n) % n] as number;
    line[i] = sum / 51;
  }
  return line;
}

/**
 * Calcula a velocidade que o bot tenta manter em cada ponto: o limite de
 * aderência na curva e, voltando de trás para a frente, onde precisa começar
 * a frear. A habilidade só muda o quanto do limite ele usa.
 */
export function createBotPlan(track: Track, skill: number): BotPlan {
  const n = track.samples.length;
  const offset = racingLine(track);
  // Fração da aderência usada. Fica longe do limite de propósito: a folga é o que
  // perdoa o jogador que entra um pouco rápido demais na curva.
  const use = 0.55 + 0.17 * Math.min(1, Math.max(0, skill));
  const lateral = SURFACES.asphalt.grip * T.gravity * use;
  const braking = 5.4 * use;
  const top = 31;
  const speed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Usa o ponto mais fechado da vizinhança: o kart não reage a um trecho apertado de 2 m.
    let curvature = 1e-4;
    for (let k = -8; k <= 8; k++) {
      const sample = track.samples[(i + k + n) % n] as { curvature: number };
      curvature = Math.max(curvature, Math.abs(sample.curvature));
    }
    speed[i] = Math.min(top, Math.sqrt(lateral / curvature));
  }
  // Duas voltas de trás para a frente, para a frenagem atravessar a emenda do circuito.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = speed[(i + 1) % n] as number;
      speed[i] = Math.min(speed[i] as number, Math.sqrt(next * next + 2 * braking * track.step));
    }
  }
  return { skill, offset, speed };
}

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Comandos de um bot: persegue um ponto à frente no traçado (pure pursuit) e
 * controla a velocidade pelo plano. Usa a mesma física e as mesmas entradas
 * de um jogador; não tem aderência nem velocidade extra.
 */
export function botInput(kart: KartState, track: Track, plan: BotPlan): KartInput {
  const n = track.samples.length;
  const speed = speedOf(kart);
  const index = Math.max(0, kart.trackIndex) % n;

  const lookahead = 4.5 + speed * 0.38;
  const ahead = Math.round(lookahead / track.step);
  const targetIndex = (index + ahead) % n;
  const target = pointAt(track, targetIndex * track.step, plan.offset[targetIndex] as number);
  const bearing = Math.atan2(target.x - kart.x, target.z - kart.z);
  const error = wrapAngle(bearing - kart.heading);
  const wheelbase = T.cgToFront + T.cgToRear;
  const steerAngle = Math.atan((2 * wheelbase * Math.sin(error)) / lookahead);
  const steer = Math.max(-1, Math.min(1, steerAngle / T.maxSteer));

  // Olha um pouco à frente para frear a tempo.
  const speedIndex = (index + Math.round(speed * 0.12)) % n;
  // Com os pneus frios a curva aguenta menos: entra mais devagar nas primeiras.
  const grip = T.coldGrip + (1 - T.coldGrip) * kart.tireTemp;
  const planned = plan.speed[speedIndex] as number;
  const wanted = planned >= 31 ? planned : planned * Math.sqrt(grip);
  let throttle = 0;
  let brake = 0;
  if (speed > wanted + 0.8) {
    // O freio é só atrás: frear forte com o volante virado roda o kart.
    brake = Math.min(1, (speed - wanted) / 5) * (1 - 0.75 * Math.min(1, Math.abs(steer) * 2));
  } else if (speed < wanted) {
    // Dosa na saída de curva e na largada, quando a traseira ainda está carregada.
    const steering = Math.abs(steer);
    throttle = Math.max(0.35, 1 - steering * 0.6);
    // Pneu frio não aguenta o motor todo: dosa até aquecer.
    throttle *= 0.72 + 0.28 * kart.tireTemp;
    if (speed < 6) throttle = Math.min(throttle, 0.8);
    if (kart.wheelSlip > 0.25 || kart.rearSlide > 0.3) throttle *= 0.6;
  }
  return { steer, throttle, brake, drift: false };
}
