import { currentAccount } from '../net/account';
import { amountTag } from './currency';

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
    level = rating.division ? `Nv ${me.level.level} · ${rating.division}` : `Nv ${me.level.level}`;
  }
  const text = span('piloto-texto', '');
  const line = span('piloto-nivel', level);
  if (me) {
    // Saldo com os ícones oficiais da moeda e da gema.
    const wallet = span('piloto-saldo', '');
    wallet.append(amountTag('coin', me.coins), amountTag('gem', me.gems));
    line.append(wallet);
  }
  text.append(span('piloto-nome', name), line);
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
