import type { ControlPoint } from './spline.js';
import { resampleClosed, sampleClosedSpline } from './spline.js';

export type Surface = 'asphalt' | 'curb' | 'grass' | 'gravel' | 'out';
/** Lado da pista em relação ao sentido da corrida: -1 esquerda, +1 direita. */
export type Side = -1 | 1;

export interface TrackDefinition {
  name: string;
  /** Sentido da corrida = ordem dos pontos. */
  points: readonly ControlPoint[];
  /** Ponto do traçado onde fica a linha de chegada (s = 0). */
  start: { x: number; z: number };
  /** Largura do asfalto, em metros. */
  width: number;
  curbWidth: number;
  /** Faixa entre a borda do asfalto e o guard-rail. */
  runoff: number;
  /** Faixa do lado de fora das curvas com caixa de brita. */
  gravelRunoff: number;
  /** Pontos próximos ao ápice das curvas que têm caixa de brita. */
  gravelAt: readonly { x: number; z: number }[];
  /** Curvas com raio menor que este ganham muro de pneus do lado de fora. */
  tireWallMaxRadius: number;
  checkpointCount: number;
  grid: {
    rows: number;
    columns: number;
    firstRow: number;
    rowGap: number;
    stagger: number;
    lane: number;
  };
}

/** Amostra da linha central, uma a cada `track.step` metros. */
export interface TrackSample {
  s: number;
  x: number;
  /** Altura da linha central (sobe nas curvas inclinadas). */
  y: number;
  z: number;
  /** Direção da corrida (unitária, no plano XZ). */
  fx: number;
  fz: number;
  /** Direita do piloto (unitária). */
  rx: number;
  rz: number;
  /** Banking em radianos; positivo levanta o lado esquerdo. */
  bank: number;
  /** Curvatura em 1/m; positiva = curva à direita. */
  curvature: number;
}

export interface Corner {
  id: number;
  /** Índices das amostras de entrada, ápice e saída. */
  from: number;
  apex: number;
  to: number;
  /** +1 curva à direita, -1 à esquerda. */
  direction: Side;
  minRadius: number;
}

export interface Zone {
  from: number;
  to: number;
  side: Side;
}

export interface Checkpoint {
  index: number;
  s: number;
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
}

export interface GridSlot {
  /** Posição de largada, 1 = pole. */
  position: number;
  s: number;
  d: number;
  x: number;
  y: number;
  z: number;
  /** Rotação em Y para um modelo com a frente em +Z. */
  heading: number;
}

export interface Track {
  definition: TrackDefinition;
  length: number;
  step: number;
  halfWidth: number;
  samples: readonly TrackSample[];
  corners: readonly Corner[];
  gravelTraps: readonly Zone[];
  tireWalls: readonly Zone[];
  checkpoints: readonly Checkpoint[];
  grid: readonly GridSlot[];
  /** Por amostra: id da curva cuja zebra passa ali, ou -1. */
  curbCorner: Int16Array;
  /** Por amostra: lado com brita (-1, +1) ou 0. */
  gravelSide: Int8Array;
  /** Por amostra: distância da linha central ao guard-rail de cada lado. */
  barrierLeft: Float32Array;
  barrierRight: Float32Array;
}

export interface Frame extends TrackSample {
  index: number;
}

export interface Projection {
  s: number;
  /** Distância lateral à linha central; positiva = direita. */
  d: number;
  index: number;
}

const CORNER_CURVATURE = 1 / 120;
const CURB_MARGIN = 6;
const VERGE_BLEND = 8;

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const smoothstep = (t: number): number => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

function boxSmooth(values: ArrayLike<number>, radius: number): number[] {
  const n = values.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += values[(((i + k) % n) + n) % n] as number;
    out.push(sum / (2 * radius + 1));
  }
  return out;
}

