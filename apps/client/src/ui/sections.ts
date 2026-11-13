import { arrowNavigation } from './arrows';
import { btn, el } from './dom';

/** Uma seção de uma tela de painel (Perfil, Configurações). */
export interface SectionDef {
  id: string;
  group: string;
  label: string;
  /** Frase curta sob o título do painel. */
  note: string;
  /** Resumo mostrado sob o nome, na lista de seções. */
  value?: () => string;
  /** Monta o conteúdo. É chamada cada vez que a seção abre ou é redesenhada. */
  render(body: HTMLElement): void;
}

export interface Sections {
  /** Lista de seções (coluna da esquerda). */
  rail: HTMLElement;
  /** Painel com o título e o conteúdo da seção aberta. */
  panel: HTMLElement;
  /** Troca as seções (por exemplo, ao entrar na conta) e abre `initial` ou a primeira. */
  set(defs: readonly SectionDef[], initial?: string): void;
  open(id: string): void;
  /** Redesenha a seção aberta e os resumos da lista. */
  refresh(): void;
  /** Só os resumos da lista, sem mexer no conteúdo (não perde o foco). */
  refreshValues(): void;
  current(): string;
  dispose(): void;
}

/**
 * Tela em duas colunas no mesmo desenho da Garagem: seções à esquerda,
 * painel da seção aberta ao lado, e o resto da tela livre para a cena 3D.
 */
export function createSections(label: string): Sections {
  const rail = el('nav', 'gar-categorias');
  rail.setAttribute('aria-label', label);
  const panel = el('section', 'gar-itens sec-painel');
  const heading = el('header', 'gar-itens-topo');
  const body = el('div', 'sec-corpo');
  panel.append(heading, body);
  const stopArrows = arrowNavigation(rail);

  let defs: readonly SectionDef[] = [];
  let currentId = '';
  let buttons = new Map<string, { button: HTMLButtonElement; value: HTMLElement }>();

  function refreshValues(): void {
    for (const def of defs) {
      const entry = buttons.get(def.id);
      if (!entry) continue;
      entry.button.setAttribute('aria-current', String(def.id === currentId));
      entry.value.textContent = def.value?.() ?? '';
    }
  }

  function refresh(): void {
    const def = defs.find((item) => item.id === currentId);
    if (!def) return;
    const position = defs.indexOf(def) + 1;
    heading.replaceChildren(
      el('p', 'sobretitulo', `${def.group} · ${String(position).padStart(2, '0')}`),
      el('h2', 'gar-titulo', def.label),
      el('p', 'nota', def.note),
    );
    body.replaceChildren();
    body.scrollTop = 0;
    def.render(body);
    refreshValues();
  }

  function open(id: string): void {
    if (!defs.some((def) => def.id === id)) return;
    currentId = id;
    refresh();
  }

  return {
    rail,
    panel,
    set(next, initial) {
      const focused = rail.contains(document.activeElement);
      defs = next;
      buttons = new Map();
      rail.replaceChildren();
      let lastGroup = '';
      for (const def of defs) {
        if (def.group !== lastGroup) {
          lastGroup = def.group;
          rail.append(el('p', 'gar-grupo', def.group));
        }
        const button = btn('gar-categoria', '', () => open(def.id));
        const value = el('span', 'gar-categoria-valor');
        button.append(el('span', 'gar-categoria-nome', def.label), value);
        buttons.set(def.id, { button, value });
        rail.append(button);
      }
      const start = defs.find((def) => def.id === initial) ?? defs[0];
      if (start) open(start.id);
      if (focused) buttons.get(currentId)?.button.focus({ preventScroll: true });
    },
    open,
    refresh,
    refreshValues,
    current: () => currentId,
    dispose() {
      stopArrows();
      rail.remove();
      panel.remove();
    },
  };
}

/** Linha "rótulo + controle" de um formulário de painel. */
export function field(label: string, control: HTMLElement, hint = ''): HTMLLabelElement {
  const row = el('label', 'campo');
  row.append(el('span', 'campo-rotulo', label), control);
  if (hint) row.append(el('span', 'campo-dica', hint));
  return row;
}

/** Bloco com título pequeno, como as seções dos editores da Garagem. */
export function block(title: string, ...children: (HTMLElement | string)[]): HTMLElement {
  const node = el('section', 'pin-secao');
  node.append(el('h3', 'pin-rotulo', title), ...children);
  return node;
}

/** Número grande com legenda (pontos, partidas, melhor volta…). */
export function stat(value: string, label: string, accent = false): HTMLElement {
  const node = el('div', 'dado');
  if (accent) node.dataset.destaque = 'true';
  node.append(el('strong', 'dado-valor', value), el('span', 'dado-rotulo', label));
  return node;
}

/** Interruptor liga/desliga acessível (checkbox com aparência de chave). */
export function toggleRow(
  label: string,
  hint: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
): HTMLLabelElement {
  const row = el('label', 'chave');
  const input = el('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const text = el('span', 'chave-texto');
  text.append(el('strong', '', label));
  if (hint) text.append(el('small', '', hint));
  row.append(text, input, el('span', 'chave-trilho'));
  return row;
}
