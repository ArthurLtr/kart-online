import { SURFACES, TUNING as T } from './tuning.js';
import { kartPose } from './physics.js';
import type { GroundSample, KartInput, KartState, SimEnvironment } from './types.js';
import { FLAT_ENVIRONMENT } from './types.js';

const RAD_PER_S_TO_RPM = 60 / (2 * Math.PI);
const WHEELBASE = T.cgToFront + T.cgToRear;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Torque do motor com acelerador no fundo, N·m. */
export function engineTorque(rpm: number): number {
  const curve = T.torqueCurve;
  const last = curve[curve.length - 1] as readonly [number, number];
  if (rpm >= last[0]) return 0;
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i] as readonly [number, number];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1] as readonly [number, number];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return 0;
}

/** Força do pneu para um escorregamento (ângulo em rad ou razão), carga Fz e atrito mu. */
function tireForce(slip: number, load: number, mu: number): number {
  return mu * load * Math.sin(T.tireShape * Math.atan(T.tireStiffness * slip));
}

function integrate(k: KartState, input: KartInput, h: number, ground: GroundSample): void {
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  const delta = clamp(input.steer, -1, 1) * T.maxSteer;
  const weight = T.mass * T.gravity;
  const surface = SURFACES[ground.surface];
  const mu = surface.grip * (T.coldGrip + (1 - T.coldGrip) * k.tireTemp);

  // Transferência de peso: acelerando carrega a traseira, freando carrega a dianteira.
  const transfer = (T.mass * k.ax * T.cgHeight) / WHEELBASE;
  const loadRear = Math.max(0.15 * weight, (weight * T.cgToFront) / WHEELBASE + transfer);

  // --- motor e embreagem centrífuga ------------------------------------------
  const wheelRpm =
    (Math.abs(k.vx) / T.wheelRadius) *
    T.gearRatio *
    RAD_PER_S_TO_RPM *
    (1 + 0.5 * Math.min(k.wheelSlip, 1.5));
  const slipTarget = T.idleRpm + throttle * (T.clutchStallRpm - T.idleRpm);
  k.clutchRpm += (slipTarget - k.clutchRpm) * (1 - Math.exp(-T.clutchRate * h));
  const locked = wheelRpm >= k.clutchRpm;
  k.rpm = Math.min(T.maxRpm, Math.max(wheelRpm, k.clutchRpm));

  let torque = throttle * engineTorque(k.rpm);
  if (locked) {
    if (throttle < 0.05 && k.rpm > T.clutchEngageRpm) torque -= T.engineBrake;
  } else {
    // Patinando: a embreagem só transmite o que a rotação dela permite.
    const grab = smoothstep(T.clutchEngageRpm, T.clutchStallRpm, k.rpm);
    torque = Math.min(torque, grab * T.clutchCapacity);
  }
  let request = (torque * T.gearRatio * T.drivetrainEfficiency) / T.wheelRadius;

  // --- freio e ré (eixo traseiro) --------------------------------------------
  const reversing = brake > 0 && throttle < 0.05 && k.vx < 0.5;
  if (reversing) {
    request = k.vx > -T.reverseSpeed ? -brake * T.reverseForce : 0;
  } else if (Math.abs(k.vx) > 0.3) {
    request -= Math.sign(k.vx) * brake * T.brakeForce;
  }

  // --- aderência traseira: tração, travamento e botão de drift ----------------
  const muRear = mu * (input.drift ? T.driftRearGrip : 1);
  const limit = muRear * loadRear;
  let longitudinal = request;
  let lateralScale: number;
  if (Math.abs(request) > limit) {
    // Passou do limite: a roda patina (tração) ou trava (freio) e a traseira fica solta.
    longitudinal = Math.sign(request) * limit * T.slidingLongitudinal;
    const excess = Math.abs(request) / limit - 1;
    k.wheelSlip += (Math.min(2, 0.4 + excess * 2.5) - k.wheelSlip) * (1 - Math.exp(-14 * h));
    lateralScale = T.slidingLateral;
  } else {
    k.wheelSlip *= Math.exp(-9 * h);
    // Círculo de atrito: o que a roda gasta para acelerar ou frear falta para a curva.
    // (Elipse folgada: no limite da tração ainda sobra parte da aderência lateral.)
    lateralScale = Math.sqrt(1 - T.combinedSlip * (request / limit) ** 2);
  }

  // --- forças laterais dos pneus ---------------------------------------------
  const frontLateralSpeed = k.vy + T.cgToFront * k.yawRate;
  const wheelForward = k.vx * Math.cos(delta) + frontLateralSpeed * Math.sin(delta);
  const wheelLateral = -k.vx * Math.sin(delta) + frontLateralSpeed * Math.cos(delta);
  const slipFront = -Math.atan2(wheelLateral, Math.max(Math.abs(wheelForward), T.minSlipSpeed));
  const slipRear = -Math.atan2(
    k.vy - T.cgToRear * k.yawRate,
    Math.max(Math.abs(k.vx), T.minSlipSpeed),
  );
  // Na força lateral só entra parte da transferência de peso (o pneu real não ganha
  // aderência na proporção da carga); sem isso, aliviar o acelerador em alta rodava o kart.
  const lateralShift = transfer * T.lateralLoadTransfer;
  const staticFront = (weight * T.cgToRear) / WHEELBASE;
  const staticRear = (weight * T.cgToFront) / WHEELBASE;
  const forceFront = tireForce(slipFront, staticFront - lateralShift, mu * T.frontGripFactor);
  const forceRear = tireForce(slipRear, staticRear + lateralShift, muRear) * lateralScale;

  // --- eixo sólido: resiste a girar enquanto as duas rodas estão no chão ------
  const lifted = smoothstep(T.axleScrubSteerStart, T.axleScrubSteerEnd, Math.abs(delta));
  const scrubMoment = -T.axleScrub * (1 - 0.85 * lifted) * k.yawRate;
  const scrubDrag =
    (Math.abs(scrubMoment * k.yawRate) / Math.max(Math.abs(k.vx), 2)) * Math.sign(k.vx);

  // --- resistências e gravidade no banking ------------------------------------
  const drag = 0.5 * T.airDensity * T.dragArea * k.vx * Math.abs(k.vx);
  const rolling = surface.rolling * weight * Math.tanh(k.vx / 0.5) + surface.drag * k.vx;
  const sinH = Math.sin(k.heading);
  const cosH = Math.cos(k.heading);
  // Na pista inclinada a gravidade puxa para o lado de dentro (direita da pista se bank > 0).
  const downhill = T.gravity * Math.sin(ground.bank);
  const gravityForward = downhill * (ground.rx * sinH + ground.rz * cosH);
  const gravityLeft = downhill * (ground.rx * cosH - ground.rz * sinH);

  const forceX = longitudinal - forceFront * Math.sin(delta) - drag - rolling - scrubDrag;
  const forceY = forceFront * Math.cos(delta) + forceRear;
  const ax = forceX / T.mass + gravityForward;
  const ay = forceY / T.mass + gravityLeft;
  const yawAcceleration =
    (T.cgToFront * forceFront * Math.cos(delta) - T.cgToRear * forceRear + scrubMoment) /
    T.yawInertia;

  k.vx += (ax + k.yawRate * k.vy) * h;
  k.vy += (ay - k.yawRate * k.vx) * h;
  k.yawRate += yawAcceleration * h;
  k.ax += (ax - k.ax) * (1 - Math.exp(-20 * h));

  // Parado sem comando: o atrito estático segura o kart.
  if (Math.abs(k.vx) < 0.35 && throttle < 0.02 && !reversing) {
    const hold = Math.exp(-12 * h);
    k.vx *= hold;
    k.vy *= hold;
    k.yawRate *= hold;
  }

  k.heading = wrapAngle(k.heading + k.yawRate * h);
  // Eixos do kart no mundo: frente (sinH, cosH), esquerda (cosH, -sinH).
  k.x += (k.vx * sinH + k.vy * cosH) * h;
  k.z += (k.vx * cosH - k.vy * sinH) * h;

  k.steerAngle = delta;
  k.rearSlide = Math.max(0, Math.abs(slipRear) / T.peakSlipAngle - 1);
  const sliding = Math.min(1, k.rearSlide) + Math.min(1, k.wheelSlip);
  k.tireTemp = Math.min(
    1,
    k.tireTemp + (Math.abs(k.vx) * T.warmupPerMeter + sliding * T.warmupPerSlide) * h,
  );
}

