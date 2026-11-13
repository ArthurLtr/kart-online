import type { Currency } from '@kart/shared';
import { CurrencyPreview3D } from '../models/CurrencyPreview3D';
import type { CurrencyKind } from '../models/currencyModels';
import { CURRENCY_ICONS } from '../models/currencyModels';
import { btn, el } from './dom';

export type { CurrencyKind };

export const kindOf = (currency: Currency): CurrencyKind => (currency === 'coins' ? 'coin' : 'gem');

const NAMES: Record<CurrencyKind, [string, string]> = {
  coin: ['moeda', 'moedas'],
  gem: ['gema', 'gemas'],
};

/** Ícone oficial da moeda ou da gema (decorativo: o texto ao lado diz o valor). */
export function currencyIcon(kind: CurrencyKind): HTMLImageElement {
  const image = el('img', 'icone-moeda');
  image.src = CURRENCY_ICONS[kind];
  image.alt = '';
  image.decoding = 'async';
  image.dataset.moeda = kind;
  return image;
}

/** Ícone + valor ("🪙 1.250"), com o nome da moeda para leitor de tela. */
export function amountTag(kind: CurrencyKind, value: number, prefix = ''): HTMLElement {
  const tag = el('span', 'valor-moeda');
  tag.dataset.moeda = kind;
  const [one, many] = NAMES[kind];
  tag.setAttribute(
    'aria-label',
    `${prefix}${value.toLocaleString('pt-BR')} ${value === 1 ? one : many}`,
  );
  tag.append(currencyIcon(kind), el('span', '', `${prefix}${value.toLocaleString('pt-BR')}`));
  return tag;
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Ícones voando até o contador do topo (cartão do piloto) quando a conta ganha
 * moedas ou gemas. Só DOM e Web Animations: nada de WebGL extra.
 */
export function playCurrencyBurstEffect(
  type: CurrencyKind,
  targetElement: HTMLElement,
  origin?: HTMLElement,
): Promise<void> {
  const end = targetElement.getBoundingClientRect();
  const start = origin?.getBoundingClientRect();
  const fromX = start ? start.left + start.width / 2 : window.innerWidth / 2;
  const fromY = start ? start.top + start.height / 2 : window.innerHeight / 2;
  const toX = end.left + end.width / 2;
  const toY = end.top + end.height / 2;
  const pulse = (): void => {
    targetElement.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
      { duration: 260, easing: 'ease-out' },
    );
  };
  if (reducedMotion()) {
    pulse();
    return Promise.resolve();
  }
  const count = 10;
  const flights: Promise<unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const icon = currencyIcon(type);
    icon.classList.add('moeda-voando');
    document.body.append(icon);
    const angle = (i / count) * Math.PI * 2;
    const spread = 40 + (i % 3) * 18;
    const midX = fromX + Math.cos(angle) * spread;
    const midY = fromY + Math.sin(angle) * spread - 30;
    const animation = icon.animate(
      [
        { transform: `translate(${fromX}px, ${fromY}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${midX}px, ${midY}px) scale(1.15)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${toX}px, ${toY}px) scale(0.55)`, opacity: 0.9 },
      ],
      {
        duration: 820,
        delay: i * 45,
        easing: 'cubic-bezier(0.45, 0, 0.2, 1)',
        fill: 'backwards',
      },
    );
    flights.push(
      animation.finished.then(
        () => {
          icon.remove();
          if (i === 0 || i === count - 1) pulse();
        },
        () => icon.remove(),
      ),
    );
  }
  return Promise.all(flights).then(() => undefined);
}

/** Dispara o efeito no cartão do piloto, se ele estiver na tela. */
export function burstToPilot(type: CurrencyKind, origin?: HTMLElement): void {
  const card = document.querySelector<HTMLElement>('#piloto');
  if (card && card.offsetParent !== null) void playCurrencyBurstEffect(type, card, origin);
}

export interface PurchaseConfirm {
  itemName: string;
  rarityTag: HTMLElement;
  price: number;
  currency: Currency;
}

/**
 * Modal de confirmação de compra com a moeda (ou a gema) girando em 3D acima
 * do valor. Resolve `true` se o jogador confirmar. O canvas é liberado ao fechar.
 */
export function confirmPurchase(options: PurchaseConfirm): Promise<boolean> {
  return new Promise((resolve) => {
    const kind = kindOf(options.currency);
    const dialog = el('dialog', 'modal-compra');
    dialog.dataset.moeda = kind;
    dialog.setAttribute('aria-labelledby', 'modal-compra-titulo');
    const preview = new CurrencyPreview3D(kind, 132);
    const title = el('h2', '', `Comprar ${options.itemName}?`);
    title.id = 'modal-compra-titulo';
    const price = el('p', 'modal-compra-preco');
    price.append(amountTag(kind, options.price));
    let answer = false;
    const actions = el('div', 'botoes');
    const ok = btn(kind === 'gem' ? 'gema' : 'primario', 'Confirmar compra', () => {
      answer = true;
      dialog.close();
    });
    actions.append(
      btn('', 'Cancelar', () => dialog.close()),
      ok,
    );
    dialog.append(
      preview.canvas,
      price,
      title,
      options.rarityTag,
      el('p', 'nota', 'Itens são só visuais: nada muda o desempenho do kart.'),
      actions,
    );
    dialog.addEventListener('close', () => {
      preview.dispose();
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
    ok.focus();
  });
}
