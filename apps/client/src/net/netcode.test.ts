import { describe, expect, it } from 'vitest';
import type { InputMessage, KartInput, KartState } from '@kart/shared';
import {
  createKartState,
  createTrackEnvironment,
  getCircuitoDaOrla,
  SIM_DT,
  SIM_HZ,
  step,
} from '@kart/shared';
import { INTERPOLATION_DELAY_SECONDS, SnapshotBuffer } from './interpolation';
import { LocalPredictor } from './prediction';

const track = getCircuitoDaOrla();
const environment = createTrackEnvironment(track);
const grid = track.grid[0]!;
const start = (): KartState => ({
  ...createKartState(grid.x, grid.z, grid.heading, grid.y),
  tireTemp: 1,
});
const command = (tick: number): KartInput => ({
  steer: Math.sin(tick * 0.04) * 0.4,
  throttle: 1,
  brake: 0,
  drift: false,
});

/**
 * Servidor de mentira com atraso de rede: processa cada entrada `delay` ticks
 * depois de enviada e devolve o estado com o mesmo atraso.
 */
function playWithLatency(delayTicks: number, seconds: number, serverNudge = 0) {
  const predictor = new LocalPredictor(start(), environment);
  let server = start();
  const toServer: { at: number; message: InputMessage }[] = [];
  const toClient: { at: number; state: KartState; ack: number }[] = [];
  let worstJump = 0;
  for (let tick = 0; tick < seconds * SIM_HZ; tick++) {
    const before = {
      x: predictor.state.x + predictor.offset.x,
      z: predictor.state.z + predictor.offset.z,
    };
    toServer.push({ at: tick + delayTicks, message: predictor.advance(command(tick), true) });
    while (toServer[0] && toServer[0].at <= tick) {
      const { message } = toServer.shift()!;
      server = step(server, message, SIM_DT, environment);
      // O servidor "discorda" um pouco (ex.: um toque que o cliente não previu).
      if (serverNudge && message.seq === 120) server = { ...server, x: server.x + serverNudge };
      if (message.seq % 2 === 1)
        toClient.push({ at: tick + delayTicks, state: server, ack: message.seq });
    }
    while (toClient[0] && toClient[0].at <= tick) {
      const snapshot = toClient.shift()!;
      predictor.reconcile(snapshot.state, snapshot.ack, true);
    }
    predictor.smooth(SIM_DT);
    const after = {
      x: predictor.state.x + predictor.offset.x,
      z: predictor.state.z + predictor.offset.z,
    };
    // Quanto a imagem do kart andou neste tick além do que a velocidade explica.
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    worstJump = Math.max(
      worstJump,
      moved - Math.hypot(predictor.state.vx, predictor.state.vy) * SIM_DT,
    );
  }
  return { predictor, server, worstJump };
}

