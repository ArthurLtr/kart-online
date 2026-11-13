import type { HistoryEntry, MeResponse, RankingEntry } from '@kart/shared';
import { CATALOG_ITEMS, levelTitle, RARITIES, SIM_HZ } from '@kart/shared';
import { SLOT_LABELS } from '../cosmetics/catalog';
import type { Loadout } from '../cosmetics/catalog';
import { currentAccount, fetchRanking, logout, refreshAccount } from '../net/account';
import { btn, el } from '../ui/dom';
import type { SectionDef } from '../ui/sections';
import { block, createSections, stat } from '../ui/sections';
import { initials, reopenScreen, setHints, updatePilot } from '../ui/shell';
import { buyButtons, formatCoins, formatGems, rarityTag } from '../ui/buy';
import { renderGemStore } from './gemStore';
import { swatchColors } from './garageScreen';
import { createShowroom } from './showroom';
import type { AppContext, GameScreen } from './types';

const MODE_NAMES: Record<string, string> = {
  casual: 'Casual',
  private: 'Sala privada',
  ranked: 'Ranqueado',
};

const TRACK_NAMES: Record<string, string> = { 'circuito-da-orla': 'Circuito da Orla' };

/** Frase com o próximo título de carreira e o nível em que ele chega. */
function nextTitle(level: number): string {
  for (let next = level + 1; next <= 100; next++) {
    if (levelTitle(next) !== levelTitle(level)) return `${levelTitle(next)} no nível ${next}.`;
  }
  return 'Você já tem o título máximo.';
}

const formatTime = (ticks: number | null): string => {
  if (ticks === null) return '—';
  const seconds = ticks / SIM_HZ;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
};

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

