import type { Surface } from '../track/track.js';

/**
 * Todas as constantes da física do kart. Modelo simcade de kart de competição
 * de marcha única: ~165 kg com piloto, ~25 kW, limitado a ~110 km/h pela
 * relação de transmissão. Mudou algo aqui? Rode `pnpm test`: os testes de
 * velocidade máxima, frenagem, largada e drift conferem os efeitos.
 */
export const TUNING = {
  /** Subpassos internos de cada tick de 1/60 s (estabilidade dos pneus em baixa velocidade). */
  substeps: 4,
  gravity: 9.81,

  // --- chassi ---------------------------------------------------------------
  /** Kart + piloto, kg. */
  mass: 165,
  /** Inércia de guinada, kg·m². */
  yawInertia: 62,
  /** Distância do centro de massa ao eixo dianteiro e ao traseiro, m (57% do peso atrás). */
  cgToFront: 0.6,
  cgToRear: 0.45,
  cgHeight: 0.22,
  /** Metade da largura usada na colisão com o guard-rail, m. */
  halfWidth: 0.65,
  /** Cápsula de colisão kart-kart: meio comprimento do eixo e raio, m. */
  capsuleHalfLength: 0.55,
  capsuleRadius: 0.62,
  /** Esterço máximo das rodas dianteiras, rad (~24°). */
  maxSteer: 0.42,

  // --- motor e transmissão --------------------------------------------------
  /** Curva de torque: [rpm, N·m]. Pico de 24 N·m a 9000 rpm; corte perto de 14500. */
  torqueCurve: [
    [0, 8],
    [2000, 9],
    [4000, 14],
    [6000, 19],
    [8000, 23],
    [9000, 24],
    [10000, 23.4],
    [11000, 22.1],
    [12000, 20],
    [13000, 17.4],
    [14000, 14],
    [14500, 0],
  ] as readonly (readonly [number, number])[],
  idleRpm: 2000,
  maxRpm: 14500,
  /** Embreagem centrífuga: começa a acoplar aqui… */
  clutchEngageRpm: 3800,
  /** …e com acelerador no fundo patina em torno desta rotação até a roda alcançar. */
  clutchStallRpm: 8200,
  /** Torque que a embreagem transmite na rotação de patinagem, N·m. */
  clutchCapacity: 30,
  /** Rapidez com que o motor sobe/desce de giro com a embreagem patinando, 1/s. */
  clutchRate: 9,
  /** Freio-motor com o acelerador solto, N·m. */
  engineBrake: 3.5,
  /** Coroa/pinhão. Com o pneu de 0,14 m dá ~110 km/h no corte de giro. */
  gearRatio: 6.9,
  drivetrainEfficiency: 0.92,
  /** Raio do pneu traseiro usado na física, m (independe do modelo 3D). */
  wheelRadius: 0.14,
  /** Força máxima de marcha a ré (segurando o freio parado), N, e velocidade limite, m/s. */
  reverseForce: 420,
  reverseSpeed: 3,

  // --- freio (só no eixo traseiro, como num kart de verdade) -----------------
  /** Pedal no fundo fica logo abaixo do travamento em reta com pneus quentes; em curva ou a frio, trava. */
  brakeForce: 1250,

  // --- pneus ----------------------------------------------------------------
  /** Curva de aderência: F = mu·Fz·sin(C·atan(B·escorregamento)). Pico em ~8°. */
  tireStiffness: 14.5,
  tireShape: 1.45,
  /** Ângulo de deriva de pico, rad (usado para medir o quanto a traseira desliza). */
  peakSlipAngle: 0.14,
  /** Leve tendência a sair de frente. */
  frontGripFactor: 0.93,
  /** Fração da transferência de peso longitudinal que muda a força lateral dos pneus. */
  lateralLoadTransfer: 0.3,
  /** Abaixo disto o ângulo de deriva usa esta velocidade (evita divisão por ~0), m/s. */
  minSlipSpeed: 1.5,
  /** Roda traseira patinando ou travada: fração da aderência longitudinal e lateral que sobra. */
  slidingLongitudinal: 0.78,
  slidingLateral: 0.72,
  /** Quanto acelerar ou frear no limite tira da aderência lateral traseira (1 = círculo de atrito puro). */
  combinedSlip: 0.45,
  /** Botão de drift: aderência traseira que sobra. Só solta a traseira, não dá velocidade. */
  driftRearGrip: 0.72,
  /** Pneus frios na largada: fração da aderência; aquecem rodando e deslizando. */
  coldGrip: 0.7,
  warmupPerMeter: 0.005,
  warmupPerSlide: 0.25,

  // --- eixo traseiro sólido (sem diferencial) --------------------------------
  /** Resistência à guinada em reta, N·m·s/rad; some quando o esterço levanta a roda interna. */
  axleScrub: 55,
  axleScrubSteerStart: 0.03,
  axleScrubSteerEnd: 0.17,

  // --- resistências ----------------------------------------------------------
  airDensity: 1.2,
  /** Cd·A do kart com piloto, m². */
  dragArea: 0.6,

  // --- guard-rail -----------------------------------------------------------
  wallRestitution: 0.12,
  /** Fração da velocidade ao longo da parede perdida num impacto forte. */
  wallFriction: 0.22,
  wallAlign: 0.18,

  // --- colisão entre karts ----------------------------------------------------
  kartRestitution: 0.3,
  /** Limite da troca de velocidade num toque, m/s ("resposta elástica limitada"). */
  kartMaxImpulseSpeed: 5,
} as const;

/**
 * Piso: aderência, resistência ao rolamento (fração do peso) e arrasto que
 * cresce com a velocidade (N por m/s). Fora do asfalto o kart perde
 * velocidade: na grama não passa de ~55 km/h e a brita quase o para, mas
 * sempre dá para sair andando.
 */
export const SURFACES: Record<Surface, { grip: number; rolling: number; drag: number }> = {
  asphalt: { grip: 1.9, rolling: 0.018, drag: 0 },
  curb: { grip: 1.7, rolling: 0.028, drag: 0 },
  grass: { grip: 0.95, rolling: 0.07, drag: 28 },
  gravel: { grip: 0.85, rolling: 0.1, drag: 40 },
  out: { grip: 0.95, rolling: 0.07, drag: 28 },
};

/** Regras de largada, volta e reposicionamento, em ticks de 1/60 s. */
export const RACE_RULES = {
  /** Uma luz do semáforo acende a cada segundo. */
  ticksPerLight: 60,
  lights: 5,
  /** Depois da 5ª luz, elas apagam após um tempo sorteado neste intervalo. */
  holdMinTicks: 40,
  holdMaxTicks: 130,
  /** Acelerar acima disto antes de as luzes apagarem é queima de largada. */
  jumpStartThrottle: 0.15,
  jumpStartPenaltyTicks: 180,
  /** Preso (sem andar) por este tempo: volta para o meio da pista. */
  resetAfterTicks: 180,
  /** Fora da pista por este tempo seguido: idem. Folgado, para dar tempo de voltar dirigindo. */
  offTrackResetTicks: 420,
  stuckSpeed: 1,
} as const;
