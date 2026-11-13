import type { HistoryEntry, MeResponse, RankingEntry } from '@kart/shared';
import { COSMETIC_ITEMS, SIM_HZ } from '@kart/shared';
import { SLOT_LABELS } from '../cosmetics/catalog';
import type { Loadout } from '../cosmetics/catalog';
import {
  currentAccount,
  fetchRanking,
  login,
  loginAsGuest,
  logout,
  refreshAccount,
  register,
} from '../net/account';
import { btn, el } from '../ui/dom';
import type { SectionDef } from '../ui/sections';
import { block, createSections, field, stat } from '../ui/sections';
import { initials, setHints, updatePilot } from '../ui/shell';
import { swatchColors } from './garageScreen';
import { createShowroom } from './showroom';
import type { AppContext, GameScreen } from './types';

const MODE_NAMES: Record<string, string> = {
  casual: 'Casual',
  private: 'Sala privada',
  ranked: 'Ranqueado',
};

const formatTime = (ticks: number | null): string => {
  if (ticks === null) return '—';
  const seconds = ticks / SIM_HZ;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
};

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

interface Field {
  name: string;
  label: string;
  type: string;
  autocomplete: string;
  hint?: string;
}

const FIELDS = {
  name: { name: 'name', label: 'Apelido', type: 'text', autocomplete: 'nickname' },
  email: { name: 'email', label: 'E-mail', type: 'email', autocomplete: 'email' },
  password: {
    name: 'password',
    label: 'Senha',
    type: 'password',
    autocomplete: 'current-password',
  },
  newPassword: {
    name: 'password',
    label: 'Senha',
    type: 'password',
    autocomplete: 'new-password',
    hint: 'Pelo menos 8 caracteres',
  },
  birthDate: {
    name: 'birthDate',
    label: 'Nascimento',
    type: 'date',
    autocomplete: 'bday',
    hint: 'Menores de 18 ficam fora de qualquer compra futura',
  },
} satisfies Record<string, Field>;

const REGISTER_FIELDS = [FIELDS.name, FIELDS.email, FIELDS.newPassword, FIELDS.birthDate];

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
      ],
    };
  });

