// Relatório rápido da física para afinar tuning.ts.
// Uso: pnpm --filter @kart/shared build && node tools/sim-report.mjs
import * as sim from '../packages/shared/dist/index.js';

const DT = sim.SIM_DT;
const HZ = sim.SIM_HZ;
const full = { steer: 0, throttle: 1, brake: 0, drift: false };
const warm = (speed) => ({ ...sim.createKartState(0, 0, 0), vx: speed, tireTemp: 1 });

// Velocidade máxima e 0-100
let k = warm(0);
let t100 = null;
for (let i = 0; i < 40 * HZ; i++) {
  k = sim.step(k, full, DT);
  if (t100 === null && k.vx * 3.6 >= 100) t100 = i / HZ;
}
console.log(
  `máxima ${(k.vx * 3.6).toFixed(1)} km/h a ${k.rpm.toFixed(0)} rpm · 0-100 em ${t100?.toFixed(2)} s`,
);

// Largada com pneus frios, por acelerador
for (const throttle of [1, 0.95, 0.9, 0.85, 0.8, 0.7]) {
  let g = sim.createKartState(0, 0, 0);
  let spin = 0;
  for (let i = 0; i < 2.5 * HZ; i++) {
    g = sim.step(g, { ...full, throttle }, DT);
    spin = Math.max(spin, g.wheelSlip);
  }
  console.log(
    `largada ${throttle.toFixed(2)}: ${g.z.toFixed(2)} m em 2,5 s · patinagem máx ${spin.toFixed(2)}`,
  );
}

// Curva em regime: aceleração lateral por esterço a 60 km/h
for (const steer of [0.2, 0.4, 0.6, 1]) {
  let c = warm(60 / 3.6);
  for (let i = 0; i < 4 * HZ; i++)
    c = sim.step(c, { steer, throttle: 0.5, brake: 0, drift: false }, DT);
  const lateral = (c.yawRate * c.vx) / 9.81;
  console.log(
    `esterço ${steer}: ${lateral.toFixed(2)} g · ${(Math.hypot(c.vx, c.vy) * 3.6).toFixed(0)} km/h · deriva traseira ${c.rearSlide.toFixed(2)}`,
  );
}

// Volta do bot
const track = sim.getCircuitoDaOrla();
const env = sim.createTrackEnvironment(track);
for (const skill of [0.3, 0.8, 1]) {
  const plan = sim.createBotPlan(track, skill);
  let race = sim.createRace(track, { karts: 1, laps: 3, seed: 3 });
  for (let i = 0; i < HZ * 300 && race.phase !== 'finished'; i++) {
    const input = race.tick < race.goTick ? sim.NO_INPUT : sim.botInput(race.karts[0], track, plan);
    race = sim.stepRace(race, [input], track, env);
  }
  const p = race.progress[0];
  console.log(
    `bot ${skill}: ${race.phase} · melhor volta ${p.bestLapTicks ? (p.bestLapTicks / HZ).toFixed(2) : '-'} s · reposicionamentos ${p.resets}`,
  );
}
