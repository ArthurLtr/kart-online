import { describe, expect, it } from 'vitest';
import type { KartState } from '@kart/shared';
import {
  botInput,
  createBotPlan,
  getCircuitoDaOrla,
  MAX_KARTS,
  NO_INPUT,
  SIM_HZ,
} from '@kart/shared';
import { RaceSession } from './RaceSession.js';

const track = getCircuitoDaOrla();
const quick = {
  code: 'TESTE',
  seed: 42,
  laps: 1,
  lobbySeconds: 1,
  resultSeconds: 1,
  podiumSeconds: 1,
  finishGraceSeconds: 5,
};

/** Um "cliente" que dirige com o piloto automático e manda uma entrada por tick, como o jogo faz. */
function createPilot(session: RaceSession, id: string, skill = 0.8) {
  const plan = createBotPlan(track, skill);
  let seq = 0;
  return () => {
    const race = session.race;
    const kart = race?.karts[session.slotOf(id)] as KartState | undefined;
    const input = race && kart && race.tick >= race.goTick ? botInput(kart, track, plan) : NO_INPUT;
    session.pushInput(id, { seq: seq++, ...input });
  };
}

function run(session: RaceSession, seconds: number, eachTick: () => void = () => {}): void {
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    eachTick();
    session.tick();
  }
}