/** Perfil: entrar (convidado ou e-mail), resumo, histórico, ranking e coleção. */
export function createAccountScreen(context: AppContext): GameScreen {
  const showroom = createShowroom(context);
  const sections = createSections('Seções do perfil');
  let disposed = false;
  let ranking: readonly RankingEntry[] | null = null;
  let rankingError = false;

  function form(
    fields: readonly Field[],
    submitLabel: string,
    submit: (values: Record<string, string>) => Promise<unknown>,
  ): HTMLFormElement {
    const node = el('form', 'formulario');
    for (const item of fields) {
      const input = el('input');
      input.name = item.name;
      input.type = item.type;
      input.required = true;
      input.setAttribute('autocomplete', item.autocomplete);
      if (item.name === 'name') input.maxLength = 16;
      if (item.autocomplete === 'new-password') input.minLength = 8;
      node.append(field(item.label, input, 'hint' in item ? item.hint : ''));
    }
    const error = el('p', 'erro');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const actions = el('div', 'botoes');
    const send = el('button', 'primario', submitLabel);
    send.type = 'submit';
    actions.append(send);
    node.append(error, actions);
    node.addEventListener('submit', (event) => {
      event.preventDefault();
      const values: Record<string, string> = {};
      for (const [key, value] of new FormData(node)) values[key] = String(value);
      send.disabled = true;
      send.textContent = 'Enviando…';
      error.hidden = true;
      submit(values)
        .then(() => {
          if (!disposed) render();
        })
        .catch((reason: unknown) => {
          if (disposed) return;
          send.disabled = false;
          send.textContent = submitLabel;
          error.hidden = false;
          error.textContent = reason instanceof Error ? reason.message : 'Algo deu errado.';
        });
    });
    return node;
  }

  const signedOut = (): SectionDef[] => [
    {
      id: 'convidado',
      group: 'Entrar',
      label: 'Convidado',
      note: 'Só um apelido: corre no Casual e guarda o visual',
      value: () => 'Sem e-mail',
      render(body) {
        body.append(
          form([FIELDS.name], 'Entrar como convidado', (values) => loginAsGuest(values.name ?? '')),
          el(
            'p',
            'nota',
            'Dá para virar conta completa depois, sem perder nada. O Ranqueado exige conta com e-mail.',
          ),
        );
      },
    },
    {
      id: 'entrar',
      group: 'Entrar',
      label: 'Já tenho conta',
      note: 'Entre com e-mail e senha',
      value: () => 'E-mail e senha',
      render(body) {
        body.append(form([FIELDS.email, FIELDS.password], 'Entrar', login));
      },
    },
    {
      id: 'criar',
      group: 'Entrar',
      label: 'Criar conta',
      note: 'Libera o Ranqueado e guarda tudo no servidor',
      value: () => 'Ranqueado liberado',
      render(body) {
        body.append(form(REGISTER_FIELDS, 'Criar conta', register));
      },
    },
  ];

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
    const owned = COSMETIC_ITEMS.filter((item) => me.inventory.includes(item.id)).length;
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
            el('span', 'perfil-conta', user.guest ? 'Convidado' : (user.email ?? '')),
          );
          card.append(
            el('span', 'perfil-sigla', initials(user.name)),
            text,
            el('span', 'etiqueta', division),
          );
          const stats = el('div', 'dados');
          stats.append(
            stat(String(rating.points), 'Pontos', true),
            stat(String(rating.matches), 'Ranqueadas'),
            stat(String(wins), 'Vitórias recentes'),
            stat(formatTime(best), 'Melhor volta'),
          );
          body.append(card, stats);
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
                ? table(['Modo', 'Posição', 'Tempo', 'Volta', 'Pts'], historyRows(recent))
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
                  ['Modo', 'Posição', 'Tempo', 'Melhor volta', 'Pontos'],
                  historyRows(me.history),
                )
              : el('p', 'nota', 'Nenhuma corrida ainda. Escolha um modo na tela Início.'),
          );
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
        note: 'Itens especiais da sua conta. O resto do catálogo é livre.',
        value: () => `${owned} de ${COSMETIC_ITEMS.length}`,
        render(body) {
          const list = el('ul', 'colecao');
          for (const item of COSMETIC_ITEMS) {
            const has = me.inventory.includes(item.id);
            const row = el('li', 'colecao-item');
            row.dataset.bloqueado = String(!has);
            const swatch = el('span', 'colecao-cor');
            const colors = swatchColors(item.slot as keyof Loadout, item.key);
            swatch.style.background =
              colors.length > 1
                ? `linear-gradient(135deg, ${colors[0]} 50%, ${colors[1]} 50%)`
                : (colors[0] ?? 'var(--superficie-3)');
            const text = el('span', 'colecao-texto');
            text.append(
              el('strong', '', item.name),
              el('small', '', SLOT_LABELS[item.slot as keyof Loadout] ?? item.slot),
            );
            row.append(swatch, text, el('span', 'etiqueta', has ? 'Seu' : 'Bloqueado'));
            list.append(row);
          }
          const actions = el('div', 'botoes');
          actions.append(
            btn('', 'Equipar na Garagem', () => {
              window.location.hash = 'garagem';
            }),
          );
          body.append(
            list,
            el('p', 'nota', 'Não há loja: itens bloqueados são concedidos pelo jogo.'),
            actions,
          );
        },
      },
      {
        id: 'conta',
        group: 'Conta',
        label: user.guest ? 'Criar conta' : 'Minha conta',
        note: user.guest
          ? 'Vire conta completa para correr no Ranqueado'
          : 'Dados da conta e saída',
        value: () => (user.guest ? 'Convidado' : (user.email ?? '')),
        render(body) {
          if (user.guest) {
            body.append(
              block(
                'Conta com e-mail',
                el('p', 'nota', 'Seu visual, presets e histórico continuam com você.'),
                form(REGISTER_FIELDS, 'Criar conta', register),
              ),
            );
          } else {
            const data = el('dl', 'mapa');
            data.append(
              el('dt', '', 'Apelido'),
              el('dd', '', user.name),
              el('dt', '', 'E-mail'),
              el('dd', '', user.email ?? '—'),
            );
            body.append(block('Dados', data));
          }
          const actions = el('div', 'botoes');
          actions.append(
            btn('', 'Sair da conta', () => {
              logout();
              render();
              context.setStatus('Você saiu da conta');
            }),
          );
          body.append(
            block(
              'Sessão',
              el(
                'p',
                'nota',
                user.guest
                  ? 'Sair de uma conta de convidado perde o acesso a ela neste navegador.'
                  : 'Você pode entrar de novo com e-mail e senha.',
              ),
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
    if (!me) {
      sections.set(signedOut(), sections.current());
      context.setStatus('Perfil · você não entrou');
      return;
    }
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
      sections.dispose();
      context.ui.replaceChildren();
      showroom.dispose();
    },
  };
}
