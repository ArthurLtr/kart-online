import type { Surface, Track } from '../track/track.js';
import { heightAt, projectToTrack } from '../track/track.js';

/** Comandos de um kart num tick. É tudo o que o cliente envia ao servidor. */
export interface KartInput {
  /** -1 (direita) a +1 (esquerda). */
  steer: number;
  /** 0 a 1. */
  throttle: number;
  /** 0 a 1. Parado, segurar o freio engata a ré. */
  brake: number;
  /** Botão de drift: solta a traseira de forma controlada. */
  drift: boolean;
}

export const NO_INPUT: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false };

/**
 * Estado físico de um kart. Não tem nenhum campo de cosmético: a simulação
 * nem sabe que cosméticos existem.
 *
 * Eixos: `heading` é a rotação em Y (0 = +Z). No referencial do kart, x é
 * para a frente e y para a esquerda; guinada positiva = virar à esquerda.
 */
export interface KartState {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Velocidade para a frente, m/s. */
  vx: number;
  /** Velocidade lateral (positiva = esquerda), m/s. */
  vy: number;
  yawRate: number;
  /** Aceleração longitudinal do tick anterior (transferência de peso), m/s². */
  ax: number;
  rpm: number;
  /** Giro em que a embreagem está patinando. */
  clutchRpm: number;
  /** Esterço das rodas dianteiras, rad (positivo = esquerda). */
  steerAngle: number;
  /** 0 = roda traseira aderindo; cresce quando patina na tração ou trava na freada. */
  wheelSlip: number;
  /** 0 a 1+: o quanto a traseira passou do ângulo de deriva de pico. */
  rearSlide: number;
  /** 0 (frios) a 1 (na temperatura). */
  tireTemp: number;
  /** Velocidade do último impacto contra parede ou outro kart, m/s (0 se não houve neste tick). */
  impact: number;
  surface: Surface;
  /** Posição na pista: distância percorrida, desvio lateral (direita +) e índice da amostra. */
  s: number;
  d: number;
  trackIndex: number;
}

/** O que a física precisa saber do chão sob o kart. */
export interface GroundSample {
  surface: Surface;
  height: number;
  /** Banking em rad (positivo levanta o lado esquerdo da pista). */
  bank: number;
  /** Direção da pista e direita da pista, no plano XZ. */
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  s: number;
  d: number;
  index: number;
  barrierLeft: number;
  barrierRight: number;
}

export interface SimEnvironment {
  /** `hint` é o índice de amostra anterior do kart (-1 se desconhecido). */
  sample(x: number, z: number, hint: number): GroundSample;
}

/** Plano infinito de asfalto, sem paredes. Usado em testes de reta. */
export const FLAT_ENVIRONMENT: SimEnvironment = {
  sample: (x, z) => ({
    surface: 'asphalt',
    height: 0,
    bank: 0,
    fx: 0,
    fz: 1,
    rx: -1,
    rz: 0,
    s: z,
    d: -x,
    index: -1,
    barrierLeft: Infinity,
    barrierRight: Infinity,
  }),
};

/** Chão e paredes de uma pista. */
export function createTrackEnvironment(track: Track): SimEnvironment {
  const paved = track.halfWidth + track.definition.curbWidth;
  return {
    sample(x, z, hint) {
      const projection = projectToTrack(track, x, z, hint >= 0 ? hint : undefined);
      const { index, s, d } = projection;
      const frame = track.samples[index];
      if (!frame) throw new Error('amostra de pista inexistente');
      const side = d >= 0 ? 1 : -1;
      const distance = Math.abs(d);
      const barrierLeft = track.barrierLeft[index] as number;
      const barrierRight = track.barrierRight[index] as number;
      const barrier = side === 1 ? barrierRight : barrierLeft;
      let surface: Surface;
      if (distance <= track.halfWidth) surface = 'asphalt';
      else if (distance >= barrier) surface = 'out';
      else if (distance <= paved)
        surface = (track.curbCorner[index] as number) >= 0 ? 'curb' : 'grass';
      else
        surface = track.gravelSide[index] === side && distance < barrier - 1 ? 'gravel' : 'grass';
      return {
        surface,
        height: heightAt(track, s, d),
        bank: distance <= paved ? frame.bank : 0,
        fx: frame.fx,
        fz: frame.fz,
        rx: frame.rx,
        rz: frame.rz,
        s,
        d,
        index,
        barrierLeft,
        barrierRight,
      };
    },
  };
}

export function createKartState(x: number, z: number, heading: number, y = 0): KartState {
  return {
    x,
    y,
    z,
    heading,
    vx: 0,
    vy: 0,
    yawRate: 0,
    ax: 0,
    rpm: 2000,
    clutchRpm: 2000,
    steerAngle: 0,
    wheelSlip: 0,
    rearSlide: 0,
    tireTemp: 0,
    impact: 0,
    surface: 'asphalt',
    s: 0,
    d: 0,
    trackIndex: -1,
  };
}

/** Velocidade escalar em m/s. */
export function speedOf(state: Pick<KartState, 'vx' | 'vy'>): number {
  return Math.hypot(state.vx, state.vy);
}
