import type { BotDriver, BotPersonality, KartInput, KartState, RaceState } from '@kart/shared';
import {
  applyAssists,
  botInput,
  createBotContext,
  createBotDriver,
  createBotPlan,
  createRace,
  describeBot,
  driveBot,
  NO_INPUT,
  RACE_RULES,
  SIM_DT,
  standings,
  startLights,
  stepRace,
  updateBotContext,
} from '@kart/shared';
import { loadLoadout, sampleLoadout } from '../cosmetics/catalog';
import { loadPaint } from '../cosmetics/paint';
import { RaceView } from '../game/raceView';
import { Controls } from '../input/controls';
import { createHud, formatTime } from '../ui/hud';
import type { AppContext, GameScreen } from './types';

const BEST_LAP_KEY = 'kart-online.melhor-volta';
const MAX_STEPS_PER_FRAME = 5;

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Voltas da corrida contra os bots. */
const BOT_RACE_LAPS = 3;

const rival = (
  name: string,
  skill: number,
  style: string,
  aggression: number,
  consistency: number,
  defense: number,
  tireCare: number,
  reactionTicks: number,
): { name: string; skill: number; personality: BotPersonality } => ({
  name,
  skill,
  personality: { aggression, consistency, defense, tireCare, reactionTicks, style },
});

