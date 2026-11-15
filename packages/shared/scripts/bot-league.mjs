// Campeonato de teste dos bots: N corridas com 8 bots, sem humano, semente fixa.
// Mede ultrapassagens, batidas causadas por bot, se a chegada repete o grid,
// onde termina o mais habilidoso e o custo de CPU da IA.
// Uso: pnpm --filter @kart/shared build && node packages/shared/scripts/bot-league.mjs [corridas] [ia]
//   ia = "nova" (padrão) ou "antiga" (o botInput de antes, para comparar)
import { performance } from 'node:perf_hooks';
import {
  botInput,
  createBotDriver,
  createBotContext,
  createBotPlan,
  createRace,
  createTrackEnvironment,
  driveBot,
  getCircuitoDaOrla,
  initPhysics,
  NO_INPUT,
  stepRace,
  updateBotContext,
} from '../dist/index.js';

const RACES = Number(process.argv[2] ?? 20);
const MODE = process.argv[3] ?? 'nova';
const KARTS = 8;
const LAPS = 3;
const SKILLS = [0.3, 0.39, 0.47, 0.56, 0.64, 0.73, 0.81, 0.9];

await initPhysics();
const track = getCircuitoDaOrla();
const environment = createTrackEnvironment(track);

function shuffle(values, seed) {
  const out = [...values];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function runRace(seed, mode = MODE) {
  const skills = shuffle(SKILLS, seed * 977 + 13);
  let race = createRace(track, { karts: KARTS, laps: LAPS, seed });
  const drivers = skills.map((skill, i) => createBotDriver(track, race, i, skill, { seed }));
  const plans = skills.map((skill) => createBotPlan(track, skill));
  const ctx = createBotContext(KARTS);
  let overtakes = 0;
  let crashes = 0;
  let touches = 0;
  let spins = 0;
  const spinning = new Uint8Array(KARTS);
  const lastHit = new Int32Array(KARTS).fill(-999);
  // Ordem de cada par de karts: ultrapassagem só conta se durar 2 s (lado a lado não conta).
  const order = new Int8Array(KARTS * KARTS);
  const flipAt = new Int32Array(KARTS * KARTS).fill(-1);
  let aiTime = 0;
  let aiTicks = 0;
  const limit = race.goTick + 60 * 60 * 6;
  while (race.phase !== 'finished' && race.tick < limit) {
    updateBotContext(ctx, race, track);
    const t0 = performance.now();
    const inputs = race.karts.map((kart, i) => {
      if (race.tick < race.goTick) return NO_INPUT;
      if (mode === 'antiga') return { ...botInput(kart, track, plans[i]) };
      return { ...driveBot(drivers[i], race, track, ctx) };
    });
    aiTime += performance.now() - t0;
    aiTicks++;
    const before = race;
    race = stepRace(race, inputs, track, environment);
    updateBotContext(ctx, race, track);
    if (race.tick > race.goTick + 300) {
      for (let i = 0; i < KARTS; i++) {
        for (let j = i + 1; j < KARTS; j++) {
          if (ctx.finished[i] || ctx.finished[j]) continue;
          const k = i * KARTS + j;
          const now = ctx.dist[i] > ctx.dist[j] ? 1 : -1;
          if (order[k] === 0) order[k] = now;
          else if (now !== order[k]) {
            if (flipAt[k] < 0) flipAt[k] = race.tick;
            else if (race.tick - flipAt[k] >= 120) {
              overtakes++;
              order[k] = now;
              flipAt[k] = -1;
            }
          } else flipAt[k] = -1;
        }
      }
      // Rodada: deriva lateral forte (conta uma vez por rodada).
      for (let i = 0; i < KARTS; i++) {
        if (ctx.finished[i]) continue;
        const now = Math.abs(race.karts[i].vy) > 7 ? 1 : 0;
        if (now && !spinning[i]) {
          spins++;
          if (process.env.LOG_SPIN) {
            const d = drivers[i];
            console.log(
              `  rodada kart${i} skill=${d.skill} modo=${d.mode} erro=${d.errorKind}/${d.errorTicks} impacto=${race.karts[i].impact.toFixed(1)} sup=${race.karts[i].surface} v=${Math.hypot(race.karts[i].vx, race.karts[i].vy).toFixed(1)} t=${((race.tick - race.goTick) / 60).toFixed(1)}`,
            );
          }
        }
        spinning[i] = now;
      }
      // Batida causada: o kart bate e há alguém logo à frente na mesma faixa.
      for (let i = 0; i < KARTS; i++) {
        const kart = race.karts[i];
        // Quem já terminou não pilota mais (a física freia sozinha): não é decisão do bot.
        if (ctx.finished[i] || kart.impact < 2 || race.tick - lastHit[i] < 90) continue;
        for (let j = 0; j < KARTS; j++) {
          if (j === i) continue;
          const gap = ctx.dist[j] - ctx.dist[i];
          const side = Math.abs(ctx.d[j] - ctx.d[i]);
          if (gap > 0.3 && gap < 3.2 && side < 1.4) {
            // Traseira (quase alinhado) = batida causada; meio de lado = toque de disputa.
            if (side < 0.9) crashes++;
            else touches++;
            lastHit[i] = race.tick;
            if (process.env.LOG_CRASH) {
              console.log(
                `  batida t=${((race.tick - race.goTick) / 60).toFixed(1)}s kart${i}(${drivers[i].mode}) em kart${j}(${drivers[j].mode}) gap=${gap.toFixed(1)} dd=${(ctx.d[j] - ctx.d[i]).toFixed(1)} v=${ctx.speed[i].toFixed(1)}/${ctx.speed[j].toFixed(1)} impacto=${kart.impact.toFixed(1)}`,
              );
            }
            break;
          }
        }
      }
    }
    void before;
  }
  const finishOrder = race.progress
    .map((p, i) => ({ i, t: p.finishTick ?? Infinity, dist: ctx.dist[i] }))
    .sort((a, b) => a.t - b.t || b.dist - a.dist)
    .map((entry) => entry.i);
  const best = skills.indexOf(Math.max(...skills));
  return {
    overtakes,
    crashes,
    touches,
    spins,
    sameAsGrid: finishOrder.every((kart, position) => kart === position),
    bestPosition: finishOrder.indexOf(best) + 1,
    finished: race.progress.filter((p) => p.finishTick != null).length,
    msPerTick: aiTime / aiTicks,
    finishOrder,
    skills,
  };
}

if (
  import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
  process.argv[1].endsWith('bot-league.mjs')
) {
  const rows = [];
  const started = performance.now();
  for (let r = 0; r < RACES; r++) {
    const result = runRace(1000 + r);
    rows.push(result);
    console.log(
      `corrida ${String(r + 1).padStart(2)}: ${String(result.overtakes).padStart(3)} ultrap. · ` +
        `${result.crashes} batidas · melhor piloto em ${result.bestPosition}º · ` +
        `${result.finished}/8 terminaram${result.sameAsGrid ? ' · IGUAL AO GRID' : ''}`,
    );
  }
  const avg = (key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  const top3 = rows.filter((row) => row.bestPosition <= 3).length / rows.length;
  console.log('\n=== IA ' + MODE + ' · ' + RACES + ' corridas ===');
  console.log(`ultrapassagens por corrida: ${avg('overtakes').toFixed(1)}`);
  console.log(`batidas de traseira causadas por bot por corrida: ${avg('crashes').toFixed(2)}`);
  console.log(`toques laterais em disputa por corrida: ${avg('touches').toFixed(2)}`);
  console.log(`rodadas por corrida: ${avg('spins').toFixed(2)}`);
  console.log(`corridas com chegada igual ao grid: ${rows.filter((r) => r.sameAsGrid).length}`);
  console.log(`mais habilidoso no pódio: ${(top3 * 100).toFixed(0)}%`);
  console.log(`terminaram (média): ${avg('finished').toFixed(1)}/8`);
  console.log(`IA: ${(avg('msPerTick') * 1000).toFixed(1)} µs por tick para 8 bots`);
  console.log(`tempo total: ${((performance.now() - started) / 1000).toFixed(0)} s`);
}
