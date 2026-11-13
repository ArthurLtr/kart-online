import type {
  Cosmetics,
  KartInput,
  KartState,
  RoomMessage,
  RoomMode,
  RoomPhase,
  SnapshotMessage,
} from '@kart/shared';
import {
  applyAssists,
  NET_TICK_HZ,
  NO_INPUT,
  RACE_RULES,
  SIM_DT,
  SIM_HZ,
  standings,
  startLights,
} from '@kart/shared';
import type { Loadout } from '../cosmetics/catalog';
import type { QueueStatus } from '@kart/shared';
import { queue, refreshAccount, sessionToken } from '../net/account';
import { getSettings } from '../settings';
import { createNameTags } from '../ui/nameTags';
import type { PlayIntent } from './menuScreen';
import { takePlayIntent } from './menuScreen';
import { CATALOG, DEFAULT_LOADOUT, loadLoadout, sampleLoadout } from '../cosmetics/catalog';
import type { KartFrame } from '../game/raceView';
import { RaceView } from '../game/raceView';
import { Controls } from '../input/controls';
import { Connection } from '../net/connection';
import { INTERPOLATION_DELAY_SECONDS, SnapshotBuffer } from '../net/interpolation';
import { LocalPredictor } from '../net/prediction';
import { createDebugPanel } from '../ui/debugPanel';
import { createHud, formatTime } from '../ui/hud';
import type { AppContext, GameScreen } from './types';
import { button } from './types';

const NAME_KEY = 'kart-online.apelido';
const MAX_STEPS_PER_FRAME = 5;
const ORDINALS = ['1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º'];

/** Cosméticos recebidos da rede: só valem ids que existem no catálogo deste cliente. */
function toLoadout(cosmetics: Cosmetics | null, slot: number): Loadout {
  if (!cosmetics) return sampleLoadout(slot); // bots variam pelo número da vaga
  const loadout = { ...DEFAULT_LOADOUT };
  for (const key of Object.keys(loadout) as (keyof Loadout)[]) {
    const id = cosmetics[key];
    if (id && CATALOG[key].some((item) => item.id === id)) loadout[key] = id;
  }
  return loadout;
}

function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Corrida online: lobby → corrida → resultado → pódio. O servidor simula e
 * decide tudo; aqui o kart do jogador é previsto localmente e reconciliado, e
 * os outros são interpolados com 100 ms de atraso.
 */