export function buildTrack(definition: TrackDefinition): Track {
  const dense = sampleClosedSpline(definition.points);
  const { points, length, step } = resampleClosed(dense, definition.start);
  const n = points.length;
  const halfWidth = definition.width / 2;
  const paved = halfWidth + definition.curbWidth;
  const wrap = (i: number): number => ((i % n) + n) % n;
  const point = (i: number): { x: number; z: number; bank: number } =>
    points[wrap(i)] as { x: number; z: number; bank: number };

  const tangents = points.map((_, i) => {
    const a = point(i - 1);
    const b = point(i + 1);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { fx: (b.x - a.x) / len, fz: (b.z - a.z) / len };
  });
  const headings = tangents.map((t) => Math.atan2(t.fz, t.fx));
  const rawCurvature = headings.map(
    (_, i) =>
      wrapAngle((headings[wrap(i + 1)] as number) - (headings[wrap(i - 1)] as number)) / (2 * step),
  );
  const curvature = boxSmooth(rawCurvature, 3);
  const bank = boxSmooth(
    points.map((p) => (p.bank * Math.PI) / 180),
    12,
  );

  const samples: TrackSample[] = points.map((p, i) => {
    const { fx, fz } = tangents[i] as { fx: number; fz: number };
    const b = bank[i] as number;
    return {
      s: i * step,
      x: p.x,
      // Sobe a linha central para a borda interna da curva inclinada ficar no nível do chão.
      y: paved * Math.tan(Math.abs(b)),
      z: p.z,
      fx,
      fz,
      rx: -fz,
      rz: fx,
      bank: b,
      curvature: curvature[i] as number,
    };
  });

  // Curvas: trechos contíguos com curvatura relevante e mesmo sentido.
  const corners: Corner[] = [];
  let i = 0;
  while (i < n) {
    const k = curvature[i] as number;
    if (Math.abs(k) < CORNER_CURVATURE) {
      i++;
      continue;
    }
    const direction: Side = k > 0 ? 1 : -1;
    const from = i;
    let apex = i;
    while (i < n && (curvature[i] as number) * direction >= CORNER_CURVATURE) {
      if (Math.abs(curvature[i] as number) > Math.abs(curvature[apex] as number)) apex = i;
      i++;
    }
    if (i - from >= 6) {
      corners.push({
        id: corners.length,
        from,
        apex,
        to: i - 1,
        direction,
        minRadius: 1 / Math.abs(curvature[apex] as number),
      });
    }
  }

  const curbCorner = new Int16Array(n).fill(-1);
  for (const corner of corners) {
    for (let j = corner.from - CURB_MARGIN; j <= corner.to + CURB_MARGIN; j++) {
      curbCorner[wrap(j)] = corner.id;
    }
  }

  const gravelSide = new Int8Array(n);
  const gravelTraps: Zone[] = definition.gravelAt.map((target) => {
    const corner = [...corners].sort((a, b) => {
      const pa = samples[a.apex] as TrackSample;
      const pb = samples[b.apex] as TrackSample;
      return (
        Math.hypot(pa.x - target.x, pa.z - target.z) - Math.hypot(pb.x - target.x, pb.z - target.z)
      );
    })[0];
    if (!corner) throw new Error('caixa de brita sem curva correspondente');
    const zone: Zone = {
      from: corner.from - 10,
      to: corner.to + 15,
      side: -corner.direction as Side,
    };
    for (let j = zone.from; j <= zone.to; j++) gravelSide[wrap(j)] = zone.side;
    return zone;
  });

  const baseBarrier = halfWidth + definition.runoff;
  const wideBarrier = halfWidth + definition.gravelRunoff;
  const barrier = (side: Side): Float32Array =>
    Float32Array.from(
      boxSmooth(
        Array.from(gravelSide, (g) => (g === side ? wideBarrier : baseBarrier)),
        18,
      ),
    );

  const tireWalls: Zone[] = corners
    .filter((corner) => corner.minRadius < definition.tireWallMaxRadius)
    .map((corner) => ({
      from: corner.from - 8,
      to: corner.to + 8,
      side: -corner.direction as Side,
    }));

  const track: Track = {
    definition,
    length,
    step,
    halfWidth,
    samples,
    corners,
    gravelTraps,
    tireWalls,
    checkpoints: [],
    grid: [],
    curbCorner,
    gravelSide,
    barrierLeft: barrier(-1),
    barrierRight: barrier(1),
  };

  const checkpoints: Checkpoint[] = [];
  for (let c = 0; c < definition.checkpointCount; c++) {
    const s = (c * length) / definition.checkpointCount;
    const f = frameAt(track, s);
    checkpoints.push({ index: c, s, x: f.x, y: f.y, z: f.z, fx: f.fx, fz: f.fz });
  }

  const { rows, columns, firstRow, rowGap, stagger, lane } = definition.grid;
  const grid: GridSlot[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const s = wrapS(track, -(firstRow + row * rowGap + column * stagger));
      const d = (column - (columns - 1) / 2) * lane;
      const f = frameAt(track, s);
      const p = pointAt(track, s, d);
      grid.push({
        position: grid.length + 1,
        s,
        d,
        ...p,
        heading: Math.atan2(f.fx, f.fz),
      });
    }
  }

  return { ...track, checkpoints, grid };
}

