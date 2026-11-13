import { currentAccount } from '../net/account';
import { formatCoins, formatGems } from './buy';

/** Casca de navegação: cartão do piloto no topo e dicas de atalho no rodapé. */

export interface Hint {
  /** Teclas, já legíveis ("Enter", "← →"). */
  keys: readonly string[];
  label: string;
}

/** Iniciais do nome para o emblema do piloto ("Ana Souza" → "AS"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase() || '?';
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * Reabre a tela do endereço atual. Usado depois de entrar ou sair da conta: a
 * mesma rota passa a mostrar outra coisa (o jogo ou a tela de entrada).
 */
export function reopenScreen(): void {
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Redesenha o cartão do piloto com o último perfil carregado. */
export function updatePilot(): void {
  const card = document.querySelector<HTMLElement>('#piloto');
  if (!card) return;
  const me = currentAccount();
  const name = me?.user.name ?? 'Piloto';
  let level = 'Entrar';
  if (me) {
    const { rating } = me;
    const career = `Nv ${me.level.level} · ${formatCoins(me.coins)} · ${formatGems(me.gems)}`;
    level = rating.division ? `${career} · ${rating.division}` : career;
  }
  const text = span('piloto-texto', '');
  text.append(span('piloto-nome', name), span('piloto-nivel', level));
  card.replaceChildren(span('piloto-sigla', me ? initials(name) : '?'), text);
}

/** Troca as dicas de atalho do rodapé (lista vazia esconde). */
export function setHints(hints: readonly Hint[]): void {
  const list = document.querySelector<HTMLElement>('#dicas');
  if (!list) return;
  list.replaceChildren(
    ...hints.map((hint) => {
      const item = document.createElement('li');
      for (const key of hint.keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        item.append(kbd);
      }
      item.append(hint.label);
      return item;
    }),
  );
}
