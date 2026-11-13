import type {
  Cosmetics,
  CustomPaint,
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
import { loadPaint, sanitizePaint } from '../cosmetics/paint';
import type { QueueKind, QueueStatus } from '@kart/shared';
import { currentAccount, queue, refreshAccount, sessionToken } from '../net/account';
import { btn, el } from '../ui/dom';
import { block, field } from '../ui/sections';
import { updatePilot } from '../ui/shell';
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
  /** Pintura livre de cada vaga, como o servidor repassou. */
  let paints: readonly (CustomPaint | null)[] = [];
  let lastLapSeen: number | null = null;

  const connection = new Connection({
    onRoom: (message) => applyRoom(message),
    onPaints: (message) => {
      paints = message.paints;
    },
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

  /** Cabeçalho do painel: linha pequena, título e (opcional) uma frase. */
  const heading = (kicker: string, title: string, note = ''): void => {
    const top = el('header', 'gar-itens-topo');
    top.append(el('p', 'sobretitulo', kicker), el('h2', 'gar-titulo', title));
    if (note) top.append(el('p', 'nota', note));
    panel.append(top);
  };
  const paragraph = (text: string, className = ''): HTMLParagraphElement => {
    const node = el('p', className, text);
    panel.append(node);
    return node;
  };
  /** O que está desenhado no painel; igual = só o contador muda (o foco não se perde). */
  let renderedKey = '';
  let countdown: HTMLElement | null = null;
  const clearPanel = (key = ''): void => {
    renderedKey = key;
    countdown = null;
    panel.hidden = false;
    panel.replaceChildren();
  };

  let queueTimer = 0;
  const stopQueue = (): void => {
    window.clearInterval(queueTimer);
    queueTimer = 0;
  };

  /**
   * Fila de pareamento: o servidor junta pilotos de habilidade parecida e
   * devolve a reserva de vaga. No Casual a espera é de poucos segundos e os
   * bots completam o grid no nível do grupo.
   */
  function startQueue(kind: QueueKind, fallback?: () => void): void {
    audio.unlock();
    phase = 'connecting';
    clearPanel();
    heading(
      kind === 'ranked' ? 'Ranqueado' : 'Casual',
      'Na fila',
      kind === 'ranked'
        ? 'Pilotos da sua faixa de habilidade. A faixa abre com a espera.'
        : 'Juntando pilotos do seu nível. Os bots completam o grid.',
    );
    const info = paragraph('Entrando na fila…', 'fila-estado');
    info.setAttribute('role', 'status');
    const actions = el('div', 'botoes');
    const leave = btn('', 'Sair da fila', () => {
      stopQueue();
      void queue.leave().catch(() => {});
      showMenu();
    });
    actions.append(leave);
    panel.append(actions);
    leave.focus({ preventScroll: true });
    let entered = false;
    const fail = (erro: unknown): void => {
      stopQueue();
      if (disposed) return;
      // Fila fora do ar (servidor sem banco): o Casual ainda entra direto numa sala aberta.
      if (!entered && fallback) fallback();
      else showMenu(erro instanceof Error ? erro.message : 'Erro na fila.');
    };
    const onStatus = (status: QueueStatus): void => {
      if (disposed || phase !== 'connecting') return;
      entered = true;
      if (status.state === 'waiting') {
        info.textContent =
          kind === 'ranked'
            ? `Procurando pilotos do seu nível… ${status.waitedSeconds} s · faixa de ±${status.band}`
            : `Procurando pilotos do seu nível… ${status.waitedSeconds} s`;
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
    queue.join(kind).then(onStatus).catch(fail);
  }

  function showMenu(error = ''): void {
    stopQueue();
    phase = 'menu';
    room = null;
    snapshot = null;
    predictor = null;
    rosterKey = '';
    view.clearRoster();
    hud.setVisible(false);
    clearPanel();
    heading('Corrida online', 'Escolha o modo');
    if (error) paragraph(error, 'erro').setAttribute('role', 'alert');

    const account = currentAccount();
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.maxLength = 16;
    nameInput.value = account?.user.name ?? storedName();
    nameInput.placeholder = 'Piloto';
    nameInput.setAttribute('autocomplete', 'nickname');
    // Com conta, o servidor usa o apelido gravado nela.
    nameInput.disabled = account !== null;
    panel.append(
      field('Apelido', nameInput, account ? 'O apelido vem do seu perfil.' : 'Até 16 caracteres.'),
    );

    const join = (mode: RoomMode, code?: string): void => {
      const name = nameInput.value.trim() || 'Piloto';
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {
        // Sem armazenamento: o apelido vale só nesta sessão.
      }
      audio.unlock();
      phase = 'connecting';
      clearPanel();
      heading('Corrida online', 'Conectando…');
      connection
        .join(
          {
            name,
            mode,
            cosmetics: { ...loadLoadout() },
            paint: loadPaint() as CustomPaint | null,
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

    const modes = el('div', 'modos-lista');
    const mode = (title: string, summary: string, action: () => void): HTMLButtonElement => {
      const button = btn('modo-linha', '', action);
      button.append(el('strong', '', title), el('small', '', summary));
      modes.append(button);
      return button;
    };
    // Com conta, o Casual também pareia por habilidade; sem conta, entra numa sala aberta.
    const playCasual = (): void => {
      if (sessionToken()) startQueue('casual', () => join('casual'));
      else join('casual');
    };
    const casual = mode(
      'Casual',
      account
        ? 'Pilotos e bots do seu nível. Não vale pontos.'
        : 'Entra agora. Bots completam o grid até 9.',
      playCasual,
    );
    mode('Ranqueado', 'Vale pontos na temporada. Exige conta com e-mail.', () =>
      startQueue('ranked'),
    );
    mode('Sala privada', 'Cria uma sala e gera um código para chamar os amigos.', () =>
      join('private'),
    );
    panel.append(modes);

    const codeRow = el('form', 'codigo-form');
    const codeInput = el('input');
    codeInput.type = 'text';
    codeInput.maxLength = 12;
    codeInput.placeholder = 'Código de convite';
    codeInput.setAttribute('aria-label', 'Código de convite');
    const codeButton = el('button', '', 'Entrar');
    codeButton.type = 'submit';
    const codeActions = el('div', 'botoes');
    codeActions.append(codeButton);
    codeRow.append(codeInput, codeActions);
    codeRow.addEventListener('submit', (event) => {
      event.preventDefault();
      if (codeInput.value.trim()) join('private', codeInput.value);
      else codeInput.focus();
    });
    const back = el('div', 'botoes');
    back.append(
      btn('', 'Voltar ao início', () => {
        window.location.hash = 'menu';
      }),
    );
    panel.append(block('Tenho um código', codeRow), back);
    context.setStatus('Corrida online · escolha um modo');
    // Veio do menu principal já com o modo escolhido: entra direto.
    const pending = intent;
    intent = null;
    if (pending === 'casual') playCasual();
    else if (pending === 'ranked') startQueue('ranked');
    else casual.focus({ preventScroll: true });
  }

  const LOBBY_TITLES = {
    private: 'Sala privada',
    casual: 'Sala Casual',
    ranked: 'Partida ranqueada',
  };

  function renderLobby(message: RoomMessage): void {
    const startText =
      message.secondsLeft === null ? 'Esperando pilotos…' : `Larga em ${message.secondsLeft} s`;
    const key =
      `lobby|${message.mode}|${message.code}|${message.you}|` +
      message.roster.map((entry) => `${entry.name}:${entry.ready}:${entry.connected}`).join(',');
    if (key === renderedKey && countdown) {
      countdown.textContent = startText;
      return;
    }
    // Redesenhar não pode tirar o foco de quem está no teclado.
    const focused = (document.activeElement as HTMLElement | null)?.dataset.acao ?? '';
    clearPanel(key);
    heading(
      LOBBY_TITLES[message.mode],
      'Lobby',
      message.mode === 'casual'
        ? 'Bots completam o grid até 9 karts.'
        : 'A corrida larga quando todos estiverem prontos.',
    );
    if (message.mode === 'private') {
      const box = el('div', 'codigo-caixa');
      const text = el('div', '');
      text.append(el('small', '', 'Código de convite'), el('strong', '', message.code));
      const copy = btn('', 'Copiar', () => {
        navigator.clipboard
          ?.writeText(message.code)
          .then(() => context.setStatus('Código copiado'))
          .catch(() => context.setStatus('Não consegui copiar. Selecione o código.', true));
      });
      copy.dataset.acao = 'copiar';
      const actions = el('div', 'botoes');
      actions.append(copy);
      box.append(text, actions);
      panel.append(box);
    }
    const list = el('ol', 'pilotos');
    for (const entry of message.roster) {
      const item = el('li', 'piloto-linha');
      item.dataset.voce = String(entry.slot === message.you);
      item.dataset.pronto = String(entry.ready);
      const name = el('span', 'piloto-linha-nome', entry.name);
      if (entry.slot === message.you) name.append(el('span', 'etiqueta', 'Você'));
      item.append(
        el('span', 'piloto-linha-vaga', String(entry.slot + 1).padStart(2, '0')),
        name,
        el(
          'span',
          'piloto-linha-estado',
          !entry.connected ? 'Reconectando' : entry.ready ? 'Pronto' : 'Aguardando',
        ),
      );
      list.append(item);
    }
    panel.append(list);
    countdown = paragraph(startText, 'contagem');
    countdown.setAttribute('role', 'timer');
    const me = message.roster[message.you];
    const actions = el('div', 'botoes');
    const ready = btn('primario', me?.ready ? 'Cancelar pronto' : 'Estou pronto', () => {
      audio.unlock();
      connection.sendReady(!me?.ready);
    });
    ready.dataset.acao = 'pronto';
    const leave = btn('', 'Sair da sala', () => {
      connection.close();
      showMenu();
    });
    leave.dataset.acao = 'sair';
    actions.append(ready, leave);
    panel.append(actions);
    (panel.querySelector<HTMLElement>(`[data-acao="${focused || 'pronto'}"]`) ?? ready).focus({
      preventScroll: true,
    });
  }

  function renderResults(message: RoomMessage, title: string): void {
    const nextText = `Próxima etapa em ${message.secondsLeft ?? '–'} s`;
    const key = `${title}|${message.you}|${(message.results ?? []).map((r) => r.slot).join(',')}`;
    if (key === renderedKey && countdown) {
      countdown.textContent = nextText;
      return;
    }
    clearPanel(key);
    const results = message.results ?? [];
    const mine = results.find((result) => result.slot === message.you);
    heading(
      LOBBY_TITLES[message.mode],
      title,
      mine ? `Você terminou em ${ORDINALS[mine.position - 1] ?? `${mine.position}º`}.` : '',
    );
    const list = el('ol', 'resultado');
    for (const result of results) {
      const row = el('li', 'resultado-linha');
      row.dataset.voce = String(result.slot === message.you);
      row.dataset.podio = String(result.position <= 3);
      const penalty = result.penaltyTicks > 0 ? ` (+${result.penaltyTicks / SIM_HZ} s)` : '';
      const name = el('span', 'resultado-nome', result.name);
      if (result.bot) name.append(el('span', 'etiqueta', 'Bot'));
      const times = el('span', 'resultado-tempos');
      times.append(
        el('strong', '', result.finished ? formatTime(result.timeTicks) + penalty : 'Não terminou'),
        el('small', '', `Melhor volta ${formatTime(result.bestLapTicks)}`),
      );
      row.append(el('span', 'resultado-posicao', String(result.position)), name, times);
      list.append(row);
    }
    panel.append(list);
    if (sessionToken()) {
      paragraph(ratingLine || 'Calculando sua experiência…', 'rating');
      if (!ratingAsked) {
        ratingAsked = true;
        // O servidor grava a partida logo depois do resultado; espera um instante e busca.
        window.setTimeout(() => {
          refreshAccount()
            .then((me) => {
              if (!me || disposed) return;
              const last = me.history[0];
              const { rating, level } = me;
              const progress =
                level.needed > 0 ? ` (${level.into}/${level.needed} XP)` : ' (nível máximo)';
              ratingLine = `+${last?.xp ?? 0} XP · Nível ${level.level}${progress}`;
              if (message.mode === 'ranked') {
                const delta = last?.pointsDelta ?? null;
                const change =
                  delta === null ? '' : ` (${delta >= 0 ? '+' : '−'}${Math.abs(delta)})`;
                ratingLine +=
                  ` · Rating ${rating.points} pts${change} · ` +
                  (rating.division
                    ? `Divisão ${rating.division}`
                    : `posicionamento: faltam ${rating.placementLeft} partidas`);
              }
              const line = panel.querySelector('.rating');
              if (line) line.textContent = ratingLine;
              updatePilot();
            })
            .catch(() => {});
        }, 1500);
      }
    }
    countdown = paragraph(nextText, 'contagem');
    countdown.setAttribute('role', 'timer');
    const actions = el('div', 'botoes');
    actions.append(
      btn('', 'Sair da sala', () => {
        connection.close();
        showMenu();
      }),
    );
    panel.append(actions);
  }

  function applyRoom(message: RoomMessage): void {
    if (disposed) return;
    const previous = phase;
    room = message;
    hud.setVisible(message.phase === 'race');
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
      renderedKey = '';
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
          // Cada cliente confere de novo a pintura dos outros antes de desenhar.
          message.roster.map((entry) => sanitizePaint(paints[entry.slot] ?? null)),
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