export function createOnlineScreen(context: AppContext): GameScreen {
  const view = new RaceView(context);
  const { track, environment, audio } = view;
  const controls = new Controls();
  const buffer = new SnapshotBuffer();
  let disposed = false;
  let clock = 0;

  // --- estado de rede --------------------------------------------------------
  let room: RoomMessage | null = null;
  let phase: RoomPhase | 'menu' | 'connecting' = 'menu';
  let snapshot: SnapshotMessage | null = null;
  let predictor: LocalPredictor | null = null;
  let input: KartInput = NO_INPUT;
  let accumulator = 0;
  let lights = -1;
  /** Tick do servidor estimado para "agora" (fracionário), para interpolar os outros karts. */
  let serverTick = 0;
  let rosterKey = '';
  let lastLapSeen: number | null = null;

  const connection = new Connection({
    onRoom: (message) => applyRoom(message),
    onSnapshot: (message) => applySnapshot(message),
    onDisconnect: (willRetry) => {
      if (disposed) return;
      if (willRetry) {
        context.setStatus('Conexão caiu. Reconectando (sua vaga fica guardada por 30 s)…', true);
      } else {
        // Partida ranqueada é única: ao fim do pódio o servidor fecha a sala.
        const rankedOver = room?.mode === 'ranked' && room.phase !== 'race';
        showMenu(rankedOver ? '' : 'A conexão com o servidor foi encerrada.');
        context.setStatus(
          rankedOver
            ? 'Partida ranqueada encerrada. Seus pontos estão na aba Conta.'
            : 'Desconectado do servidor.',
          !rankedOver,
        );
      }
    },
    onReconnect: () => context.setStatus('Reconectado.'),
  });

  // --- interface -------------------------------------------------------------
  const ui = context.ui;
  const panel = document.createElement('section');
  panel.className = 'online-painel';
  panel.setAttribute('aria-live', 'polite');
  const hud = createHud(ui, track);
  const tags = createNameTags(ui);
  const showTags = getSettings().nameTags;
  /** Linha de rating do resultado ranqueado, buscada uma vez por partida. */
  let ratingLine = '';
  let ratingAsked = false;
  let intent: PlayIntent | null = takePlayIntent();
  hud.setHelp(
    'W/↑ acelera · S/↓ freia · A D/← → vira · Espaço drift · Shift olha para trás · F3 rede',
  );
  const debug = createDebugPanel(ui, connection.conditions);
  ui.append(panel);

  const heading = (text: string): void => {
    const title = document.createElement('h2');
    title.textContent = text;
    panel.append(title);
  };
  const paragraph = (text: string, className = ''): HTMLParagraphElement => {
    const node = document.createElement('p');
    node.textContent = text;
    node.className = className;
    panel.append(node);
    return node;
  };

  let queueTimer = 0;
  const stopQueue = (): void => {
    window.clearInterval(queueTimer);
    queueTimer = 0;
  };

  /** Fila ranqueada: espera o servidor formar a partida e entra com a reserva. */
  function startQueue(): void {
    audio.unlock();
    phase = 'connecting';
    panel.replaceChildren();
    heading('Ranqueado');
    const info = paragraph('Entrando na fila…');
    const actions = document.createElement('div');
    actions.className = 'botoes';
    button(actions, 'Sair da fila', () => {
      stopQueue();
      void queue.leave().catch(() => {});
      showMenu();
    });
    panel.append(actions);
    const fail = (erro: unknown): void => {
      stopQueue();
      if (!disposed) showMenu(erro instanceof Error ? erro.message : 'Erro na fila.');
    };
    const onStatus = (status: QueueStatus): void => {
      if (disposed || phase !== 'connecting') return;
      if (status.state === 'waiting') {
        info.textContent = `Procurando pilotos do seu nível… ${status.waitedSeconds} s (faixa de ±${status.band} pontos)`;
        if (!queueTimer) {
          queueTimer = window.setInterval(() => {
            queue.status().then(onStatus).catch(fail);
          }, 1500);
        }
      } else if (status.state === 'matched') {
        stopQueue();
        info.textContent = 'Partida encontrada! Entrando…';
        connection.joinReservation(status.reservation).catch(fail);
      } else {
        fail(new Error('Você saiu da fila.'));
      }
    };
    queue.join().then(onStatus).catch(fail);
  }

  function showMenu(error = ''): void {
    stopQueue();
    phase = 'menu';
    room = null;
    snapshot = null;
    predictor = null;
    rosterKey = '';
    view.clearRoster();
    panel.hidden = false;
    panel.replaceChildren();
    heading('Corrida online');
    if (error) paragraph(error, 'erro');

    const nameLabel = document.createElement('label');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 16;
    nameInput.value = storedName();
    nameInput.placeholder = 'Piloto';
    nameInput.setAttribute('autocomplete', 'nickname');
    nameLabel.append('Apelido ', nameInput);
    panel.append(nameLabel);

    const join = (mode: RoomMode, code?: string): void => {
      const name = nameInput.value.trim() || 'Piloto';
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {
        // Sem armazenamento: o apelido vale só nesta sessão.
      }
      audio.unlock();
      phase = 'connecting';
      panel.replaceChildren();
      heading('Conectando…');
      connection
        .join(
          {
            name,
            mode,
            cosmetics: { ...loadLoadout() },
            // Com conta, o servidor usa o nome e os cosméticos gravados nela.
            ...(sessionToken() ? { token: sessionToken() as string } : {}),
          },
          code,
        )
        .catch((erro: unknown) => {
          console.error(erro);
          if (!disposed) {
            showMenu(
              code
                ? 'Não encontrei essa sala. Confira o código.'
                : 'Não consegui conectar ao servidor. Ele está rodando (pnpm dev)?',
            );
          }
        });
    };

    const modes = document.createElement('div');
    modes.className = 'botoes';
    const casual = button(modes, 'Casual (com bots)', () => join('casual'));
    casual.className = 'primario';
    button(modes, 'Ranqueado', startQueue);
    button(modes, 'Criar sala privada', () => join('private'));
    panel.append(modes);

    const codeRow = document.createElement('form');
    codeRow.className = 'botoes';
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.maxLength = 12;
    codeInput.placeholder = 'Código de convite';
    codeInput.setAttribute('aria-label', 'Código de convite');
    const codeButton = document.createElement('button');
    codeButton.type = 'submit';
    codeButton.textContent = 'Entrar com código';
    codeRow.append(codeInput, codeButton);
    codeRow.addEventListener('submit', (event) => {
      event.preventDefault();
      if (codeInput.value.trim()) join('private', codeInput.value);
    });
    panel.append(codeRow);
    context.setStatus('Corrida online · escolha um modo');
    // Veio do menu principal já com o modo escolhido: entra direto.
    const pending = intent;
    intent = null;
    if (pending === 'casual') join('casual');
    else if (pending === 'ranked') startQueue();
  }

  function renderLobby(message: RoomMessage): void {
    panel.hidden = false;
    panel.replaceChildren();
    const titles = {
      private: 'Sala privada',
      casual: 'Sala Casual',
      ranked: 'Partida ranqueada',
    };
    heading(titles[message.mode]);
    if (message.mode === 'private') paragraph(`Código de convite: ${message.code}`, 'codigo');
    const list = document.createElement('ol');
    for (const entry of message.roster) {
      const item = document.createElement('li');
      const you = entry.slot === message.you ? ' (você)' : '';
      item.textContent = `${entry.name}${you} — ${entry.ready ? 'pronto' : 'aguardando'}`;
      list.append(item);
    }
    panel.append(list);
    paragraph(
      message.mode === 'casual'
        ? `Larga em ${message.secondsLeft ?? '–'} s. Bots completam o grid até 9.`
        : `Larga em ${message.secondsLeft ?? '–'} s, ou quando todos estiverem prontos.`,
    );
    const me = message.roster[message.you];
    const actions = document.createElement('div');
    actions.className = 'botoes';
    const ready = button(actions, me?.ready ? 'Cancelar pronto' : 'Estou pronto', () => {
      audio.unlock();
      connection.sendReady(!me?.ready);
    });
    ready.className = 'primario';
    button(actions, 'Sair da sala', () => {
      connection.close();
      showMenu();
    });
    panel.append(actions);
  }

  function renderResults(message: RoomMessage, title: string): void {
    panel.hidden = false;
    panel.replaceChildren();
    heading(title);
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const label of ['Pos.', 'Piloto', 'Tempo', 'Melhor volta']) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      head.append(cell);
    }
    const body = table.createTBody();
    for (const result of message.results ?? []) {
      const row = body.insertRow();
      if (result.slot === message.you) row.className = 'voce';
      const penalty = result.penaltyTicks > 0 ? ` (+${result.penaltyTicks / SIM_HZ} s)` : '';
      const cells = [
        ORDINALS[result.position - 1] ?? String(result.position),
        result.name + (result.bot ? ' (bot)' : ''),
        result.finished ? formatTime(result.timeTicks) + penalty : 'Não terminou',
        formatTime(result.bestLapTicks),
      ];
      for (const text of cells) row.insertCell().textContent = text;
    }
    panel.append(table);
    if (message.mode === 'ranked') {
      paragraph(ratingLine || 'Calculando seu rating…', 'rating');
      if (!ratingAsked) {
        ratingAsked = true;
        // O servidor grava a partida logo depois do resultado; espera um instante e busca.
        window.setTimeout(() => {
          refreshAccount()
            .then((me) => {
              if (!me || disposed) return;
              const delta = me.history[0]?.pointsDelta ?? null;
              const change = delta === null ? '' : ` (${delta >= 0 ? '+' : '−'}${Math.abs(delta)})`;
              const { rating } = me;
              ratingLine =
                `Rating: ${rating.points} pts${change} · ` +
                (rating.division
                  ? `Divisão ${rating.division}`
                  : `posicionamento: faltam ${rating.placementLeft} partidas`);
              const line = panel.querySelector('.rating');
              if (line) line.textContent = ratingLine;
            })
            .catch(() => {});
        }, 1500);
      }
    }
    paragraph(`Próxima etapa em ${message.secondsLeft ?? '–'} s.`, 'nota');
  }

  function applyRoom(message: RoomMessage): void {
    if (disposed) return;
    const previous = phase;
    room = message;
    phase = message.phase;

    if (message.phase === 'lobby') {
      if (previous !== 'lobby') {
        view.clearRoster();
        rosterKey = '';
        snapshot = null;
        predictor = null;
        buffer.clear();
        view.setLights(0);
      }
      renderLobby(message);
      context.setStatus(`Lobby · ${message.roster.length}/9 pilotos`);
    } else if (message.phase === 'race') {
      panel.hidden = true;
      const key = message.roster.map((entry) => `${entry.slot}:${entry.name}`).join('|');
      if (key !== rosterKey) {
        ratingLine = '';
        ratingAsked = false;
        // Grid definido (com os bots): monta os karts de todo mundo.
        rosterKey = key;
        lights = -1;
        lastLapSeen = null;
        input = NO_INPUT;
        void view.setRoster(
          message.roster.map((entry) => toLoadout(entry.cosmetics, entry.slot)),
          message.you,
        );
        hud.say('Espere as luzes apagarem', 4, clock);
      }
      context.setStatus(`Corrida · ${message.roster.length} karts`);
    } else if (message.phase === 'results') {
      renderResults(message, 'Resultado');
      context.setStatus('Resultado');
    } else {
      renderResults(message, 'Pódio');
      if (previous !== 'podium') {
        view.showPodium((message.results ?? []).slice(0, 3).map((result) => result.slot));
      }
      context.setStatus('Pódio');
    }
  }

  function applySnapshot(message: SnapshotMessage): void {
    if (disposed || !room || phase !== 'race') return;
    if (snapshot && message.tick <= snapshot.tick) return; // fora de ordem
    snapshot = message;
    buffer.push(message.tick, message.karts);
    // Relógio do servidor: nunca anda para trás, e corrige devagar se ficou para trás.
    serverTick = Math.max(serverTick, message.tick);

    const own = message.karts[room.you];
    if (!own) return;
    const racing = message.tick >= message.goTick;
    const finished = message.progress[room.you]?.finishTick != null;
    if (!predictor) predictor = new LocalPredictor(own, environment);
    predictor.reconcile(own, message.ack, racing && !finished, neighbours());

    const lit = startLights(message);
    if (lit !== lights) {
      if (lit > lights && lights >= 0) audio.beep(false);
      if (lit === 0 && lights === RACE_RULES.lights) {
        audio.beep(true);
        hud.say('Valendo!', 1.5, clock);
      }
      lights = lit;
      view.setLights(lit);
    }
    const progress = message.progress[room.you];
    if (progress?.lastLapTicks != null && progress.lastLapTicks !== lastLapSeen) {
      lastLapSeen = progress.lastLapTicks;
      hud.say(`Volta: ${formatTime(progress.lastLapTicks)}`, 3, clock);
    }
    if (finished && racing) hud.say('Você terminou! Aguardando os outros…', 2, clock);
    if (own.impact > 2) audio.impact(own.impact);
  }

  /** Os outros karts onde o jogador os vê agora, para a predição não atravessá-los. */
  function neighbours(): KartState[] {
    if (!room || !snapshot) return [];
    const renderTick = serverTick - INTERPOLATION_DELAY_SECONDS * SIM_HZ;
    const others: KartState[] = [];
    for (let slot = 0; slot < snapshot.karts.length; slot++) {
      if (slot === room.you) continue;
      const sample = buffer.sample(slot, renderTick);
      if (sample) {
        others.push({ ...sample.state, x: sample.x, z: sample.z, heading: sample.heading });
      }
    }
    return others;
  }

  /** Um tick local: lê os comandos, prevê o próprio kart e manda a entrada ao servidor. */
  function tick(): void {
    if (!room || !snapshot || !predictor) return;
    const state = controls.read();
    const racing = snapshot.tick >= snapshot.goTick;
    const finished = snapshot.progress[room.you]?.finishTick != null;
    // Depois da bandeirada o servidor freia o kart sozinho; a predição faz o mesmo.
    input = finished
      ? { ...NO_INPUT, brake: 0.4 }
      : applyAssists(input, state.raw, predictor.state, SIM_DT, state.assists);
    connection.sendInput(predictor.advance(input, racing, neighbours()));
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    audio.unlock();
    if (event.repeat || event.target instanceof HTMLInputElement) return;
    if (event.code === 'KeyM') {
      hud.say(audio.toggleMute() ? 'Som desligado' : 'Som ligado', 1.5, clock);
    } else if (event.code === 'KeyB') {
      view.blurEnabled = !view.blurEnabled;
    }
  };
  window.addEventListener('keydown', onKeyDown);
  showMenu();

  const screen: GameScreen = {
    scene: view.scene,
    camera: view.camera,
    motionBlur: 0,
    update(delta, time) {
      clock = time;
      const current = room;
      const latest = snapshot;

      if (phase === 'podium') {
        view.renderPodium(delta, time);
      } else if (phase === 'race' && current && latest && predictor) {
        serverTick += delta * SIM_HZ;
        // Sem snapshot há muito tempo: não deixa o relógio estimado fugir.
        serverTick = Math.min(serverTick, latest.tick + SIM_HZ);
        accumulator = Math.min(accumulator + delta, SIM_DT * MAX_STEPS_PER_FRAME);
        while (accumulator >= SIM_DT) {
          tick();
          accumulator -= SIM_DT;
        }
        predictor.smooth(delta);

        const renderTick = serverTick - INTERPOLATION_DELAY_SECONDS * SIM_HZ;
        const frames: KartFrame[] = latest.karts.map((kart, slot) => {
          if (slot === current.you && predictor) {
            const own = predictor.state;
            return {
              state: own,
              x: own.x + predictor.offset.x,
              y: own.y,
              z: own.z + predictor.offset.z,
              heading: own.heading + predictor.offset.heading,
              throttle: input.throttle,
            };
          }
          const sample = buffer.sample(slot, renderTick);
          const state = sample?.state ?? kart;
          return {
            state,
            x: sample?.x ?? kart.x,
            y: sample?.y ?? kart.y,
            z: sample?.z ?? kart.z,
            heading: sample?.heading ?? kart.heading,
            // Os outros não mandam o pedal; o giro do motor já diz o suficiente para os efeitos.
            throttle: state.rpm > 6000 ? 1 : 0,
          };
        });
        const racing = latest.tick >= latest.goTick;
        view.render(delta, time, frames, current.you, controls.read().lookBack, racing);
        if (showTags) {
          tags.update(
            frames.map((frame, slot) => ({
              name: current.roster.find((entry) => entry.slot === slot)?.name ?? '',
              x: frame.x,
              y: frame.y,
              z: frame.z,
            })),
            view.camera,
            current.you,
          );
        }

        const progress = latest.progress[current.you];
        const own = predictor.state;
        const place = standings({ ...latest, phase: latest.racePhase }, track).indexOf(current.you);
        if (progress) {
          hud.update(
            {
              positionText: `${ORDINALS[place] ?? '–'}/${latest.karts.length}`,
              lapText:
                progress.finishTick != null
                  ? 'Chegada'
                  : `Volta ${Math.min(Math.max(progress.lap, 1), latest.laps)}/${latest.laps}`,
              currentTicks: racing
                ? (progress.finishTick ?? latest.tick) - progress.lapStartTick
                : 0,
              lastTicks: progress.lastLapTicks,
              bestTicks: progress.bestLapTicks,
              speed: own.vx,
              rpm: own.rpm,
              tireTemp: own.tireTemp,
              offTrack: own.surface === 'grass' || own.surface === 'gravel',
              dots: frames.map((frame, slot) => ({
                x: frame.x,
                z: frame.z,
                own: slot === current.you,
              })),
            },
            time,
          );
        }
      } else {
        tags.hide();
        view.renderIdle(delta, time);
      }
      screen.motionBlur = view.motionBlur;

      debug.update(delta, {
        ping: `${connection.ping} ms`,
        'tick do servidor': latest?.tick ?? '–',
        snapshots: `${NET_TICK_HZ}/s`,
        'entradas sem confirmação': predictor?.pendingCount ?? 0,
        'correções de reconciliação': predictor?.corrections ?? 0,
        'última correção': predictor ? `${predictor.lastError.toFixed(2)} m` : '–',
        'draw calls': context.renderer.info.render.calls,
      });
    },
    dispose() {
      disposed = true;
      if (queueTimer) void queue.leave().catch(() => {});
      stopQueue();
      window.removeEventListener('keydown', onKeyDown);
      connection.close();
      controls.dispose();
      hud.dispose();
      tags.dispose();
      debug.dispose();
      ui.replaceChildren();
      view.dispose();
    },
  };
  return screen;
}
