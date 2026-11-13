import type { KartInput, KartState, RaceState } from '@kart/shared';
import {
  applyAssists,
  botInput,
  createBotPlan,
  createRace,
  NO_INPUT,
  RACE_RULES,
  SIM_DT,
  startLights,
  stepRace,
} from '@kart/shared';
import { loadLoadout } from '../cosmetics/catalog';
import { loadPaint } from '../cosmetics/paint';
import { RaceView } from '../game/raceView';
import { Controls } from '../input/controls';
import { createHud, formatTime } from '../ui/hud';
import type { AppContext, GameScreen } from './types';

const BEST_LAP_KEY = 'kart-online.melhor-volta';
const MAX_STEPS_PER_FRAME = 5;

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

function readBestLap(): number | null {
  try {
    const value = Number(localStorage.getItem(BEST_LAP_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Treino solo: o jogador sozinho na pista, contra o relógio. Roda a mesma
 * simulação de @kart/shared que o servidor roda, em passo fixo de 60 Hz, e
 * desenha interpolando entre dois ticks.
 */
export function createTrainingScreen(context: AppContext): GameScreen {
  const view = new RaceView(context);
  const { track, environment, audio } = view;
  const controls = new Controls();
  const hud = createHud(context.ui, track);
  hud.setHelp(
    'W/↑ acelera · S/↓ freia e dá ré · A D/← → vira · Espaço drift · Shift olha para trás · R recomeça · P piloto automático · M som · Esc menu',
  );

  let race: RaceState;
  let previous: KartState;
  let input: KartInput = NO_INPUT;
  let accumulator = 0;
  let lights = -1;
  let lastLap: number | null = null;
  let bestLap = readBestLap();
  let autopilot = false;
  let clock = 0;
  const botPlan = createBotPlan(track, 0.8);

  const restart = (): void => {
    race = createRace(track, { karts: 1, laps: 0, seed: Math.floor(Math.random() * 1e9) });
    previous = race.karts[0] as KartState;
    input = NO_INPUT;
    accumulator = 0;
    lights = -1;
    lastLap = null;
    view.resetCamera();
    hud.say('Espere o sinal verde', 4, clock);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    audio.unlock();
    if (event.repeat) return;
    if (event.code === 'KeyR') restart();
    else if (event.code === 'KeyM') {
      hud.say(audio.toggleMute() ? 'Som desligado' : 'Som ligado', 1.5, clock);
    } else if (event.code === 'KeyP') {
      autopilot = !autopilot;
      hud.say(autopilot ? 'Piloto automático ligado' : 'Você no controle', 2, clock);
    } else if (event.code === 'Escape') {
      window.location.hash = 'menu';
    }
  };
  const onPointerDown = (): void => audio.unlock();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerdown', onPointerDown);

  restart();
  context.setStatus(`Treino solo · ${track.definition.name}`);
  view.setRoster([loadLoadout()], 0, [loadPaint()]).catch((erro: unknown) => {
    console.error(erro);
    context.setStatus('Não foi possível carregar o kart. Rode "pnpm assets" e recarregue.', true);
  });

  /** Um tick da simulação, com os eventos que a interface e o áudio acompanham. */
  const tick = (): void => {
    const state = controls.read();
    const kart = race.karts[0] as KartState;
    if (autopilot) {
      // Demonstração: o mesmo piloto automático dos bots, com as mesmas entradas de um jogador.
      input = race.tick < race.goTick ? NO_INPUT : botInput(kart, track, botPlan);
    } else {
      input = applyAssists(input, state.raw, kart, SIM_DT, state.assists);
    }
    previous = kart;
    const before = race.progress[0];
    race = stepRace(race, [input], track, environment);
    const after = race.progress[0];
    const now = race.karts[0] as KartState;
    if (!before || !after) return;

    const lit = startLights(race);
    const go = race.tick >= race.goTick;
    if (lit !== lights) {
      if (lit > lights && lights >= 0) audio.beep(false);
      if (lit === 0 && lights === RACE_RULES.lights) {
        audio.beep(true);
        hud.say('Valendo!', 1.5, clock);
      }
      lights = lit;
      view.setLights(lit, go);
    }
    if (after.jumpStart && !before.jumpStart) hud.say('Queimou a largada: +3 s', 4, clock);
    if (after.resets !== before.resets) {
      view.resetCamera();
      hud.say('Reposicionado na pista', 2, clock);
    }
    if (after.lastLapTicks !== null && after.lapStartTick !== before.lapStartTick) {
      // A punição da largada queimada entra na primeira volta cronometrada.
      lastLap = after.lastLapTicks + (before.lap === 1 ? after.penaltyTicks : 0);
      if (bestLap === null || lastLap < bestLap) {
        bestLap = lastLap;
        try {
          localStorage.setItem(BEST_LAP_KEY, String(bestLap));
        } catch {
          // Sem armazenamento: o recorde vale só nesta sessão.
        }
        hud.say(`Melhor volta: ${formatTime(lastLap)}`, 4, clock);
      } else {
        hud.say(`Volta: ${formatTime(lastLap)}`, 3, clock);
      }
    }
    if (now.impact > 2) audio.impact(now.impact);
  };

  const screen: GameScreen = {
    scene: view.scene,
    camera: view.camera,
    motionBlur: 0,
    update(delta, time) {
      clock = time;
      accumulator = Math.min(accumulator + delta, SIM_DT * MAX_STEPS_PER_FRAME);
      while (accumulator >= SIM_DT) {
        tick();
        accumulator -= SIM_DT;
      }

      // Desenha entre o tick anterior e o atual, para o movimento ficar liso em qualquer taxa de quadros.
      const kart = race.karts[0] as KartState;
      const alpha = accumulator / SIM_DT;
      const teleported = Math.hypot(kart.x - previous.x, kart.z - previous.z) > 3;
      const from = teleported ? kart : previous;
      const mix = (a: number, b: number): number => a + (b - a) * alpha;
      const racing = race.tick > race.goTick;
      view.render(
        delta,
        time,
        [
          {
            state: kart,
            x: mix(from.x, kart.x),
            y: mix(from.y, kart.y),
            z: mix(from.z, kart.z),
            heading: from.heading + wrapAngle(kart.heading - from.heading) * alpha,
            throttle: input.throttle,
          },
        ],
        0,
        controls.read().lookBack,
        racing,
      );
      screen.motionBlur = view.motionBlur;

      const progress = race.progress[0];
      if (!progress) return;
      hud.update(
        {
          positionText: '',
          lapText: progress.lap === 0 ? 'Volta de saída' : `Volta ${progress.lap}`,
          currentTicks: racing ? race.tick - progress.lapStartTick : 0,
          lastTicks: lastLap,
          bestTicks: bestLap,
          speed: kart.vx,
          rpm: kart.rpm,
          tireTemp: kart.tireTemp,
          offTrack: kart.surface === 'grass' || kart.surface === 'gravel',
          dots: [{ x: kart.x, z: kart.z, own: true }],
        },
        time,
      );
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      hud.dispose();
      context.ui.replaceChildren();
      view.dispose();
    },
  };
  return screen;
}
