import type { ControlPoint } from './spline.js';
import type { Track, TrackDefinition } from './track.js';
import { buildTrack } from './track.js';

/** Pontos de um arco de circunferência, em graus (0° = +X, 90° = +Z). */
function arc(
  cx: number,
  cz: number,
  radius: number,
  fromDeg: number,
  toDeg: number,
  steps: number,
  bank = 0,
): ControlPoint[] {
  const points: ControlPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    // O banking some nas pontas do arco para a transição ser suave.
    const edge = i === 0 || i === steps;
    points.push({
      x: cx + Math.cos(angle) * radius,
      z: cz + Math.sin(angle) * radius,
      bank: edge ? 0 : bank,
    });
  }
  return points;
}

/**
 * Circuito da Orla — sentido horário visto de cima, reta principal para +X
 * (o mar fica do lado -Z, à esquerda de quem larga).
 *
 * 1. Reta principal (~320 m)
 * 2. Curva 1: curva longa de 180° com banking de 8°, raio 75 m
 * 3. S rápido na reta oposta
 * 4. Grampo: 180° com raio 22 m (caixa de brita)
 * 5. Curva 5: 180° à esquerda com raio 28 m (caixa de brita)
 * 6. Curva 6: 180° com raio 25 m, de volta à reta principal
 */
const points: ControlPoint[] = [
  // Reta principal
  { x: -60, z: 0 },
  { x: 50, z: 0 },
  // Curva 1 (longa, inclinada)
  ...arc(130, 75, 75, -90, 90, 8, 8),
  // S rápido
  { x: 95, z: 150 },
  { x: 60, z: 143.5 },
  { x: 25, z: 150 },
  { x: -10, z: 156.5 },
  { x: -45, z: 150 },
  { x: -100, z: 150 },
  { x: -150, z: 150 },
  // Grampo
  ...arc(-190, 128, 22, 90, 270, 8),
  { x: -150, z: 106 },
  // Curva 5 (à esquerda)
  ...arc(-90, 78, 28, 90, -90, 8),
  { x: -130, z: 50 },
  // Curva 6
  ...arc(-170, 25, 25, 90, 270, 8),
];

export const CIRCUITO_DA_ORLA: TrackDefinition = {
  name: 'Circuito da Orla',
  points,
  start: { x: -40, z: 0 },
  width: 12,
  curbWidth: 1.2,
  runoff: 10,
  gravelRunoff: 24,
  gravelAt: [
    { x: -212, z: 128 },
    { x: -62, z: 78 },
  ],
  tireWallMaxRadius: 40,
  checkpointCount: 16,
  grid: { rows: 3, columns: 3, firstRow: 5, rowGap: 7, stagger: 1.2, lane: 3.6 },
};

let cached: Track | undefined;

/** Pista pronta (construída uma vez e reutilizada; é determinística). */
export function getCircuitoDaOrla(): Track {
  cached ??= buildTrack(CIRCUITO_DA_ORLA);
  return cached;
}