/** Resposta a uma parede de normal `n` (apontando para a pista): quica pouco e desliza ao longo dela. */
function hitWall(k: KartState, nx: number, nz: number, leverX: number, leverZ: number): void {
  const sinH = Math.sin(k.heading);
  const cosH = Math.cos(k.heading);
  let wx = k.vx * sinH + k.vy * cosH;
  let wz = k.vx * cosH - k.vy * sinH;
  const into = -(wx * nx + wz * nz);
  if (into <= 0) return;
  // Tangente da parede, no sentido em que o kart já estava indo.
  let tx = nz;
  let tz = -nx;
  let along = wx * tx + wz * tz;
  if (along < 0) {
    tx = -tx;
    tz = -tz;
    along = -along;
  }
  // Tira a componente contra a parede (com um pouco de quique) e freia a que corre ao longo dela.
  const keep = 1 - T.wallFriction * Math.min(1, into / 6);
  const bounce = into * T.wallRestitution;
  wx = tx * along * keep + nx * bounce;
  wz = tz * along * keep + nz * bounce;
  k.vx = wx * sinH + wz * cosH;
  k.vy = wx * cosH - wz * sinH;
  // Bater de bico gira o kart para longe da parede; depois o bico se alinha a ela.
  const lever = leverZ * nx - leverX * nz;
  k.yawRate =
    k.yawRate * 0.4 +
    ((lever * into * (1 + T.wallRestitution) * T.mass) / T.collisionYawInertia) * T.wallSpin;
  const tangent = Math.atan2(tx, tz);
  k.heading = wrapAngle(k.heading + wrapAngle(tangent - k.heading) * T.wallAlign);
  k.impact = Math.max(k.impact, into);
}