function table(
  headers: readonly string[],
  rows: readonly { cells: readonly string[]; you?: boolean }[],
): HTMLTableElement {
  const node = el('table', 'tabela');
  const head = node.createTHead().insertRow();
  for (const title of headers) {
    const cell = el('th', '', title);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = node.createTBody();
  for (const row of rows) {
    const line = body.insertRow();
    if (row.you) line.className = 'voce';
    for (const cell of row.cells) line.insertCell().textContent = cell;
  }
  return node;
}

const historyRows = (history: readonly HistoryEntry[]) =>
  history.map((row) => {
    const delta = row.pointsDelta;
    return {
      cells: [
        MODE_NAMES[row.mode] ?? row.mode,
        `${row.position}º de ${row.karts}`,
        formatTime(row.timeTicks),
        formatTime(row.bestLapTicks),
        delta === null ? '—' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}`,
        `+${row.xp}`,
        `+${row.coins}`,
      ],
    };
  });

/** Perfil: resumo, histórico, carreira, progressão e loja, ranking e coleção. */
export function createAccountScreen(context: AppContext): GameScreen {
  const showroom = createShowroom(context);
  const sections = createSections('Seções do perfil');
  let disposed = false;
  let ranking: readonly RankingEntry[] | null = null;
  let rankingError = false;
  /** Desliga a espera do Pix da seção de gemas. */
  let stopStore: () => void = () => undefined;

  const signedIn = (me: MeResponse): SectionDef[] => {
    const { user, rating, season } = me;
    const division = rating.division ?? 'Posicionamento';
    const best = me.history.reduce<number | null>(
      (min, row) =>
        row.bestLapTicks !== null && (min === null || row.bestLapTicks < min)
          ? row.bestLapTicks
          : min,
      null,
    );
    const wins = me.history.filter((row) => row.position === 1).length;
    const owned = CATALOG_ITEMS.filter((item) => me.inventory.includes(item.id)).length;
    return [
      {
        id: 'resumo',
        group: 'Piloto',
        label: 'Resumo',
        note: `${season.name} · termina em ${new Date(season.endsAt).toLocaleDateString('pt-BR')}`,
        value: () => `${division} · ${rating.points} pts`,
        render(body) {
          const card = el('div', 'perfil-cartao');
          const text = el('div', 'perfil-texto');
          text.append(
            el('strong', 'perfil-nome', user.name),
            el('span', 'perfil-conta', user.email ?? ''),
          );
          card.append(
            el('span', 'perfil-sigla', initials(user.name)),
            text,
            el('span', 'etiqueta', division),
          );
          const { level } = me;
          const bar = el('div', 'nivel');
          const track = el('div', 'nivel-barra');
          track.setAttribute('role', 'progressbar');
          track.setAttribute('aria-label', 'Progresso do nível');
          track.setAttribute('aria-valuemin', '0');
          track.setAttribute('aria-valuemax', String(level.needed || 1));
          track.setAttribute('aria-valuenow', String(level.needed ? level.into : 1));
          const fill = el('i');
          fill.style.width = `${level.needed ? (level.into / level.needed) * 100 : 100}%`;
          track.append(fill);
          const top = el('div', 'nivel-topo');
          top.append(
            el('strong', '', `Nível ${level.level}`),
            el('span', '', level.title),
            el('small', '', level.needed ? `${level.into} / ${level.needed} XP` : 'Nível máximo'),
          );
          bar.append(top, track);
          const stats = el('div', 'dados');
          stats.append(
            stat(String(rating.points), 'Pontos', true),
            stat(me.coins.toLocaleString('pt-BR'), 'Moedas'),
            stat(me.gems.toLocaleString('pt-BR'), 'Gemas'),
            stat(String(rating.matches), 'Ranqueadas'),
            stat(String(wins), 'Vitórias recentes'),
            stat(formatTime(best), 'Melhor volta'),
          );
          body.append(card, bar, stats);
          if (rating.placementLeft > 0) {
            body.append(
              el(
                'p',
                'nota',
                `Em posicionamento: faltam ${plural(rating.placementLeft, 'partida ranqueada', 'partidas ranqueadas')} para a divisão aparecer.`,
              ),
            );
          }
          const recent = me.history.slice(0, 3);
          body.append(
            block(
              'Últimas corridas',
              recent.length > 0
                ? table(
                    ['Modo', 'Posição', 'Tempo', 'Volta', 'Pts', 'XP', 'Moedas'],
                    historyRows(recent),
                  )
                : el('p', 'nota', 'Nenhuma corrida ainda. Escolha um modo na tela Início.'),
            ),
          );
          const actions = el('div', 'botoes');
          actions.append(
            btn('primario', 'Correr', () => {
              window.location.hash = 'menu';
            }),
            btn('', 'Abrir a Garagem', () => {
              window.location.hash = 'garagem';
            }),
          );
          body.append(actions);
        },
      },
      {
        id: 'historico',
        group: 'Piloto',
        label: 'Histórico',
        note: 'Suas dez últimas corridas',
        value: () => plural(me.history.length, 'corrida', 'corridas'),
        render(body) {
          body.append(
            me.history.length > 0
              ? table(
                  ['Modo', 'Posição', 'Tempo', 'Melhor volta', 'Pontos', 'XP', 'Moedas'],
                  historyRows(me.history),
                )
              : el('p', 'nota', 'Nenhuma corrida ainda. Escolha um modo na tela Início.'),
          );
        },
      },
      {
        id: 'carreira',
        group: 'Piloto',
        label: 'Carreira',
        note: 'Seus números em cada modo e os recordes de pista',
        value: () =>
          plural(
            me.stats.reduce((sum, row) => sum + row.matches, 0),
            'corrida',
            'corridas',
          ),
        render(body) {
          if (me.stats.length === 0) {
            body.append(el('p', 'nota', 'Corra online para começar a sua carreira.'));
            return;
          }
          for (const mode of ['ranked', 'casual', 'private']) {
            const row = me.stats.find((item) => item.mode === mode);
            if (!row) continue;
            const grid = el('div', 'dados');
            grid.append(
              stat(String(row.matches), 'Corridas'),
              stat(String(row.wins), 'Vitórias', row.wins > 0),
              stat(String(row.podiums), 'Pódios'),
              stat(row.matches ? `${row.averagePosition.toFixed(1)}º` : '—', 'Posição média'),
              stat(formatTime(row.bestLapTicks), 'Melhor volta'),
            );
            body.append(block(MODE_NAMES[mode] ?? mode, grid));
          }
          if (me.records.length > 0) {
            body.append(
              block(
                'Recordes de pista',
                table(
                  ['Pista', 'Melhor volta', 'Melhor corrida'],
                  me.records.map((row) => ({
                    cells: [
                      TRACK_NAMES[row.track] ?? row.track,
                      formatTime(row.bestLapTicks),
                      formatTime(row.bestRaceTicks),
                    ],
                  })),
                ),
              ),
            );
          }
        },
      },
      {
        id: 'niveis',
        group: 'Loja',
        label: 'Itens',
        note: 'Compre com moedas (ganhas correndo) ou com gemas',
        value: () => `${formatCoins(me.coins)} · ${formatGems(me.gems)}`,
        render(body) {
          const wallet = el('div', 'dados');
          wallet.append(
            stat(me.coins.toLocaleString('pt-BR'), 'Moedas', true),
            stat(me.gems.toLocaleString('pt-BR'), 'Gemas'),
            stat(String(me.level.level), 'Nível'),
          );
          const error = el('p', 'erro');
          error.setAttribute('role', 'alert');
          error.hidden = true;
          const list = el('ul', 'colecao');
          const order = RARITIES.map((entry) => entry.id);
          const offers = CATALOG_ITEMS.filter(
            (item) => !item.isDefault && !me.inventory.includes(item.id),
          ).sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity));
          for (const item of offers) {
            const row = el('li', 'colecao-item loja-item');
            row.dataset.raridade = item.rarity;
            const swatch = el('span', 'colecao-cor');
            const colors =
              item.slot in SLOT_LABELS ? swatchColors(item.slot as keyof Loadout, item.key) : [];
            swatch.style.background =
              colors.length > 1
                ? `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`
                : (colors[0] ?? 'var(--superficie-3)');
            const text = el('span', 'colecao-texto');
            const title = el('strong', '', item.name);
            text.append(title, rarityTag(item.id));
            row.append(
              swatch,
              text,
              buyButtons(item.id, {
                onBought() {
                  if (disposed) return;
                  context.setStatus(`${item.name} comprado. Equipe na Garagem.`);
                  render();
                },
                onError(message) {
                  if (disposed) return;
                  error.hidden = false;
                  error.textContent = message;
                  sections.refresh();
                },
              }),
            );
            list.append(row);
          }
          body.append(
            wallet,
            error,
            offers.length > 0
              ? block('À venda', list)
              : el('p', 'nota', 'Você já tem todos os itens do catálogo.'),
            block(
              'Raridades',
              el(
                'p',
                'nota',
                'Comum e raro: só moedas. Épico: moedas ou gemas. Lendário e exclusivo: só gemas. Com moedas, alguns itens pedem um nível de carreira; com gemas, não. Nenhum item muda o desempenho do kart.',
              ),
            ),
            block(
              'Como ganhar moedas',
              el(
                'p',
                'nota',
                'Cada corrida online rende experiência e moedas na mesma proporção, e subir de nível dá um bônus. O Ranqueado rende 25% a mais; sala privada rende metade e só com outro piloto.',
              ),
            ),
            block('Próximo título', el('p', 'nota', nextTitle(me.level.level))),
          );
        },
      },
      {
        id: 'gemas',
        group: 'Loja',
        label: 'Gemas',
        note: 'Compre gemas por Pix',
        value: () => formatGems(me.gems),
        render(body) {
          stopStore();
          stopStore = renderGemStore(body, {
            setStatus: context.setStatus,
            onPaid() {
              if (!disposed) render();
            },
          });
        },
      },
      {
        id: 'ranking',
        group: 'Temporada',
        label: 'Ranking',
        note: `Os melhores da ${season.name}`,
        value: () => (ranking ? plural(ranking.length, 'piloto', 'pilotos') : ''),
        render(body) {
          if (rankingError) {
            body.append(el('p', 'erro', 'Não consegui carregar o ranking.'));
          } else if (!ranking) {
            body.append(el('p', 'nota', 'Carregando…'));
          } else if (ranking.length === 0) {
            body.append(
              el(
                'p',
                'nota',
                'Ninguém correu no Ranqueado nesta temporada ainda. Seja o primeiro.',
              ),
            );
          } else {
            body.append(
              table(
                ['#', 'Piloto', 'Divisão', 'Pontos', 'Partidas'],
                ranking.map((row) => ({
                  you: row.name === user.name,
                  cells: [
                    `${row.position}º`,
                    row.name,
                    row.division ?? 'Posicionamento',
                    String(row.points),
                    String(row.matches),
                  ],
                })),
              ),
            );
          }
        },
      },
      {
        id: 'colecao',
        group: 'Coleção',
        label: 'Inventário',
        note: 'Tudo o que é seu: itens básicos e o que você comprou',
        value: () => `${owned} de ${CATALOG_ITEMS.length}`,
        render(body) {
          const list = el('ul', 'colecao');
          for (const item of CATALOG_ITEMS.filter((entry) => me.inventory.includes(entry.id))) {
            const row = el('li', 'colecao-item');
            row.dataset.raridade = item.rarity;
            const swatch = el('span', 'colecao-cor');
            const colors =
              item.slot in SLOT_LABELS ? swatchColors(item.slot as keyof Loadout, item.key) : [];
            swatch.style.background =
              colors.length > 1
                ? `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`
                : (colors[0] ?? 'var(--superficie-3)');
            const text = el('span', 'colecao-texto');
            text.append(
              el('strong', '', item.name),
              el(
                'small',
                '',
                item.slot in SLOT_LABELS
                  ? SLOT_LABELS[item.slot as keyof Loadout]
                  : 'Pintura livre',
              ),
            );
            row.append(swatch, text, rarityTag(item.id));
            list.append(row);
          }
          const actions = el('div', 'botoes');
          actions.append(
            btn('', 'Equipar na Garagem', () => {
              window.location.hash = 'garagem';
            }),
          );
          body.append(list, actions);
        },
      },
      {
        id: 'conta',
        group: 'Conta',
        label: 'Minha conta',
        note: 'Dados da conta e saída',
        value: () => user.email ?? '',
        render(body) {
          const data = el('dl', 'mapa');
          data.append(
            el('dt', '', 'Apelido'),
            el('dd', '', user.name),
            el('dt', '', 'E-mail'),
            el('dd', '', user.email ?? '—'),
          );
          const actions = el('div', 'botoes');
          actions.append(
            btn('', 'Sair da conta', () => {
              logout();
              // Sem conta, o jogo volta para a tela de entrada.
              reopenScreen();
            }),
          );
          body.append(
            block('Dados', data),
            block(
              'Sessão',
              el('p', 'nota', 'Para jogar de novo é só entrar com Google ou e-mail e senha.'),
              actions,
            ),
          );
        },
      },
    ];
  };

  function render(): void {
    const me = currentAccount();
    updatePilot();
    if (!me) return; // sem conta, a tela de entrada toma o lugar desta
    sections.set(signedIn(me), sections.current());
    context.setStatus(`Perfil · ${me.user.name}`);
    if (ranking || rankingError) return;
    fetchRanking()
      .then((rows) => {
        ranking = rows;
      })
      .catch(() => {
        rankingError = true;
      })
      .finally(() => {
        if (disposed) return;
        if (sections.current() === 'ranking') sections.refresh();
        else sections.refreshValues();
      });
  }

  context.ui.append(sections.rail, sections.panel);
  context.setStatus('Perfil · carregando…');
  setHints([
    { keys: ['↑', '↓'], label: 'Navegar' },
    { keys: ['Enter'], label: 'Abrir' },
    { keys: ['Tab'], label: 'Ir para o conteúdo' },
  ]);
  render();
  sections.rail.querySelector('button')?.focus({ preventScroll: true });
  const cached = currentAccount();
  refreshAccount()
    .catch((reason: unknown) => {
      context.setStatus(reason instanceof Error ? reason.message : 'Servidor fora do ar.', true);
    })
    .then(() => {
      // Sem conta antes e depois, nada muda: não apaga o que a pessoa já estava digitando.
      if (!disposed && currentAccount() !== cached) render();
    });

  return {
    scene: showroom.scene,
    camera: showroom.camera,
    update(delta, time) {
      showroom.update(delta, time);
    },
    dispose() {
      disposed = true;
      stopStore();
      sections.dispose();
      context.ui.replaceChildren();
      showroom.dispose();
    },
  };
}