describe('ciclo da sala', () => {
  it('lobby → corrida → resultado → pódio → lobby, com bots completando o grid no Casual', () => {
    const session = new RaceSession(track, { ...quick, mode: 'casual' });
    expect(session.addPlayer('ana', 'Ana', { suit: 'orla' })).toBe(0);
    expect(session.roomMessage('ana').secondsLeft).toBe(1);

    const drive = createPilot(session, 'ana');
    run(session, 1.1, drive);
    expect(session.phase).toBe('race');
    const roster = session.roster();
    expect(roster).toHaveLength(MAX_KARTS);
    expect(roster.filter((entry) => entry.bot)).toHaveLength(MAX_KARTS - 1);
    expect(session.race?.karts).toHaveLength(MAX_KARTS);

    // Ninguém mais entra com a corrida em andamento.
    expect(session.addPlayer('atrasado', 'Atrasado', {})).toBe(-1);

    for (let i = 0; i < 200 * SIM_HZ && session.phase === 'race'; i++) {
      drive();
      session.tick();
    }
    expect(session.phase).toBe('results');
    const results = session.results!;
    expect(results).toHaveLength(MAX_KARTS);
    expect(results.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const ana = results.find((r) => r.name === 'Ana')!;
    expect(ana.finished).toBe(true);
    expect(ana.timeTicks).toBeGreaterThan(40 * SIM_HZ);
    // Quem terminou está ordenado pelo tempo com punições.
    const times = results.filter((r) => r.finished).map((r) => r.timeTicks!);
    expect([...times].sort((a, b) => a - b)).toEqual(times);

    run(session, 1.1);
    expect(session.phase).toBe('podium');
    run(session, 1.1);
    expect(session.phase).toBe('lobby');
    expect(session.roster()).toHaveLength(1); // os bots saíram, a Ana ficou
    expect(session.roster()[0]!.ready).toBe(false);
    expect(session.race).toBeNull();
  }, 30_000);

  it('aceita 9 jogadores e recusa o décimo; todos prontos largam na hora', () => {
    const session = new RaceSession(track, { ...quick, mode: 'private', lobbySeconds: 60 });
    for (let i = 0; i < MAX_KARTS; i++) expect(session.addPlayer(`p${i}`, `P${i}`, {})).toBe(i);
    expect(session.addPlayer('p9', 'P9', {})).toBe(-1);
    for (let i = 0; i < MAX_KARTS; i++) session.setReady(`p${i}`, true);
    session.tick();
    expect(session.phase).toBe('race');
    expect(session.roster().some((entry) => entry.bot)).toBe(false); // sala privada não tem bots
  });

  it('lobby vazio não larga sozinho, e sair do lobby libera a vaga', () => {
    const session = new RaceSession(track, { ...quick, mode: 'casual' });
    run(session, 3);
    expect(session.phase).toBe('lobby');
    session.addPlayer('ana', 'Ana', {});
    session.addPlayer('bia', 'Bia', {});
    session.removePlayer('ana');
    expect(session.roster().map((entry) => entry.name)).toEqual(['Bia']);
    expect(session.slotOf('bia')).toBe(0);
  });

  it('quem cai fica com o kart parado e a corrida termina com os outros', () => {
    const session = new RaceSession(track, { ...quick, mode: 'private' });
    session.addPlayer('ana', 'Ana', {});
    session.addPlayer('bia', 'Bia', {});
    const ana = createPilot(session, 'ana');
    run(session, 1.1, ana);
    expect(session.phase).toBe('race');
    session.setConnected('bia', false);
    for (let i = 0; i < 200 * SIM_HZ && session.phase === 'race'; i++) {
      ana();
      session.tick();
    }
    expect(session.phase).toBe('results');
    const results = session.results!;
    expect(results[0]!.name).toBe('Ana');
    expect(results[1]).toMatchObject({ name: 'Bia', finished: false, timeTicks: null });
  }, 30_000);
});

describe('cosméticos não entram na simulação', () => {
  it('dois karts com cosméticos diferentes e as mesmas entradas têm estados idênticos', () => {
    const plain = new RaceSession(track, { ...quick, mode: 'private' });
    const fancy = new RaceSession(track, { ...quick, mode: 'private' });
    plain.addPlayer('ana', 'Ana', {});
    fancy.addPlayer(
      'ana',
      'Ana',
      {
        livery: 'vermelho',
        suit: 'largada',
        helmetModel: 'aero',
        helmetPaint: 'crepusculo',
        visor: 'dourada',
        rim: 'ouro',
        trail: 'arco-iris',
      },
      null,
      { number: '27', stickers: [{ shape: 'star', size: 1 }], wheels: { color: '#dcff2e' } },
    );
    expect(fancy.paints()[0]).toMatchObject({ number: '27' });
    expect(plain.paints()[0]).toBeNull();
    // Mesma sequência de comandos nas duas salas, com curva, freio e drift.
    const command = (tick: number) => ({
      seq: tick,
      steer: Math.sin(tick * 0.03) * 0.7,
      throttle: tick % 240 < 200 ? 1 : 0,
      brake: tick % 240 >= 220 ? 0.8 : 0,
      drift: tick % 300 > 250,
    });
    for (let tick = 0; tick < 40 * SIM_HZ; tick++) {
      plain.pushInput('ana', command(tick));
      fancy.pushInput('ana', command(tick));
      plain.tick();
      fancy.tick();
      expect(fancy.race).toEqual(plain.race);
    }
    expect(plain.phase).toBe('race');
    expect(plain.race!.karts[0]!.s).not.toBe(plain.race!.karts[0]!.x); // o kart andou de fato
    expect(Math.hypot(plain.race!.karts[0]!.vx, plain.race!.karts[0]!.vy)).toBeGreaterThan(0);
    // Os cosméticos só existem na lista de jogadores, para os clientes desenharem.
    expect(fancy.roster()[0]!.cosmetics).toMatchObject({ livery: 'vermelho' });
    expect(JSON.stringify(fancy.race)).not.toContain('vermelho');
  });
});

describe('validação das entradas', () => {
  function racing(): RaceSession {
    const session = new RaceSession(track, { ...quick, mode: 'private' });
    session.addPlayer('ana', 'Ana', {});
    session.setReady('ana', true);
    session.tick();
    return session;
  }

  it('limita a taxa: uma rajada de mensagens é descartada', () => {
    const session = racing();
    for (let seq = 0; seq < 5000; seq++)
      session.pushInput('ana', { seq, ...NO_INPUT, throttle: 1 });
    // Só passa a rajada permitida; a fila guarda as 8 mais recentes dela.
    session.tick();
    expect(session.snapshot('ana')!.ack).toBeLessThan(30);
    expect(session.kicked).toEqual(['ana']); // abuso sustentado: expulsão
  });

  it('descarta entradas inválidas, repetidas ou fora de ordem', () => {
    const session = racing();
    session.pushInput('ana', { seq: 5, steer: 99, throttle: Number.NaN, brake: -3, drift: 'sim' });
    session.pushInput('ana', { seq: 5, steer: 0, throttle: 1, brake: 0, drift: false }); // repetida
    session.pushInput('ana', { seq: 3, steer: 0, throttle: 1, brake: 0, drift: false }); // antiga
    session.pushInput('ana', 'lixo');
    session.pushInput('ana', { seq: -1 });
    session.pushInput('fantasma', { seq: 1, ...NO_INPUT });
    session.tick();
    expect(session.snapshot('ana')!.ack).toBe(5);
    // Mesmo com valores absurdos, o kart continua parado no grid durante as luzes.
    const kart = session.race!.karts[0]!;
    expect(Number.isFinite(kart.x)).toBe(true);
    expect(kart.vx).toBe(0);
  });

  it('o cliente não tem como informar posição, volta ou resultado', () => {
    const session = racing();
    const before = session.race!.karts[0]!;
    session.pushInput('ana', {
      seq: 1,
      ...NO_INPUT,
      x: 9999,
      z: 9999,
      vx: 500,
      lap: 3,
      finishTick: 1,
      position: 1,
    });
    session.tick();
    const after = session.race!;
    expect(after.karts[0]!.x).toBe(before.x);
    expect(after.progress[0]!.lap).toBe(0);
    expect(after.progress[0]!.finishTick).toBeNull();
    expect(session.results).toBeNull();
  });

  it('sem entradas novas, repete a última por um instante e depois solta os pedais', () => {
    const session = racing();
    const goTick = session.race!.goTick;
    for (let tick = 0; tick <= goTick + 30; tick++) {
      session.pushInput('ana', {
        seq: tick,
        steer: 0,
        throttle: tick > goTick ? 1 : 0,
        brake: 0,
        drift: false,
      });
      session.tick();
    }
    const moving = session.race!.karts[0]!.vx;
    expect(moving).toBeGreaterThan(1);
    run(session, 4); // a rede caiu: nenhuma entrada chega
    expect(session.race!.karts[0]!.vx).toBeLessThan(moving + 3); // não seguiu acelerando
    expect(session.snapshot('ana')!.ack).toBe(goTick + 30);
  });
});
