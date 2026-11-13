import type { Currency } from '@kart/shared';
import { buyBlock, catalogItem, priceIn, rarityLabel } from '@kart/shared';
import { currentAccount, purchaseItem } from '../net/account';
import { amountTag, confirmPurchase, kindOf } from './currency';
import { btn, el } from './dom';

/** "1.250 moedas" (com o separador de milhar do português). */
export const formatCoins = (coins: number): string =>
  `${coins.toLocaleString('pt-BR')} ${coins === 1 ? 'moeda' : 'moedas'}`;

export const formatGems = (gems: number): string =>
  `${gems.toLocaleString('pt-BR')} ${gems === 1 ? 'gema' : 'gemas'}`;

export const formatPrice = (amount: number, currency: Currency): string =>
  currency === 'coins' ? formatCoins(amount) : formatGems(amount);

/** Etiqueta com a raridade de um item do catálogo. */
export function rarityTag(itemId: string): HTMLElement {
  const item = catalogItem(itemId);
  const tag = el('span', 'raridade', item ? rarityLabel(item.rarity) : '');
  tag.dataset.raridade = item?.rarity ?? 'common';
  return tag;
}

/** Uma frase dizendo como se consegue o item (ou que ele já é do jogador). */
export function priceLine(itemId: string): string {
  const item = catalogItem(itemId);
  const account = currentAccount();
  if (!item) return '';
  if (account?.inventory.includes(itemId)) return 'Na sua coleção';
  if (item.isDefault) return 'Item básico';
  const parts: string[] = [];
  if (item.priceCoins !== null) {
    parts.push(
      formatCoins(item.priceCoins) + (item.unlockLevel > 0 ? ` (nível ${item.unlockLevel})` : ''),
    );
  }
  if (item.priceGems !== null) parts.push(formatGems(item.priceGems));
  return parts.join(' ou ');
}

export interface BuyOptions {
  /** Chamado depois de uma compra feita (o perfil já foi recarregado). */
  onBought(itemId: string): void;
  onError(message: string): void;
}

/**
 * Botões de compra de um item: um por moeda em que ele é vendido. Botão
 * desligado diz o motivo no próprio rótulo (falta nível, falta saldo).
 */
export function buyButtons(itemId: string, options: BuyOptions): HTMLElement {
  const row = el('div', 'botoes comprar');
  const item = catalogItem(itemId);
  const account = currentAccount();
  if (!item || !account || account.inventory.includes(itemId)) return row;
  const buttons: HTMLButtonElement[] = [];
  for (const currency of ['coins', 'gems'] as const) {
    const price = priceIn(item, currency);
    if (price === null) continue;
    const balance = currency === 'coins' ? account.coins : account.gems;
    const block = buyBlock(itemId, currency, account.level.level, balance, account.inventory);
    const label =
      block === 'level'
        ? `Nível ${item.unlockLevel} · ${formatPrice(price, currency)}`
        : block === 'balance'
          ? `Faltam ${formatPrice(price - balance, currency)}`
          : `Comprar · ${formatPrice(price, currency)}`;
    const kind = kindOf(currency);
    const button = btn(currency === 'gems' ? 'gema' : 'primario', '', () => {
      for (const other of buttons) other.disabled = true;
      void confirmPurchase({ itemName: item.name, rarityTag: rarityTag(itemId), price, currency })
        .then((yes) => {
          if (!yes) {
            for (const other of buttons) other.disabled = other.dataset.bloqueado === 'true';
            return;
          }
          return purchaseItem(itemId, currency).then(() => options.onBought(itemId));
        })
        .catch((reason: unknown) => {
          options.onError(reason instanceof Error ? reason.message : 'Não consegui comprar.');
        });
    });
    // Rótulo com o ícone oficial no lugar do nome da moeda.
    button.append(
      block === 'level'
        ? `Nível ${item.unlockLevel} · `
        : block === 'balance'
          ? 'Faltam '
          : 'Comprar · ',
      amountTag(kind, block === 'balance' ? price - balance : price),
    );
    button.dataset.bloqueado = String(block !== null);
    button.disabled = block !== null;
    button.setAttribute(
      'aria-label',
      `Comprar ${item.name} por ${formatPrice(price, currency)}${block ? ` (${label})` : ''}`,
    );
    buttons.push(button);
    row.append(button);
  }
  return row;
}