/**
 * Guard-rail. O Rapier acha em que trecho do trilho o contorno do kart afunda
 * (posição, normal e sobreposição); o kart é empurrado de volta e desliza ao
 * longo da parede. Por baixo fica uma rede de segurança pela distância à linha
 * central, para o kart nunca atravessar o trilho, por mais rápido que venha.
 */
function collideWithBarrier(
  k: KartState,
  ground: GroundSample,
  environment: SimEnvironment,
): GroundSample {
  const walls = environment.walls;
  let moved = false;
  if (walls) {
    for (let pass = 0; pass < 3; pass++) {
      const side = ground.d >= 0 ? 1 : -1;
      const pose = kartPose(k);
      const contact = walls.deepest(pose, -ground.rx * side, -ground.rz * side);
      if (!contact) break;
      const { nx, nz, depth, px, pz } = contact;
      k.x += nx * depth;
      k.z += nz * depth;
      hitWall(k, nx, nz, px - pose.x, pz - pose.y);
      moved = true;
    }
    if (moved) ground = environment.sample(k.x, k.z, ground.index);
  }

  const side = ground.d >= 0 ? 1 : -1;
  const gap = walls ? T.wallMinGap : T.halfWidth;
  const limit = (side === 1 ? ground.barrierRight : ground.barrierLeft) - gap;
  const penetration = Math.abs(ground.d) - limit;
  if (!(penetration > 0)) return ground;

  // Normal da parede apontando para a pista.
  const nx = -ground.rx * side;
  const nz = -ground.rz * side;
  k.x += nx * penetration;
  k.z += nz * penetration;
  hitWall(k, nx, nz, 0, 0);
  return { ...ground, d: side * limit };
}

/**
 * Avança a física de um kart em `dt` segundos (use SIM_DT = 1/60).
 *
 * Função pura e determinística: mesmo estado + mesma entrada = mesmo
 * resultado, bit a bit, no cliente e no servidor. Não lê relógio, DOM nem
 * estado global, e não altera o `state` recebido.
 */
export function step(
  state: Readonly<KartState>,
  input: Readonly<KartInput>,
  dt: number,
  environment: SimEnvironment = FLAT_ENVIRONMENT,
): KartState {
  const k: KartState = { ...state, impact: 0 };
  const h = dt / T.substeps;
  let ground = environment.sample(k.x, k.z, k.trackIndex);
  for (let i = 0; i < T.substeps; i++) {
    integrate(k, input, h, ground);
    ground = environment.sample(k.x, k.z, ground.index);
  }
  ground = collideWithBarrier(k, ground, environment);

  k.y = ground.height;
  k.surface = ground.surface;
  k.s = ground.s;
  k.d = ground.d;
  k.trackIndex = ground.index;
  return k;
}
