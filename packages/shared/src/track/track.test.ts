import { describe, expect, it } from 'vitest';
import { MAX_KARTS } from '../constants.js';
import {
  barrierOffset,
  getCircuitoDaOrla,
  heightAt,
  pointAt,
  projectToTrack,
  surfaceAt,
} from './index.js';

const track = getCircuitoDaOrla();
const n = track.samples.length;

describe('Circuito da Orla', () => {
  it('tem cerca de 1,2 km e amostras a cada ~1 m', () => {
    expect(track.length).toBeGreaterThan(1150);
    expect(track.length).toBeLessThan(1300);
    expect(track.step).toBeCloseTo(1, 1);
    expect(n).toBe(Math.round(track.length / track.step));
  });

  it('é um circuito fechado e contínuo', () => {
    for (let i = 0; i < n; i++) {
      const a = track.samples[i]!;
      const b = track.samples[(i + 1) % n]!;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(track.step, 1);
    }
  });

  it('não cruza nem encosta em si mesmo', () => {
    const minGap = track.definition.width + 2 * track.definition.runoff;
    for (let i = 0; i < n; i += 3) {
      for (let j = i + 60; j < n; j += 3) {
        if (n - j + i < 60) continue; // vizinhos pela emenda do circuito
        const a = track.samples[i]!;
        const b = track.samples[j]!;
        expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(minGap);
      }
    }
  });

  it('tem de 6 a 8 curvas, com grampo, S e curva longa inclinada', () => {
    expect(track.corners.length).toBeGreaterThanOrEqual(6);
    expect(track.corners.length).toBeLessThanOrEqual(8);

    const radii = track.corners.map((c) => c.minRadius);
    expect(Math.min(...radii)).toBeGreaterThan(15); // nenhuma curva impossível
    expect(Math.min(...radii)).toBeLessThan(25); // o grampo

    // O S tem curva para os dois lados.
    expect(track.corners.some((c) => c.direction === -1)).toBe(true);

    const banked = track.samples.filter((p) => Math.abs(p.bank) > (5 * Math.PI) / 180);
    expect(banked.length).toBeGreaterThan(100); // curva longa
    expect(Math.max(...track.samples.map((p) => Math.abs(p.bank)))).toBeLessThan(
      (10 * Math.PI) / 180,
    );
  });

  it('a reta principal é plana e o banking levanta o lado de fora', () => {
    expect(heightAt(track, 0, 0)).toBeCloseTo(0, 5);
    const apex = track.samples.reduce((a, b) => (Math.abs(b.bank) > Math.abs(a.bank) ? b : a));
    const outside = apex.bank > 0 ? -track.halfWidth : track.halfWidth;
    expect(heightAt(track, apex.s, outside)).toBeGreaterThan(heightAt(track, apex.s, -outside) + 1);
    expect(heightAt(track, apex.s, -outside)).toBeGreaterThanOrEqual(0);
  });

  it('projeta pontos do mundo de volta para (s, d)', () => {
    for (let s = 3; s < track.length; s += 37) {
      for (const d of [-8, -3, 0, 4, 8]) {
        const p = pointAt(track, s, d);
        const projected = projectToTrack(track, p.x, p.z);
        expect(Math.abs(projected.s - s)).toBeLessThan(0.25);
        expect(projected.d).toBeCloseTo(d, 1);
        const hinted = projectToTrack(track, p.x, p.z, projected.index);
        expect(hinted.index).toBe(projected.index);
      }
    }
  });

  it('classifica o piso: asfalto, zebra, grama, brita e fora', () => {
    expect(surfaceAt(track, 0, 0)).toBe('asphalt');
    expect(surfaceAt(track, 0, 5.9)).toBe('asphalt');
    expect(surfaceAt(track, 0, 6.5)).toBe('grass'); // reta não tem zebra
    expect(surfaceAt(track, 0, 30)).toBe('out');

    const hairpin = track.corners.reduce((a, b) => (b.minRadius < a.minRadius ? b : a));
    const apexS = track.samples[hairpin.apex]!.s;
    expect(surfaceAt(track, apexS, 6.5 * hairpin.direction)).toBe('curb');
    expect(surfaceAt(track, apexS, -6.5 * hairpin.direction)).toBe('curb');
  });

  it('tem duas caixas de brita do lado de fora, com área de escape maior', () => {
    expect(track.gravelTraps).toHaveLength(2);
    for (const trap of track.gravelTraps) {
      const s = track.samples[Math.round((trap.from + trap.to) / 2)]!.s;
      expect(surfaceAt(track, s, 15 * trap.side)).toBe('gravel');
      expect(surfaceAt(track, s, -15 * trap.side)).toBe('grass');
      expect(barrierOffset(track, s, trap.side)).toBeGreaterThan(
        barrierOffset(track, s, -trap.side as 1 | -1) + 10,
      );
    }
    expect(track.tireWalls.length).toBeGreaterThanOrEqual(2);
  });

  it('tem checkpoints em ordem, com o primeiro na linha de chegada', () => {
    expect(track.checkpoints).toHaveLength(track.definition.checkpointCount);
    expect(track.checkpoints[0]!.s).toBe(0);
    for (let i = 1; i < track.checkpoints.length; i++) {
      expect(track.checkpoints[i]!.s).toBeGreaterThan(track.checkpoints[i - 1]!.s);
    }
  });

  it('tem grid de 9 posições em 3 fileiras de 3, no asfalto e atrás da linha', () => {
    expect(track.grid).toHaveLength(MAX_KARTS);
    const rows = new Set(track.grid.map((slot) => Math.floor((slot.position - 1) / 3)));
    expect(rows.size).toBe(3);
    for (const slot of track.grid) {
      expect(surfaceAt(track, slot.s, slot.d)).toBe('asphalt');
      expect(slot.s).toBeGreaterThan(track.length - 40); // atrás da linha de chegada
      const others = track.grid.filter((other) => other !== slot);
      for (const other of others) {
        expect(Math.hypot(other.x - slot.x, other.z - slot.z)).toBeGreaterThan(2.5);
      }
    }
    // A pole fica mais perto da linha que o 9º colocado.
    expect(track.grid[0]!.s).toBeGreaterThan(track.grid[8]!.s);
  });
});
