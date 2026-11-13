import { Color, PerspectiveCamera, Scene } from 'three';
import type { MeResponse, RankingEntry } from '@kart/shared';
import { COSMETIC_ITEMS, SIM_HZ } from '@kart/shared';
import {
  currentAccount,
  fetchRanking,
  login,
  loginAsGuest,
  logout,
  refreshAccount,
  register,
} from '../net/account';
import type { AppContext, GameScreen } from './types';
import { button } from './types';

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

function element<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

interface Field {
  name: string;
  label: string;
  type: string;
  autocomplete: string;
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
    label: 'Senha (8+ caracteres)',
    type: 'password',
    autocomplete: 'new-password',
  },
  birthDate: { name: 'birthDate', label: 'Nascimento', type: 'date', autocomplete: 'bday' },
} satisfies Record<string, Field>;

/** Conta: entrar (convidado ou e-mail), perfil, ranqueada, inventário e ranking. */
export function createAccountScreen(context: AppContext): GameScreen {
  const scene = new Scene();
  scene.background = new Color('#10141c');
  const camera = new PerspectiveCamera(50, 1, 0.1, 10);
  let disposed = false;

  const panel = document.createElement('section');
  panel.className = 'online-painel conta-painel';
  context.ui.append(panel);

  function form(
    parent: HTMLElement,
    title: string,
    fields: readonly Field[],
    submitLabel: string,
    submit: (values: Record<string, string>) => Promise<unknown>,
  ): void {
    const node = element(parent, 'form', '', 'conta-form');
    element(node, 'h3', title);
    for (const field of fields) {
      const label = element(node, 'label', `${field.label} `);
      const input = element(label, 'input');
      input.name = field.name;
      input.type = field.type;
      input.required = true;
      input.setAttribute('autocomplete', field.autocomplete);
      if (field.name === 'name') input.maxLength = 16;
    }
    const error = element(node, 'p', '', 'erro');
    error.hidden = true;
    const actions = element(node, 'div', '', 'botoes');
    const send = element(actions, 'button', submitLabel, 'primario');
    send.type = 'submit';
    node.addEventListener('submit', (event) => {
      event.preventDefault();
      const values: Record<string, string> = {};
      for (const [key, value] of new FormData(node)) values[key] = String(value);
      send.disabled = true;
      error.hidden = true;
      submit(values)
        .then(() => {
          if (!disposed) render();
        })
        .catch((reason: unknown) => {
          if (disposed) return;
          send.disabled = false;
          error.hidden = false;
          error.textContent = reason instanceof Error ? reason.message : 'Algo deu errado.';
        });
    });
  }

  function renderSignedOut(): void {
    element(panel, 'h2', 'Conta');
    element(
      panel,
      'p',
      'Entre para guardar seus cosméticos e seu histórico. O Ranqueado exige conta com e-mail.',
      'nota',
    );
    const columns = element(panel, 'div', '', 'conta-colunas');
    form(columns, 'Jogar como convidado', [FIELDS.name], 'Entrar como convidado', (values) =>
      loginAsGuest(values.name ?? ''),
    );
    form(columns, 'Já tenho conta', [FIELDS.email, FIELDS.password], 'Entrar', login);
    form(
      columns,
      'Criar conta',
      [FIELDS.name, FIELDS.email, FIELDS.newPassword, FIELDS.birthDate],
      'Criar conta',
      register,
    );
    context.setStatus('Conta · você não entrou');
  }

  function renderRanking(parent: HTMLElement, ranking: readonly RankingEntry[]): void {
    if (ranking.length === 0) {
      element(parent, 'p', 'Ninguém correu no Ranqueado nesta temporada ainda.', 'nota');
      return;
    }
    const table = element(parent, 'table');
    const head = element(table, 'tr');
    for (const title of ['#', 'Piloto', 'Divisão', 'Pontos', 'Partidas'])
      element(head, 'th', title);
    for (const row of ranking) {
      const line = element(table, 'tr');
      const cells = [
        `${row.position}º`,
        row.name,
        row.division ?? 'Em posicionamento',
        String(row.points),
        String(row.matches),
      ];
      for (const cell of cells) element(line, 'td', cell);
    }
  }

  function renderSignedIn(me: MeResponse): void {
    const { user, rating, season } = me;
    element(panel, 'h2', user.name);
    element(
      panel,
      'p',
      user.guest ? 'Convidado (sem e-mail)' : `Conta: ${user.email ?? ''}`,
      'nota',
    );

    const columns = element(panel, 'div', '', 'conta-colunas');

    const ranked = element(columns, 'section');
    element(ranked, 'h3', `Ranqueado · ${season.name}`);
    element(
      ranked,
      'p',
      rating.division ?? `Em posicionamento: faltam ${rating.placementLeft} partida(s)`,
      'codigo',
    );
    element(ranked, 'p', `${rating.points} pontos · ${rating.matches} partida(s)`);
    element(
      ranked,
      'p',
      `A temporada termina em ${new Date(season.endsAt).toLocaleDateString('pt-BR')}.`,
      'nota',
    );
    if (user.guest) {
      form(
        ranked,
        'Criar conta para correr no Ranqueado',
        [FIELDS.name, FIELDS.email, FIELDS.newPassword, FIELDS.birthDate],
        'Criar conta',
        register,
      );
    }

    const inventory = element(columns, 'section');
    element(inventory, 'h3', 'Inventário');
    const list = element(inventory, 'ul', '', 'conta-itens');
    for (const item of COSMETIC_ITEMS) {
      const owned = me.inventory.includes(item.id);
      element(list, 'li', owned ? item.name : `${item.name} (bloqueado)`, owned ? '' : 'bloqueado');
    }
    element(inventory, 'p', 'Equipe na aba Garagem. Não há loja: itens são concedidos.', 'nota');

    const history = element(panel, 'section');
    element(history, 'h3', 'Últimas corridas');
    if (me.history.length === 0) {
      element(history, 'p', 'Nenhuma corrida ainda. Vá para a aba Corrida.', 'nota');
    } else {
      const table = element(history, 'table');
      const head = element(table, 'tr');
      for (const title of ['Modo', 'Posição', 'Tempo', 'Melhor volta', 'Pontos']) {
        element(head, 'th', title);
      }
      for (const row of me.history) {
        const line = element(table, 'tr');
        const delta = row.pointsDelta;
        const cells = [
          MODE_NAMES[row.mode] ?? row.mode,
          `${row.position}º de ${row.karts}`,
          formatTime(row.timeTicks),
          formatTime(row.bestLapTicks),
          delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta}`,
        ];
        for (const cell of cells) element(line, 'td', cell);
      }
    }

    const top = element(panel, 'section');
    element(top, 'h3', 'Ranking da temporada');
    fetchRanking()
      .then((ranking) => {
        if (!disposed) renderRanking(top, ranking);
      })
      .catch(() => {
        if (!disposed) element(top, 'p', 'Não consegui carregar o ranking.', 'erro');
      });

    const actions = element(panel, 'div', '', 'botoes');
    button(actions, 'Sair da conta', () => {
      logout();
      render();
    });
    context.setStatus(`Conta · ${user.name}`);
  }

  function render(): void {
    panel.replaceChildren();
    const me = currentAccount();
    if (me) renderSignedIn(me);
    else renderSignedOut();
  }

  element(panel, 'h2', 'Conta');
  element(panel, 'p', 'Carregando…', 'nota');
  refreshAccount()
    .catch((reason: unknown) => {
      context.setStatus(reason instanceof Error ? reason.message : 'Servidor fora do ar.', true);
    })
    .finally(() => {
      if (!disposed) render();
    });

  return {
    scene,
    camera,
    update() {},
    dispose() {
      disposed = true;
      panel.remove();
    },
  };
}