/** Os 7 rivais do Treino: um de cada estilo, para o jogador sentir a diferença. */
const RIVALS = [
  rival('Faísca', 0.86, 'Agressivo: mergulha por dentro', 0.95, 0.55, 0.45, 0.35, 12),
  rival('Muralha', 0.8, 'Muralha: fecha a porta', 0.45, 0.75, 0.97, 0.6, 16),
  rival('Relógio', 0.78, 'Constante: quase nunca erra', 0.4, 0.97, 0.55, 0.7, 14),
  rival('Largada', 0.72, 'Largador: reage rápido no verde', 0.7, 0.6, 0.6, 0.3, 6),
  rival('Pneu', 0.7, 'Técnico: cuida dos pneus', 0.5, 0.8, 0.5, 0.95, 15),
  rival('Zebra', 0.64, 'Equilibrado', 0.6, 0.65, 0.6, 0.6, 13),
  rival('Novato', 0.5, 'Novato: erra sob pressão', 0.75, 0.35, 0.35, 0.3, 20),
];

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
  const controls = new Controls({
    touchExtras: [
      { label: '↻', title: 'Recomeçar', run: () => restart() },
      { label: 'Bots', title: 'Correr contra 7 bots', run: () => toggleBots() },
      {
        label: 'Menu',
        title: 'Voltar ao menu',
        run: () => {
          window.location.hash = 'menu';
        },
      },
    ],
  });
  controls.setTouchVisible(true);
  const hud = createHud(context.ui, track);
  if (!controls.hasTouch) {
    hud.setHelp(
      'W/↑ acelera · S/↓ freia e dá ré · A D/← → vira · Espaço drift · Shift olha para trás · R recomeça · B corrida contra 7 bots · P piloto automático · M som · F3 bots · Esc menu',
    );
  }

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
  // Corrida contra 7 bots (tecla B): o jogador larga em último e precisa ultrapassar.
  let withBots = false;
  let me = 0;
  let drivers: (BotDriver | null)[] = [];
  let previousKarts: readonly KartState[] = [];
  let finishedShown = false;
  const botContext = createBotContext(8);

  const restart = (): void => {
    const seed = Math.floor(Math.random() * 1e9);
    race = createRace(track, {
      karts: withBots ? RIVALS.length + 1 : 1,
      laps: withBots ? BOT_RACE_LAPS : 0,
      seed,
    });
    me = withBots ? RIVALS.length : 0;
    drivers = race.karts.map((_, i) => {
      if (!withBots || i === me) return null;
      const entry = RIVALS[i] as (typeof RIVALS)[number];
      return createBotDriver(track, race, i, entry.skill, { seed, personality: entry.personality });
    });
    previousKarts = race.karts;
    finishedShown = false;
    previous = race.karts[me] as KartState;
    input = NO_INPUT;
    accumulator = 0;
    lights = -1;
    lastLap = null;
    view.resetCamera();
    hud.say(withBots ? 'Corrida contra 7 bots: espere o verde' : 'Espere o sinal verde', 4, clock);
    loadRoster();
  };

  /** Visual de cada kart: o do jogador e um visual de amostra para cada bot. */
  const loadRoster = (): void => {
    const loadouts = race.karts.map((_, i) => (i === me ? loadLoadout() : sampleLoadout(i)));
    const paints = race.karts.map((_, i) => (i === me ? loadPaint() : null));
    view.setRoster(loadouts, me, paints).catch((erro: unknown) => {
      console.error(erro);
      context.setStatus('Não foi possível carregar o kart. Rode "pnpm assets" e recarregue.', true);
    });
  };

  const toggleBots = (): void => {
    withBots = !withBots;
    context.setStatus(
      withBots
        ? `Treino contra 7 bots · ${track.definition.name}`
        : `Treino solo · ${track.definition.name}`,
    );
    restart();
  };

  // Painel F3: estado de cada bot (modo, alvo, erro) e a personalidade.
  const botPanel = document.createElement('pre');
  botPanel.className = 'depuracao';
  botPanel.hidden = true;
  context.ui.append(botPanel);
  let panelFrame = 0;
  const updateBotPanel = (): void => {
    if (botPanel.hidden || ++panelFrame % 15 !== 0) return;
    const order = standings(race, track);
    botPanel.textContent = order
      .map((kart, position) => {
        const driver = drivers[kart];
        if (!driver) return `${position + 1}º  Você`;
        const entry = RIVALS[kart] as (typeof RIVALS)[number];
        return `${position + 1}º  ${entry.name.padEnd(8)} ${describeBot(driver).padEnd(26)} ${entry.personality.style}`;
      })
      .join('\n');
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    audio.unlock();
    if (event.repeat) return;
    if (event.code === 'KeyR') restart();
    else if (event.code === 'KeyB') toggleBots();
    else if (event.code === 'F3' && withBots) {
      event.preventDefault();
      botPanel.hidden = !botPanel.hidden;
    } else if (event.code === 'KeyM') {
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

  /** Um tick da simulação, com os eventos que a interface e o áudio acompanham. */
  const tick = (): void => {
    const state = controls.read();
    const kart = race.karts[me] as KartState;
    if (autopilot) {
      // Demonstração: o mesmo piloto automático dos bots, com as mesmas entradas de um jogador.
      input = race.tick < race.goTick ? NO_INPUT : botInput(kart, track, botPlan);
    } else {
      input = applyAssists(input, state.raw, kart, SIM_DT, state.assists);
    }
    previous = kart;
    previousKarts = race.karts;
    const before = race.progress[me];
    let inputs: KartInput[] = [input];
    if (withBots) {
      updateBotContext(botContext, race, track);
      inputs = race.karts.map((_, i) => {
        const driver = drivers[i];
        return driver ? { ...driveBot(driver, race, track, botContext) } : input;
      });
    }
    race = stepRace(race, inputs, track, environment);
    const after = race.progress[me];
    const now = race.karts[me] as KartState;
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
    if (withBots && after.finishTick !== null && !finishedShown) {
      finishedShown = true;
      const position = standings(race, track).indexOf(me) + 1;
      hud.say(`Você terminou em ${position}º! R corre de novo`, 8, clock);
    }
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
      const kart = race.karts[me] as KartState;
      const alpha = accumulator / SIM_DT;
      const mix = (a: number, b: number): number => a + (b - a) * alpha;
      const racing = race.tick > race.goTick;
      const frames = race.karts.map((current, i) => {
        const before = (i === me ? previous : previousKarts[i]) ?? current;
        const teleported = Math.hypot(current.x - before.x, current.z - before.z) > 3;
        const from = teleported ? current : before;
        return {
          state: current,
          x: mix(from.x, current.x),
          y: mix(from.y, current.y),
          z: mix(from.z, current.z),
          heading: from.heading + wrapAngle(current.heading - from.heading) * alpha,
          throttle: i === me ? input.throttle : (drivers[i]?.input.throttle ?? 0),
        };
      });
      view.render(delta, time, frames, me, controls.read().lookBack, racing);
      updateBotPanel();
      screen.motionBlur = view.motionBlur;

      const progress = race.progress[me];
      if (!progress) return;
      const position = withBots ? standings(race, track).indexOf(me) + 1 : 0;
      hud.update(
        {
          positionText: withBots ? `${position}/${race.karts.length}` : '',
          lapText:
            progress.lap === 0
              ? withBots
                ? 'Largada'
                : 'Volta de saída'
              : withBots
                ? `Volta ${Math.min(progress.lap, BOT_RACE_LAPS)}/${BOT_RACE_LAPS}`
                : `Volta ${progress.lap}`,
          currentTicks: racing ? race.tick - progress.lapStartTick : 0,
          lastTicks: lastLap,
          bestTicks: bestLap,
          speed: kart.vx,
          rpm: kart.rpm,
          tireTemp: kart.tireTemp,
          offTrack: kart.surface === 'grass' || kart.surface === 'gravel',
          dots: race.karts.map((other, i) => ({ x: other.x, z: other.z, own: i === me })),
        },
        time,
      );
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      botPanel.remove();
      hud.dispose();
      context.ui.replaceChildren();
      view.dispose();
    },
  };
  return screen;
}
