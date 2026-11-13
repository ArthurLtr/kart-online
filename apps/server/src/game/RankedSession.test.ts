import type { KartState } from '@kart/shared';
import { botInput, createBotPlan, getCircuitoDaOrla, NO_INPUT } from '@kart/shared';
import { describe, expect, it } from 'vitest';
import { RaceSession } from './RaceSession.js';

const track = getCircuitoDaOrla();

describe('sala ranqueada', () => {
  it('espera todos os escolhidos pela fila antes de largar', () => {
    const session = new RaceSession(track, { mode: 'ranked', code: 'r', seed: 1, minPlayers: 3 });
    session.addPlayer('a', 'Ana', {}, 'user-a');
    session.addPlayer('b', 'Bia', {}, 'user-b');
    session.setReady('a', true);
    session.setReady('b', true);
    for (let i = 0; i < 60 * 40; i++) session.tick();
    expect(session.phase).toBe('lobby');
    // Alguém não apareceu: a sala libera a largada com quem está.
    session.relaxMinPlayers();
    session.tick();
    expect(session.phase).toBe('race');
  });

  it('abandono fica em último e o relatório traz conta e voltas', () => {
    const session = new RaceSession(track, { mode: 'ranked', code: 'r', seed: 1, laps: 1 });
    const ids = ['a', 'b', 'c'];
    for (const id of ids) {
      session.addPlayer(id, id.toUpperCase(), {}, `user-${id}`);
      session.setReady(id, true);
    }
    session.tick();
    expect(session.phase).toBe('race');

    const plans = ids.map((_, i) => createBotPlan(track, 0.8 - i * 0.1));
    let seq = 0;
    for (let tick = 0; tick < 60 * 200 && session.phase === 'race'; tick++) {
      const race = session.race!;
      // "a" lidera e abandona depois de 20 s de prova.
      if (tick === 60 * 20) session.removePlayer('a');
      ids.forEach((id, i) => {
        const input =
          race.tick < race.goTick
            ? NO_INPUT
            : botInput(race.karts[i] as KartState, track, plans[i]!);
        session.pushInput(id, { seq, ...input });
      });
      seq++;
      session.tick();
    }

    expect(session.phase).toBe('results');
    const report = session.report!;
    expect(report).toHaveLength(3);
    const last = report[2]!;
    expect(last).toMatchObject({
      userId: 'user-a',
      abandoned: true,
      finished: false,
      timeTicks: null,
    });
    for (const entry of report.slice(0, 2)) {
      expect(entry.finished).toBe(true);
      expect(entry.abandoned).toBe(false);
      expect(entry.laps).toHaveLength(1);
      expect(entry.laps[0]).toBe(entry.bestLapTicks);
    }
    // O que vai para os clientes não carrega o id da conta.
    expect(session.results!.every((entry) => !('userId' in entry))).toBe(true);
  });
});
