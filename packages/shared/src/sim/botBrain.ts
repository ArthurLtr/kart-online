import type { Track } from '../track/track.js';
import type { BotPlan } from './bot.js';
import { createBotPlan } from './bot.js';
import type { RaceState } from './race.js';
import { TUNING as T } from './tuning.js';
import type { KartInput, KartState } from './types.js';

/**
 * Piloto-bot competitivo. Enxerga os outros karts, escolhe linha, ataca,
 * defende, anda lado a lado e erra como gente, tudo com as MESMAS entradas e
 * a MESMA física de um jogador: nunca ganha aderência, velocidade ou
 * aceleração extra. A disputa nasce das decisões, não de trapaça.
 *
 * Determinístico: toda sorte vem de um gerador com semente por corrida e
 * vaga, guardado no próprio piloto. Sem alocação por tick (o comando
 * devolvido é sempre o mesmo objeto, reescrito).
 */

export type BotMode =
  'livre' | 'perseguindo' | 'atacando' | 'defendendo' | 'lado-a-lado' | 'recuperando';

export interface BotPersonality {
  /** Quanto arrisca na freada e quão cedo tenta a ultrapassagem (0–1). */
  aggression: number;
  /** Repete o mesmo ponto de freada volta a volta (0–1). */
  consistency: number;
  /** Quanto fecha a porta (0–1). */
  defense: number;
  /** Cuidado com o pneu frio (0–1). */
  tireCare: number;
  /** Tempo de reação na largada, em ticks. */
  reactionTicks: number;
  /** Estilo reconhecível, para o painel e a lista de pilotos. */
  style: string;
}

/** Erros humanos possíveis (0 = nenhum). */
const ERR_NONE = 0;
const ERR_LATE_BRAKE = 1;
const ERR_LOCKUP = 2;
const ERR_WIDE_EXIT = 3;
const ERR_DRIFT = 4;
const ERROR_NAMES = ['', 'freou tarde', 'travou a roda', 'saiu largo', 'escorregou'] as const;

export interface BotDriver {
  readonly index: number;
  readonly skill: number;
  readonly personality: BotPersonality;
  readonly plan: BotPlan;
  /** Mesmo plano freando mais tarde (para mergulhar por dentro). */
  readonly attackPlan: BotPlan;
  mode: BotMode;
  modeTicks: number;
  /** Ticks até poder atacar de novo depois de desistir. */
  cooldown: number;
  /** Desvio atual em relação ao traçado ideal (m). */
  shift: number;
  /** Linha desejada (desvio lateral absoluto); NaN = traçado ideal. */
  desired: number;
  /** Kart alvo do ataque, ou -1. */
  target: number;
  /** Curva em que já gastou o "um movimento" de defesa. */
  movedForCorner: number;
  /** Curva em que já sorteou erro (um sorteio por curva). */
  rolledCorner: number;
  errorKind: number;
  errorTicks: number;
  /** Ticks sob pressão (alguém colado atrás). */
  pressure: number;
  paceJitter: number;
  lastLap: number;
  /** Linha de largada (mantém a fila até a primeira curva) e distância até ela. */
  readonly startD: number;
  readonly startDist: number;
  readonly startHold: number;
  rng: number;
  /** Comando reaproveitado a cada tick. */
  readonly input: KartInput;
}

/** Estado leve de todos os karts, montado uma vez por tick para todos os bots. */
export interface BotContext {
  count: number;
  /** Distância de corrida (voltas × comprimento + posição na volta). */
  readonly dist: Float64Array;
  readonly d: Float32Array;
  /** Velocidade de avanço ao longo da pista, m/s (kart rodando quase não avança). */
  readonly speed: Float32Array;
  readonly finished: Uint8Array;
  /** Distância de corrida no tick anterior (para medir o avanço). */
  readonly previous: Float64Array;
  /** Tick do último retrato (para medir o avanço). */
  lastTick: number;
  /** Posição na corrida (0 = líder) por kart. */
  readonly rank: Int8Array;
  /** Distância do líder ao segundo, m. */
  leaderGap: number;
  /** Ordem de trabalho da classificação (reaproveitada). */
  readonly order: Int8Array;
}