describe('predição e reconciliação', () => {
  it('com 150 ms de latência o kart responde na hora e a predição bate com o servidor', () => {
    const delay = Math.round(0.075 * SIM_HZ); // 75 ms por sentido = 150 ms de ida e volta
    const { predictor, server } = playWithLatency(delay, 8);
    // Respondeu sem esperar a rede: já está à frente do que o servidor confirmou.
    expect(predictor.state.s).not.toBe(server.s);
    expect(predictor.pendingCount).toBeGreaterThanOrEqual(delay * 2 - 2);
    // Mesma física dos dois lados: nenhuma correção em 8 s de curva e aceleração.
    expect(predictor.corrections).toBe(0);
    expect(Math.hypot(predictor.offset.x, predictor.offset.z)).toBeLessThan(1e-6);
  });

  it('o estado previsto é exatamente o do servidor mais as entradas pendentes', () => {
    const predictor = new LocalPredictor(start(), environment);
    let server = start();
    const sent: InputMessage[] = [];
    for (let tick = 0; tick < 90; tick++) sent.push(predictor.advance(command(tick), true));
    for (const message of sent.slice(0, 60)) server = step(server, message, SIM_DT, environment);
    predictor.reconcile(server, 59, true);
    let expected = server;
    for (const message of sent.slice(60)) expected = step(expected, message, SIM_DT, environment);
    expect(predictor.state).toEqual(expected);
    expect(predictor.pendingCount).toBe(30);
  });

  it('quando o servidor discorda, a correção é suavizada em vez de teletransportar', () => {
    const { predictor, worstJump } = playWithLatency(5, 6, 0.8);
    expect(predictor.corrections).toBeGreaterThan(0);
    expect(predictor.lastError).toBeGreaterThan(0.5);
    // Um erro de 0,8 m foi absorvido aos poucos: nenhum quadro pulou mais que ~20 cm.
    expect(worstJump).toBeLessThan(0.2);
    expect(Math.hypot(predictor.offset.x, predictor.offset.z)).toBeLessThan(0.02);
  });

  it('reposicionamento do servidor (erro grande) é aplicado de uma vez', () => {
    const predictor = new LocalPredictor(start(), environment);
    for (let tick = 0; tick < 30; tick++) predictor.advance(command(tick), true);
    const far = { ...start(), x: grid.x + 50 };
    predictor.reconcile(far, 29, true);
    expect(predictor.state.x).toBeCloseTo(far.x, 6);
    expect(predictor.offset.x).toBe(0);
  });

  it('durante as luzes da largada o kart não é previsto', () => {
    const predictor = new LocalPredictor(start(), environment);
    for (let tick = 0; tick < 30; tick++) predictor.advance(command(tick), false);
    expect(predictor.state.x).toBe(grid.x);
    expect(predictor.pendingCount).toBe(30);
  });
});

describe('interpolação dos outros karts', () => {
  const at = (tick: number, x: number, vx = 0): KartState => ({
    ...createKartState(x, 0, Math.PI / 2),
    vx,
  });

  it('desenha entre dois snapshots, sem pular', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(10, [at(10, 0)]);
    buffer.push(12, [at(12, 2)]);
    buffer.push(14, [at(14, 4)]);
    expect(buffer.sample(0, 11)!.x).toBeCloseTo(1, 6);
    expect(buffer.sample(0, 13.5)!.x).toBeCloseTo(3.5, 6);
    // Varrendo o tempo em passos pequenos, a posição nunca dá salto.
    let previous = buffer.sample(0, 10)!.x;
    for (let tick = 10; tick <= 14; tick += 0.1) {
      const x = buffer.sample(0, tick)!.x;
      expect(Math.abs(x - previous)).toBeLessThan(0.11);
      previous = x;
    }
  });

  it('o atraso de exibição é de 100 ms', () => {
    expect(INTERPOLATION_DELAY_SECONDS).toBe(0.1);
  });

  it('sem snapshot novo, extrapola por pouco tempo e depois para', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(10, [at(10, 0, 20)]); // 20 m/s para +X
    const soon = buffer.sample(0, 10 + 0.1 * SIM_HZ)!;
    expect(soon.x).toBeCloseTo(2, 6);
    const late = buffer.sample(0, 10 + 2 * SIM_HZ)!;
    expect(late.x).toBeCloseTo(20 * 0.15, 6); // no máximo 150 ms de extrapolação
  });

  it('ignora snapshots atrasados ou repetidos e não desliza num reposicionamento', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(10, [at(10, 0)]);
    buffer.push(12, [at(12, 2)]);
    buffer.push(11, [at(11, 99)]);
    expect(buffer.newestTick).toBe(12);
    expect(buffer.sample(0, 11)!.x).toBeCloseTo(1, 6);
    buffer.push(14, [at(14, 60)]); // reposicionado longe
    expect(buffer.sample(0, 13)!.x).toBe(60);
    expect(buffer.sample(1, 13)).toBeNull(); // vaga que não existe
  });
});
