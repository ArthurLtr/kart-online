// Teste de fumaça da rede: 9 clientes de verdade (colyseus.js) entram numa sala
// privada, correm 1 volta dirigidos pelo piloto automático e conferem que a
// classificação veio do servidor. Exige o servidor rodando (pnpm dev).
// Uso: node tools/net-smoke.mjs [ws://localhost:2567]
/* global setInterval, clearInterval */
import { Client } from 'colyseus.js';
import * as kart from '../packages/shared/dist/index.js';

const url = process.argv[2] ?? `ws://localhost:${kart.SERVER_DEFAULT_PORT}`;
const track = kart.getCircuitoDaOrla();
const PLAYERS = 9;
const TIMEOUT_MS = 6 * 60 * 1000;

function pilot(room, index) {
  const plan = kart.createBotPlan(track, 0.45 + index * 0.05);
  const state = { you: -1, snapshot: null, seq: 0, results: null, phases: [] };
  room.onMessage(kart.MESSAGES.room, (message) => {
    state.you = message.you;
    if (state.phases.at(-1) !== message.phase) state.phases.push(message.phase);
    if (message.results) state.results = message.results;
  });
  room.onMessage(kart.MESSAGES.snapshot, (message) => {
    state.snapshot = message;
  });
  room.onMessage(kart.MESSAGES.pong, () => {});
  // Uma entrada por tick de simulação, como o jogo faz.
  const timer = setInterval(() => {
    const snapshot = state.snapshot;
    const own = snapshot?.karts[state.you];
    if (!snapshot || !own) return;
    const input = snapshot.tick < snapshot.goTick ? kart.NO_INPUT : kart.botInput(own, track, plan);
    room.send(kart.MESSAGES.input, { seq: state.seq++, ...input });
  }, 1000 / kart.SIM_HZ);
  return { state, stop: () => clearInterval(timer) };
}

const first = await new Client(url).create(kart.ROOM_NAME, { name: 'Piloto 1', mode: 'private' });
const rooms = [first];
for (let i = 1; i < PLAYERS; i++) {
  rooms.push(
    await new Client(url).joinById(first.roomId, { name: `Piloto ${i + 1}`, mode: 'private' }),
  );
}
console.log(`${rooms.length} clientes na sala ${first.roomId}`);

// A décima pessoa não cabe.
let tenthRejected = false;
try {
  const extra = await new Client(url).joinById(first.roomId, { name: 'Décimo', mode: 'private' });
  await extra.leave();
} catch {
  tenthRejected = true;
}

const pilots = rooms.map((room, i) => pilot(room, i));
for (const room of rooms) room.send(kart.MESSAGES.ready, { ready: true });

const started = Date.now();
await new Promise((resolve, reject) => {
  const check = setInterval(() => {
    if (pilots.every((p) => p.state.results)) {
      clearInterval(check);
      resolve();
    } else if (Date.now() - started > TIMEOUT_MS) {
      clearInterval(check);
      reject(new Error('tempo esgotado esperando o resultado'));
    }
  }, 250);
});

const results = pilots[0].state.results;
console.log(
  `corrida de ${((Date.now() - started) / 1000).toFixed(0)} s. Classificação do servidor:`,
);
for (const r of results) {
  const time =
    r.timeTicks === null ? 'não terminou' : `${(r.timeTicks / kart.SIM_HZ).toFixed(2)} s`;
  console.log(`  ${r.position}º ${r.name.padEnd(10)} ${time}`);
}

const problems = [];
if (!tenthRejected) problems.push('o décimo jogador conseguiu entrar');
if (results.length !== PLAYERS) problems.push(`resultado com ${results.length} karts`);
if (new Set(results.map((r) => r.slot)).size !== PLAYERS) problems.push('vagas repetidas');
if (!results.every((r) => r.finished)) problems.push('alguém não terminou');
const same = pilots.every((p) => JSON.stringify(p.state.results) === JSON.stringify(results));
if (!same) problems.push('clientes receberam classificações diferentes');
const times = results.map((r) => r.timeTicks);
if (times.some((t, i) => i > 0 && t < times[i - 1])) problems.push('classificação fora de ordem');
if (!pilots.every((p) => p.state.phases.join('>').startsWith('lobby>race>results'))) {
  problems.push(`ciclo inesperado: ${pilots[0].state.phases.join('>')}`);
}

for (const p of pilots) p.stop();
await Promise.all(rooms.map((room) => room.leave()));
if (problems.length > 0) {
  console.error('FALHOU:', problems.join('; '));
  process.exit(1);
}
console.log('OK: 9 clientes correram juntos e o servidor decidiu a classificação.');
process.exit(0);