interface TrackInfo {
  /** Lado de dentro da próxima curva (+1 direita, -1 esquerda, 0 nenhuma). */
  side: Int8Array;
  /** Metros até a entrada da próxima curva (0 = dentro dela). */
  dist: Float32Array;
  /** Id da próxima (ou atual) curva, ou -1. */
  corner: Int16Array;
}

const KART_GAP = 2.7;
const MIN_MODE_TICKS = 30;
const LINE_RATE = 2.4; // m/s de mudança de linha (1–2 s para trocar de lado)
const DT = 1 / 60;

const infoCache = new WeakMap<Track, TrackInfo>();

function trackInfo(track: Track): TrackInfo {
  const cached = infoCache.get(track);
  if (cached) return cached;
  const n = track.samples.length;
  const side = new Int8Array(n);
  const dist = new Float32Array(n).fill(Infinity);
  const corner = new Int16Array(n).fill(-1);
  const inside = (i: number, from: number, to: number): boolean =>
    from <= to ? i >= from && i <= to : i >= from || i <= to;
  for (const c of track.corners) {
    const apex = track.samples[c.apex];
    const s = apex && apex.curvature > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      let meters: number;
      if (inside(i, c.from, c.to)) meters = 0;
      else meters = ((((c.from - i) % n) + n) % n) * track.step;
      if (meters < (dist[i] as number)) {
        dist[i] = meters;
        side[i] = s;
        corner[i] = c.id;
      }
    }
  }
  const info = { side, dist, corner };
  infoCache.set(track, info);
  return info;
}

