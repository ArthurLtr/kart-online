import type { KartState } from '@kart/shared';
import { SIM_DT } from '@kart/shared';

/** Atraso de exibição dos outros karts: dá margem para chegar o snapshot seguinte. */
export const INTERPOLATION_DELAY_SECONDS = 0.1;
/** Sem snapshot novo, continua o movimento por no máximo este tempo; depois o kart para. */
const MAX_EXTRAPOLATION_SECONDS = 0.15;
const MAX_SNAPSHOTS = 40;

interface Entry {
  tick: number;
  karts: readonly KartState[];
}

export interface Interpolated {
  state: KartState;
  x: number;
  y: number;
  z: number;
  heading: number;
}

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Guarda os últimos snapshots e devolve onde cada kart estava num instante do
 * passado recente. Os outros 8 karts são desenhados assim: 100 ms atrasados,
 * mas sempre entre dois estados reais do servidor, sem pulos.
 */
export class SnapshotBuffer {
  private entries: Entry[] = [];

  get newestTick(): number {
    return this.entries[this.entries.length - 1]?.tick ?? -1;
  }

  push(tick: number, karts: readonly KartState[]): void {
    if (tick <= this.newestTick) return; // atrasado ou repetido
    this.entries.push({ tick, karts });
    if (this.entries.length > MAX_SNAPSHOTS) this.entries.shift();
  }

  /** Estado do kart `slot` no tick (fracionário) pedido; `null` se ainda não há dados. */
  sample(slot: number, tick: number): Interpolated | null {
    const entries = this.entries;
    const newest = entries[entries.length - 1];
    if (!newest) return null;

    if (tick >= newest.tick) {
      // Passou do último snapshot: extrapola pela velocidade, por pouco tempo.
      const state = newest.karts[slot];
      if (!state) return null;
      const seconds = Math.min((tick - newest.tick) * SIM_DT, MAX_EXTRAPOLATION_SECONDS);
      const sinH = Math.sin(state.heading);
      const cosH = Math.cos(state.heading);
      return {
        state,
        x: state.x + (state.vx * sinH + state.vy * cosH) * seconds,
        y: state.y,
        z: state.z + (state.vx * cosH - state.vy * sinH) * seconds,
        heading: state.heading + state.yawRate * seconds,
      };
    }

    for (let i = entries.length - 2; i >= 0; i--) {
      const before = entries[i] as Entry;
      if (before.tick > tick) continue;
      const after = entries[i + 1] as Entry;
      const a = before.karts[slot];
      const b = after.karts[slot];
      if (!a || !b) return null;
      // Reposicionado entre os dois snapshots: troca de uma vez, sem atravessar a pista deslizando.
      if (Math.hypot(b.x - a.x, b.z - a.z) > 8)
        return { state: b, x: b.x, y: b.y, z: b.z, heading: b.heading };
      const k = (tick - before.tick) / (after.tick - before.tick);
      return {
        state: k < 0.5 ? a : b,
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        z: a.z + (b.z - a.z) * k,
        heading: a.heading + wrapAngle(b.heading - a.heading) * k,
      };
    }

    const oldest = entries[0] as Entry;
    const state = oldest.karts[slot];
    return state ? { state, x: state.x, y: state.y, z: state.z, heading: state.heading } : null;
  }

  clear(): void {
    this.entries = [];
  }
}
