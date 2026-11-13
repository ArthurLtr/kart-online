import { TUNING as T } from './tuning.js';
import type { KartInput, KartState } from './types.js';

/** O que o jogador está apertando agora (teclado é tudo ou nada; gamepad é analógico). */
export interface RawInput {
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
}

/** Assistências de pilotagem, todas configuráveis e desligáveis. */
export interface AssistSettings {
  /** Suaviza a direção: velocidade de giro do volante, em cursos por segundo (0 = sem suavização). */
  steerRate: number;
  /** O volante volta ao centro mais rápido do que vira. */
  steerReturnRate: number;
  /** Reduz o esterço máximo em alta velocidade: fração que sobra na velocidade máxima (1 = não reduz). */
  steerAtTopSpeed: number;
  /** Suaviza acelerador e freio: cursos por segundo (0 = sem suavização). */
  pedalRate: number;
  /** Contra-esterço automático leve quando a traseira escapa (0 = desligado). */
  counterSteer: number;
  /**
   * Controle de estabilidade (0 = desligado, 1 = máximo): alivia o acelerador quando a
   * traseira escapa e dosa o freio com o volante virado ou a roda travando.
   */
  stability: number;
}

/** Padrão para teclado: entrada suavizada, sensação levemente arcade. */
export const KEYBOARD_ASSISTS: AssistSettings = {
  steerRate: 2.8,
  steerReturnRate: 6,
  steerAtTopSpeed: 0.3,
  pedalRate: 5,
  counterSteer: 0.9,
  stability: 1,
};

/** Padrão para gamepad: o analógico já dosa; fica só a redução em alta e um pouco de auxílio. */
export const GAMEPAD_ASSISTS: AssistSettings = {
  steerRate: 0,
  steerReturnRate: 0,
  steerAtTopSpeed: 0.4,
  pedalRate: 0,
  counterSteer: 0.2,
  stability: 0.5,
};

export const NO_ASSISTS: AssistSettings = {
  steerRate: 0,
  steerReturnRate: 0,
  steerAtTopSpeed: 1,
  pedalRate: 0,
  counterSteer: 0,
  stability: 0,
};

const TOP_SPEED = 30;

function approach(current: number, target: number, rate: number, dt: number): number {
  if (rate <= 0) return target;
  const step = rate * dt;
  return current + Math.min(step, Math.max(-step, target - current));
}

/**
 * Transforma o que o jogador aperta na entrada que vai para a simulação.
 * Só filtra comandos: não mexe em aderência, potência nem em qualquer força.
 * Pura: o estado do filtro é a própria entrada anterior.
 */
export function applyAssists(
  previous: KartInput,
  raw: RawInput,
  kart: Pick<KartState, 'vx' | 'vy'> & Partial<Pick<KartState, 'rearSlide' | 'wheelSlip'>>,
  dt: number,
  settings: AssistSettings,
): KartInput {
  const speed = Math.max(0, kart.vx);
  // Em alta, o curso todo do volante vira menos as rodas (teclado não tem meio-termo).
  const range = 1 - (1 - settings.steerAtTopSpeed) * Math.min(1, speed / TOP_SPEED);
  let target = Math.max(-1, Math.min(1, raw.steer)) * range;

  if (settings.counterSteer > 0 && speed > 4) {
    // Aponta as rodas para onde o kart está indo de fato quando ele anda de lado.
    const slide = Math.atan2(kart.vy, speed);
    target += (settings.counterSteer * slide) / T.maxSteer;
  }
  target = Math.max(-1, Math.min(1, target));

  const returning = Math.abs(target) < Math.abs(previous.steer) || target * previous.steer < 0;
  const steer = approach(
    previous.steer,
    target,
    returning ? settings.steerReturnRate : settings.steerRate,
    dt,
  );
  let throttleTarget = Math.max(0, Math.min(1, raw.throttle));
  let brakeTarget = Math.max(0, Math.min(1, raw.brake));
  if (settings.stability > 0 && speed > 4 && !raw.drift) {
    // Quanto a traseira já escapou: 0 abaixo de ~4° de deriva, 1 a partir de ~12°.
    const angle = Math.abs(Math.atan2(kart.vy, speed));
    const loose = Math.min(1, Math.max((angle - 0.07) / 0.14, kart.rearSlide ?? 0, 0));
    throttleTarget *= 1 - settings.stability * 0.85 * loose;
    // Controle de tração: roda patinando perde aderência lateral e a traseira sai.
    const spinning = Math.min(1, (kart.wheelSlip ?? 0) / 0.5);
    if (raw.brake <= 0) throttleTarget *= 1 - settings.stability * 0.6 * spinning;
    // O freio é só atrás: com o volante virado ou a roda travando, o pedal todo rodaria o kart.
    const turning = Math.min(1, Math.abs(previous.steer) / 0.3);
    const locking = raw.brake > 0 ? Math.min(1, (kart.wheelSlip ?? 0) / 0.4) : 0;
    brakeTarget *=
      1 - settings.stability * Math.min(0.85, 0.7 * turning + 0.5 * loose + 0.4 * locking);
  }

  return {
    steer,
    throttle:
      throttleTarget < previous.throttle
        ? throttleTarget // aliviar é imediato
        : approach(previous.throttle, throttleTarget, settings.pedalRate, dt),
    // Soltar o freio é imediato; apertar é que é progressivo.
    brake:
      brakeTarget < previous.brake
        ? brakeTarget
        : approach(previous.brake, brakeTarget, settings.pedalRate * 1.5, dt),
    drift: raw.drift,
  };
}