/** Traz `s` para o intervalo [0, comprimento). */
export function wrapS(track: Pick<Track, 'length'>, s: number): number {
  return ((s % track.length) + track.length) % track.length;
}

export function sampleIndex(track: Track, s: number): number {
  return Math.round(wrapS(track, s) / track.step) % track.samples.length;
}

/** Referencial da linha central em `s`, interpolado entre amostras. */
export function frameAt(track: Track, s: number): Frame {
  const n = track.samples.length;
  const t = wrapS(track, s) / track.step;
  const index = Math.floor(t) % n;
  const k = t - Math.floor(t);
  const a = track.samples[index] as TrackSample;
  const b = track.samples[(index + 1) % n] as TrackSample;
  const mix = (u: number, v: number): number => u + (v - u) * k;
  const fx = mix(a.fx, b.fx);
  const fz = mix(a.fz, b.fz);
  const len = Math.hypot(fx, fz);
  return {
    index,
    s: wrapS(track, s),
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    z: mix(a.z, b.z),
    fx: fx / len,
    fz: fz / len,
    rx: -fz / len,
    rz: fx / len,
    bank: mix(a.bank, b.bank),
    curvature: mix(a.curvature, b.curvature),
  };
}

function heightFrom(track: Track, y: number, bank: number, d: number): number {
  const paved = track.halfWidth + track.definition.curbWidth;
  const slope = Math.tan(bank);
  if (Math.abs(d) <= paved) return y - d * slope;
  // Fora do pavimento o terreno volta suavemente ao nível do chão.
  const edge = y - Math.sign(d) * paved * slope;
  return edge * (1 - smoothstep((Math.abs(d) - paved) / VERGE_BLEND));
}

/** Altura do terreno a `d` metros da linha central (positivo = direita). */
export function heightAt(track: Track, s: number, d: number): number {
  const f = frameAt(track, s);
  return heightFrom(track, f.y, f.bank, d);
}

export function pointAt(track: Track, s: number, d: number): { x: number; y: number; z: number } {
  const f = frameAt(track, s);
  return { x: f.x + f.rx * d, y: heightFrom(track, f.y, f.bank, d), z: f.z + f.rz * d };
}

/** Mesmo que pointAt, mas exatamente sobre a amostra `index` (aceita índices fora do intervalo). */
export function pointAtSample(
  track: Track,
  index: number,
  d: number,
): { x: number; y: number; z: number } {
  const n = track.samples.length;
  const a = track.samples[((index % n) + n) % n] as TrackSample;
  return { x: a.x + a.rx * d, y: heightFrom(track, a.y, a.bank, d), z: a.z + a.rz * d };
}

export function barrierOffset(track: Track, s: number, side: Side): number {
  const index = sampleIndex(track, s);
  return (side === 1 ? track.barrierRight[index] : track.barrierLeft[index]) as number;
}

/**
 * Projeta um ponto do mundo na linha central. `hint` (índice de amostra
 * anterior) restringe a busca à vizinhança, o que é mais rápido e evita
 * saltar para outro trecho da pista.
 */
export function projectToTrack(track: Track, x: number, z: number, hint?: number): Projection {
  const n = track.samples.length;
  let best = 0;
  let bestDistance = Infinity;
  const test = (i: number): void => {
    const p = track.samples[i] as TrackSample;
    const distance = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  };
  if (hint === undefined) {
    for (let i = 0; i < n; i++) test(i);
  } else {
    for (let k = -40; k <= 40; k++) test((((hint + k) % n) + n) % n);
  }
  const p = track.samples[best] as TrackSample;
  const along = (x - p.x) * p.fx + (z - p.z) * p.fz;
  const d = (x - p.x) * p.rx + (z - p.z) * p.rz;
  return { s: wrapS(track, p.s + along), d, index: best };
}

/** Tipo de piso a `d` metros da linha central. */
export function surfaceAt(track: Track, s: number, d: number): Surface {
  const index = sampleIndex(track, s);
  const side: Side = d >= 0 ? 1 : -1;
  const distance = Math.abs(d);
  const barrier = (side === 1 ? track.barrierRight[index] : track.barrierLeft[index]) as number;
  if (distance <= track.halfWidth) return 'asphalt';
  if (distance >= barrier) return 'out';
  const paved = track.halfWidth + track.definition.curbWidth;
  if (distance <= paved) return (track.curbCorner[index] as number) >= 0 ? 'curb' : 'grass';
  return track.gravelSide[index] === side && distance < barrier - 1 ? 'gravel' : 'grass';
}