/** mulberry32 com estado guardado no piloto. */
function nextRandom(driver: { rng: number }): number {
  driver.rng = (driver.rng + 0x6d2b79f5) >>> 0;
  let t = driver.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function styleOf(p: Omit<BotPersonality, 'style'>): string {
  if (p.aggression > 0.78) return 'Agressivo: mergulha por dentro';
  if (p.defense > 0.8) return 'Muralha: fecha a porta';
  if (p.consistency > 0.85) return 'Constante: quase nunca erra';
  if (p.reactionTicks < 9) return 'Largador: reage rápido no verde';
  if (p.tireCare > 0.8) return 'Técnico: cuida dos pneus';
  return 'Equilibrado';
}

/** Personalidade sorteada com semente (mesma semente, mesmo piloto). */
export function botPersonality(seed: number): BotPersonality {
  const state = { rng: seed >>> 0 };
  const roll = (min: number, max: number): number => min + (max - min) * nextRandom(state);
  const base = {
    aggression: roll(0.2, 1),
    consistency: roll(0.35, 1),
    defense: roll(0.2, 1),
    tireCare: roll(0.2, 1),
    reactionTicks: Math.round(roll(6, 22)),
  };
  return { ...base, style: styleOf(base) };
}

export interface BotDriverOptions {
  /** Semente da corrida; a vaga entra junto, então cada bot é um piloto diferente. */
  seed: number;
  /** Personalidade fixa (ex.: o Treino escolhe uma de cada estilo). */
  personality?: BotPersonality;
}

/** Cria o piloto-bot da vaga `index` para a corrida que está começando. */
export function createBotDriver(
  track: Track,
  race: RaceState,
  index: number,
  skill: number,
  options: BotDriverOptions,
): BotDriver {
  const level = Math.min(1, Math.max(0, skill));
  const personality = options.personality ?? botPersonality(options.seed * 31 + index * 7919);
  const kart = race.karts[index] as KartState;
  const info = trackInfo(track);
  const n = track.samples.length;
  const idx = ((kart.trackIndex % n) + n) % n;
  return {
    index,
    skill: level,
    personality,
    plan: createBotPlan(track, level),
    // Freia mais tarde no ataque, dentro do que a física aguenta (a folga do plano normal).
    attackPlan: createBotPlan(track, level, 0.02 + 0.04 * personality.aggression),
    mode: 'livre',
    modeTicks: 0,
    cooldown: 0,
    shift: 0,
    desired: NaN,
    target: -1,
    movedForCorner: -1,
    rolledCorner: -1,
    errorKind: ERR_NONE,
    errorTicks: 0,
    pressure: 0,
    paceJitter: 0,
    lastLap: -1,
    startD: kart.d,
    startDist: kart.s - track.length,
    startHold: Math.min(260, Math.max(40, (info.dist[idx] as number) + 20)),
    rng: (options.seed * 2654435761 + index * 40503 + 17) >>> 0,
    input: { steer: 0, throttle: 0, brake: 0, drift: false },
  };
}

export function createBotContext(capacity: number): BotContext {
  return {
    count: 0,
    dist: new Float64Array(capacity),
    d: new Float32Array(capacity),
    speed: new Float32Array(capacity),
    finished: new Uint8Array(capacity),
    rank: new Int8Array(capacity),
    leaderGap: Infinity,
    order: new Int8Array(capacity),
    previous: new Float64Array(capacity),
    lastTick: -1,
  };
}

/** Atualiza o retrato da corrida (uma vez por tick, antes de pedir os comandos dos bots). */
export function updateBotContext(ctx: BotContext, race: RaceState, track: Track): void {
  const count = Math.min(race.karts.length, ctx.dist.length);
  ctx.count = count;
  const elapsed = ctx.lastTick >= 0 ? race.tick - ctx.lastTick : 0;
  ctx.lastTick = race.tick;
  const order = ctx.order;
  for (let i = 0; i < count; i++) {
    const kart = race.karts[i] as KartState;
    const progress = race.progress[i];
    const lap = progress?.lap ?? 0;
    const along = lap === 0 ? kart.s - track.length : kart.s;
    const dist = lap * track.length + along;
    ctx.dist[i] = dist;
    ctx.d[i] = kart.d;
    // Avanço real na pista: um kart rodando tem velocidade de lado, mas quase não avança.
    ctx.speed[i] =
      elapsed > 0 && elapsed < 4
        ? Math.max(0, ((dist - (ctx.previous[i] as number)) * 60) / elapsed)
        : Math.max(0, kart.vx);
    ctx.previous[i] = dist;
    ctx.finished[i] = progress?.finishTick != null ? 1 : 0;
    order[i] = i;
  }
  // Ordenação por inserção (no máximo 9 karts): sem alocar.
  for (let a = 1; a < count; a++) {
    const value = order[a] as number;
    let b = a - 1;
    while (b >= 0 && (ctx.dist[order[b] as number] as number) < (ctx.dist[value] as number)) {
      order[b + 1] = order[b] as number;
      b--;
    }
    order[b + 1] = value;
  }
  for (let r = 0; r < count; r++) ctx.rank[order[r] as number] = r;
  ctx.leaderGap =
    count > 1
      ? (ctx.dist[order[0] as number] as number) - (ctx.dist[order[1] as number] as number)
      : Infinity;
}

/** Ninguém (além do próprio bot) perto da linha `line` entre `from` e `to` metros à frente. */
function laneFree(
  ctx: BotContext,
  self: number,
  myDist: number,
  line: number,
  from: number,
  to: number,
): boolean {
  for (let j = 0; j < ctx.count; j++) {
    if (j === self) continue;
    const gap = (ctx.dist[j] as number) - myDist;
    if (gap < from || gap > to) continue;
    if (Math.abs((ctx.d[j] as number) - line) < 1.9) return false;
  }
  return true;
}

function setMode(driver: BotDriver, mode: BotMode): void {
  if (driver.mode === mode) return;
  driver.mode = mode;
  driver.modeTicks = 0;
}

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Texto curto do estado do bot (painel de depuração). */
export function describeBot(driver: BotDriver): string {
  const error = driver.errorTicks > 0 ? ` · ${ERROR_NAMES[driver.errorKind] ?? ''}` : '';
  const target = driver.target >= 0 ? ` → #${driver.target + 1}` : '';
  return `${driver.mode}${target}${error}`;
}

/**
 * Comando do bot neste tick. `ctx` precisa ter sido atualizado com
 * `updateBotContext` neste mesmo tick. Antes do verde (e durante o tempo de
 * reação) devolve pedais soltos: bot nunca queima a largada de propósito.
 */
export function driveBot(
  driver: BotDriver,
  race: RaceState,
  track: Track,
  ctx: BotContext,
): KartInput {
  const out = driver.input;
  const i = driver.index;
  const kart = race.karts[i] as KartState;
  const p = driver.personality;
  out.steer = 0;
  out.throttle = 0;
  out.brake = 0;
  out.drift = false;
  if (race.tick < race.goTick + p.reactionTicks) return out;

  const n = track.samples.length;
  const info = trackInfo(track);
  const idx = ((kart.trackIndex % n) + n) % n;
  const speed = Math.hypot(kart.vx, kart.vy);
  const myDist = ctx.dist[i] as number;
  const myD = kart.d;
  const cornerDist = info.dist[idx] as number;
  // Margem até a borda: na curva o kart alarga, então sobra mais espaço por fora.
  const usable = track.halfWidth - (cornerDist === 0 ? 1.7 : 1.2);
  const cornerSide = info.side[idx] as number;
  const cornerId = info.corner[idx] as number;

  driver.modeTicks++;
  if (driver.cooldown > 0) driver.cooldown--;
  if (driver.errorTicks > 0 && --driver.errorTicks === 0) driver.errorKind = ERR_NONE;

  // Cada volta tem um ritmo um pouco diferente (menos para quem é constante).
  const lap = race.progress[i]?.lap ?? 0;
  if (lap !== driver.lastLap) {
    driver.lastLap = lap;
    driver.paceJitter = (nextRandom(driver) * 2 - 1) * (1 - p.consistency) * 0.015;
  }

  // --- percepção ---------------------------------------------------------------
  let ahead = -1;
  let aheadGap = Infinity;
  let behind = -1;
  let behindGap = Infinity;
  let beside = -1;
  let besideDd = Infinity;
  for (let j = 0; j < ctx.count; j++) {
    if (j === i) continue;
    const gap = (ctx.dist[j] as number) - myDist;
    const dd = (ctx.d[j] as number) - myD;
    if (Math.abs(gap) < 2.2 && Math.abs(dd) < 2.8 && Math.abs(dd) < Math.abs(besideDd)) {
      beside = j;
      besideDd = dd;
    }
    if (ctx.finished[j]) continue;
    if (gap > 0 && gap < 70 && gap < aheadGap) {
      ahead = j;
      aheadGap = gap;
    } else if (gap <= 0 && -gap < 50 && -gap < behindGap) {
      behind = j;
      behindGap = -gap;
    }
  }
  const aheadTime = aheadGap / Math.max(speed, 5);
  const behindTime = behind >= 0 ? behindGap / Math.max(ctx.speed[behind] as number, 5) : Infinity;
  driver.pressure = behindTime < 0.6 ? driver.pressure + 1 : Math.max(0, driver.pressure - 2);

  // Quem vem atrás arrisca mais; quem lidera com folga administra.
  const trailing = (ctx.rank[i] as number) >= Math.ceil(ctx.count / 2);
  const comfortableLead = ctx.rank[i] === 0 && ctx.leaderGap > 90;
  const aggression = clamp(p.aggression + (trailing ? 0.2 : 0), 0, 1);
  // Largada: os primeiros segundos são de acomodação (sem ataque, mais respeito lado a lado).
  const opening = race.tick - race.goTick < 60 * 8;

  // --- estados -------------------------------------------------------------------
  const offTrack = kart.surface === 'grass' || kart.surface === 'gravel' || kart.surface === 'out';
  // Derrapagem normal do kart passa de 4 m/s de lado; rodada de verdade é bem mais.
  const spun = Math.abs(kart.vy) > 7 || kart.impact > 5;
  const stalled = speed < 3 && race.tick > race.goTick + 180;
  if ((offTrack || spun || stalled) && driver.mode !== 'recuperando')
    setMode(driver, 'recuperando');

  if (driver.mode === 'recuperando') {
    if (driver.modeTicks > 75 && !offTrack && speed > 8) setMode(driver, 'livre');
  } else if (driver.mode === 'atacando') {
    const gone = ahead !== driver.target || aheadGap > 25;
    const doorClosed =
      driver.target >= 0 &&
      aheadGap > 2.5 &&
      Math.abs((ctx.d[driver.target] as number) - driver.desired) < 1.4;
    const tooLong = driver.modeTicks > 420;
    if (gone) {
      setMode(driver, 'livre');
      driver.target = -1;
    } else if (doorClosed || tooLong) {
      // Desiste sem forçar: volta a perseguir e só tenta de novo daqui a pouco.
      setMode(driver, 'perseguindo');
      driver.target = -1;
      driver.cooldown = 90 + Math.round((1 - aggression) * 120);
    }
  } else if (driver.modeTicks >= MIN_MODE_TICKS) {
    if (beside >= 0) setMode(driver, 'lado-a-lado');
    else if (ahead >= 0 && aheadTime < 2) {
      const closing = (ctx.speed[ahead] as number) < speed + 0.3 || aheadGap < 8;
      // Decide a cada meio segundo, com a agressividade do piloto.
      if (
        driver.cooldown === 0 &&
        !opening &&
        beside < 0 &&
        closing &&
        aheadTime < 0.9 &&
        driver.modeTicks % 30 === 0 &&
        // Bem mais rápido que o da frente: tenta com mais frequência.
        nextRandom(driver) <
          0.25 + aggression * 0.6 + ((ctx.speed[ahead] as number) < speed - 1.5 ? 0.3 : 0)
      ) {
        // Lado: por dentro da próxima curva, ou na reta para onde houver mais espaço.
        const rival = ctx.d[ahead] as number;
        let side = cornerDist < 110 && cornerSide !== 0 ? cornerSide : rival > 0 ? -1 : 1;
        let line = clamp(rival + side * KART_GAP, -usable, usable);
        if (Math.abs(line - rival) < 1.8) {
          side = -side;
          line = clamp(rival + side * KART_GAP, -usable, usable);
        }
        if (Math.abs(line - rival) >= 1.8 && laneFree(ctx, i, myDist, line, -3, 14)) {
          setMode(driver, 'atacando');
          driver.target = ahead;
          driver.desired = line;
        } else setMode(driver, 'perseguindo');
      } else if (driver.mode !== 'perseguindo') setMode(driver, 'perseguindo');
    } else if (behind >= 0 && behindTime < 0.6) setMode(driver, 'defendendo');
    else setMode(driver, 'livre');
  }

  // --- linha desejada -------------------------------------------------------------
  let desired = NaN;
  let pace = 1 + driver.paceJitter;
  let usePlan = driver.plan;
  switch (driver.mode) {
    case 'atacando': {
      desired = driver.desired;
      if (
        driver.target >= 0 &&
        aheadGap < 3 &&
        Math.abs((ctx.d[driver.target] as number) - myD) < 1.7
      ) {
        pace *= 0.94;
      }
      // Mergulho por dentro: freia mais tarde só na zona de freada. Dentro da
      // curva a linha por dentro é mais fechada, então vale o plano normal.
      if (cornerDist > 0 && cornerDist < 120) usePlan = driver.attackPlan;
      break;
    }
    case 'defendendo': {
      // Um movimento por reta: cobre o lado de dentro antes da curva, uma vez.
      if (
        cornerDist < 110 &&
        cornerSide !== 0 &&
        cornerId !== driver.movedForCorner &&
        beside < 0
      ) {
        driver.movedForCorner = cornerId;
        const inside = cornerSide * usable * 0.55;
        // Quem vem atrás já está colado ou já ocupa o lado de dentro: não fecha a porta.
        const attackerInside =
          behind >= 0 && Math.abs((ctx.d[behind] as number) - inside) < 2.2 && behindGap < 9;
        driver.desired =
          !attackerInside &&
          behindGap > 5 &&
          // Contra quem é claramente mais rápido a defesa raramente segura.
          nextRandom(driver) <
            (0.3 + p.defense * 0.7) * ((ctx.speed[behind] as number) > speed + 1.5 ? 0.45 : 1)
            ? inside
            : NaN;
      }
      if (cornerId === driver.movedForCorner && cornerDist > 0) desired = driver.desired;
      break;
    }
    case 'lado-a-lado': {
      if (beside >= 0) {
        const away = besideDd > 0 ? -1 : 1;
        desired = clamp((ctx.d[beside] as number) + away * KART_GAP, -usable, usable);
        // Quem está por fora e um pouco atrás na entrada da curva cede.
        const outside =
          cornerSide !== 0 && Math.sign(myD - (ctx.d[beside] as number)) !== cornerSide;
        if (outside && (ctx.dist[beside] as number) > myDist && cornerDist < 60) pace *= 0.95;
        if (Math.abs(besideDd) < (opening ? 2.4 : 1.8) && (ctx.dist[beside] as number) > myDist) {
          pace *= opening ? 0.9 : 0.93;
        }
      }
      if (beside < 0 && driver.modeTicks > MIN_MODE_TICKS) setMode(driver, 'livre');
      break;
    }
    case 'recuperando':
      // Na grama/brita volta devagar; no asfalto só alivia (cortar demais roda o kart).
      pace *= offTrack ? 0.8 : 0.92;
      break;
    default:
      break;
  }
  // Kart lento ou parado na faixa à frente: desvia pelo lado livre em vez de esperar.
  if (driver.mode !== 'atacando') {
    let blocker = -1;
    let blockerGap = Infinity;
    for (let j = 0; j < ctx.count; j++) {
      if (j === i) continue;
      const gap = (ctx.dist[j] as number) - myDist;
      if (gap <= 0 || gap > 45 || gap >= blockerGap) continue;
      if ((ctx.speed[j] as number) > speed * 0.6 + 1) continue;
      const lineNow = Number.isNaN(desired) ? myD : desired;
      if (Math.abs((ctx.d[j] as number) - lineNow) > 2.2) continue;
      blocker = j;
      blockerGap = gap;
    }
    if (blocker >= 0) {
      const other = ctx.d[blocker] as number;
      const left = clamp(other - KART_GAP, -usable, usable);
      const right = clamp(other + KART_GAP, -usable, usable);
      const leftOk =
        Math.abs(left - other) >= 1.8 && laneFree(ctx, i, myDist, left, -2, blockerGap + 8);
      const rightOk =
        Math.abs(right - other) >= 1.8 && laneFree(ctx, i, myDist, right, -2, blockerGap + 8);
      if (leftOk || rightOk) {
        desired =
          leftOk && rightOk
            ? Math.abs(left - myD) <= Math.abs(right - myD)
              ? left
              : right
            : leftOk
              ? left
              : right;
      }
    }
  }

  // Largada: segue na própria fila até a primeira curva, sem fila indiana.
  if (Number.isNaN(desired) && myDist - driver.startDist < driver.startHold) {
    desired = driver.startD;
  }

  // --- erros humanos (um sorteio por curva) --------------------------------------
  if (cornerDist < 25 && cornerId >= 0 && cornerId !== driver.rolledCorner) {
    driver.rolledCorner = cornerId;
    const chance =
      (0.01 + (1 - driver.skill) * 0.07 + Math.min(driver.pressure / 600, 1) * 0.03) *
      (1 - p.consistency * 0.6) *
      (comfortableLead ? 1.3 : 1);
    if (driver.errorTicks === 0 && nextRandom(driver) < chance) {
      driver.errorKind = 1 + Math.floor(nextRandom(driver) * 4);
      driver.errorTicks = 30 + Math.floor(nextRandom(driver) * 30);
    }
  }
  if (driver.errorTicks > 0) {
    if (driver.errorKind === ERR_LATE_BRAKE) pace *= 1.07;
    else if (driver.errorKind === ERR_WIDE_EXIT && cornerSide !== 0) {
      desired = -cornerSide * usable * 0.9;
    }
  }
  if (comfortableLead) pace *= 0.975;
  // Pneu frio: quem cuida dos pneus entra ainda mais devagar.
  pace *= 1 - p.tireCare * 0.05 * (1 - kart.tireTemp);

  // --- traçado: desvio suave em relação à linha ideal ------------------------------
  const lookahead = 4.5 + speed * 0.38;
  const targetIndex = (idx + Math.round(lookahead / track.step)) % n;
  const base = driver.plan.offset[targetIndex] as number;
  const goalShift = Number.isNaN(desired) ? 0 : clamp(desired, -usable, usable) - base;
  const dodging = beside >= 0 && Math.abs(besideDd) < KART_GAP;
  // Dentro da curva a linha muda devagar: trocar de trajetória no meio dela roda o kart.
  const inCorner = cornerDist === 0;
  const rate =
    (driver.mode === 'recuperando'
      ? 1.2
      : dodging
        ? LINE_RATE * 1.8
        : inCorner
          ? LINE_RATE * 0.45
          : LINE_RATE) * DT;
  driver.shift += clamp(goalShift - driver.shift, -rate, rate);
  const offset = clamp(base + driver.shift, -usable, usable);
  const sample = track.samples[targetIndex] as (typeof track.samples)[number];
  const tx = sample.x + sample.rx * offset;
  const tz = sample.z + sample.rz * offset;
  const bearing = Math.atan2(tx - kart.x, tz - kart.z);
  const error = Math.atan2(Math.sin(bearing - kart.heading), Math.cos(bearing - kart.heading));
  const wheelbase = T.cgToFront + T.cgToRear;
  const steerAngle = Math.atan((2 * wheelbase * Math.sin(error)) / lookahead);
  let steer = clamp(steerAngle / T.maxSteer, -1, 1);

  // --- ritmo ------------------------------------------------------------------------
  const speedIndex = (idx + Math.round(speed * 0.12)) % n;
  const grip = T.coldGrip + (1 - T.coldGrip) * kart.tireTemp;
  const planned = usePlan.speed[speedIndex] as number;
  let wanted = (planned >= 31 ? planned : planned * Math.sqrt(grip)) * pace;
  // Nunca bate na traseira: quem está na faixa atual ou na faixa para onde o
  // bot está indo dita o ritmo até abrir espaço.
  for (let j = 0; j < ctx.count; j++) {
    if (j === i) continue;
    const gap = (ctx.dist[j] as number) - myDist;
    if (gap <= 0.2 || gap > 70) continue;
    const other = ctx.d[j] as number;
    const reach = Math.min(1, gap / lookahead);
    const lineThere = myD + (offset - myD) * reach;
    if (Math.abs(other - myD) < 1.9 || Math.abs(other - lineThere) < 1.9) {
      // Velocidade que ainda permite frear até a traseira dele (≈5,5 m/s² de freada).
      const room = Math.max(0, gap - 4);
      const theirs = ctx.speed[j] as number;
      const cap = Math.sqrt(theirs * theirs + 2 * 5.5 * room);
      if (cap < wanted) wanted = cap;
    }
  }
  let throttle = 0;
  let brake = 0;
  if (speed > wanted + 0.8) {
    brake = Math.min(1, (speed - wanted) / 5) * (1 - 0.75 * Math.min(1, Math.abs(steer) * 2));
  } else if (speed < wanted) {
    const steering = Math.abs(steer);
    throttle = Math.max(0.35, 1 - steering * 0.6);
    throttle *= 0.72 + 0.28 * kart.tireTemp;
    if (speed < 6) throttle = Math.min(throttle, 0.8);
    if (kart.wheelSlip > 0.25 || kart.rearSlide > 0.3) throttle *= 0.6;
  }
  // Escorregando: nada de freada forte (freio com o kart de lado é rodada na certa).
  if (Math.abs(kart.vy) > 3.5) brake = Math.min(brake, 0.25);
  if (driver.mode === 'recuperando' && behind >= 0 && behindGap < 15) {
    // Volta para a pista sem atravessar na frente de quem vem.
    throttle = Math.min(throttle, 0.3);
  }
  if (driver.errorTicks > 0) {
    if (driver.errorKind === ERR_LOCKUP && speed > 12) {
      brake = 1;
      throttle = 0;
      steer *= 0.5;
    } else if (driver.errorKind === ERR_WIDE_EXIT) throttle *= 0.6;
    else if (driver.errorKind === ERR_DRIFT && Math.abs(steer) > 0.2) out.drift = true;
  }
  out.steer = steer;
  out.throttle = throttle;
  out.brake = brake;
  return out;
}
