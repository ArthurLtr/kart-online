import type { OrderView } from '@kart/shared';
import { formatBrl, GEM_PACKAGES } from '@kart/shared';
import { createGemOrder, currentAccount, devPayOrder, fetchGemOrder } from '../net/account';
import { formatCoins, formatGems } from '../ui/buy';
import { amountTag, burstToPilot } from '../ui/currency';
import { updatePilot } from '../ui/shell';
import { btn, el } from '../ui/dom';
import { block, stat } from '../ui/sections';

export interface GemStoreOptions {
  setStatus(text: string, isError?: boolean): void;
  /** Chamado quando as gemas entram na conta (o perfil já foi recarregado). */
  onPaid(): void;
}

/** Intervalo entre as consultas do pedido enquanto o Pix não é pago. */
const POLL_MS = 4000;

const BADGES = { popular: 'Mais popular', best: 'Melhor valor' } as const;

/**
 * Loja de gemas: escolhe um pacote, recebe o QR do Pix e espera a confirmação.
 * As gemas só entram quando o servidor confirma o pagamento com o provedor.
 * Devolve a função que desliga a espera (chamar ao sair da tela).
 */
export function renderGemStore(body: HTMLElement, options: GemStoreOptions): () => void {
  let stopped = false;
  let timer = 0;
  const stop = (): void => {
    stopped = true;
    window.clearTimeout(timer);
  };
  const me = currentAccount();
  if (!me) return stop;

  const wallet = el('div', 'dados');
  wallet.append(stat(me.gems.toLocaleString('pt-BR'), 'Gemas', true));
  const area = el('div', 'loja-gemas');
  body.append(wallet, area);

  const error = (text: string): HTMLElement => {
    const node = el('p', 'erro', text);
    node.setAttribute('role', 'alert');
    return node;
  };

  function showPackages(message = ''): void {
    area.replaceChildren();
    if (message) area.append(error(message));
    if (me?.user.minor) {
      area.append(
        block(
          'Compras com dinheiro real',
          el(
            'p',
            'nota',
            'Só maiores de 18 anos podem comprar gemas. Os itens de moedas continuam todos liberados para você: é só correr.',
          ),
        ),
      );
      return;
    }
    const list = el('ul', 'pacotes');
    for (const pack of GEM_PACKAGES) {
      const card = el('li', 'pacote');
      card.dataset.pacote = pack.art;
      if (pack.badge) {
        card.dataset.destaque = pack.badge;
        card.append(el('span', 'pacote-selo', BADGES[pack.badge]));
      }
      const art = el('img', 'pacote-arte');
      art.src = `/assets/currency/${pack.art}.webp`;
      art.alt = '';
      art.decoding = 'async';
      const values = el('div', 'pacote-valores');
      values.append(amountTag('gem', pack.gems));
      const bonus = el('span', 'pacote-bonus');
      bonus.append(amountTag('coin', pack.coins, '+'), el('small', '', 'de bônus'));
      const buy = btn('gema', `Pix · ${formatBrl(pack.amountCents)}`, () => {
        for (const button of list.querySelectorAll('button')) button.disabled = true;
        options.setStatus('Gerando o Pix…');
        createGemOrder(pack.id)
          .then((order) => {
            if (!stopped) showOrder(order);
          })
          .catch((reason: unknown) => {
            if (!stopped) {
              showPackages(reason instanceof Error ? reason.message : 'Não consegui gerar o Pix.');
            }
          });
      });
      buy.setAttribute(
        'aria-label',
        `Comprar ${pack.name}: ${formatGems(pack.gems)} e ${formatCoins(pack.coins)} por ${formatBrl(pack.amountCents)} no Pix`,
      );
      card.append(art, el('h3', 'pacote-nome', pack.name), values, bonus, buy);
      list.append(card);
    }
    area.append(
      list,
      el(
        'p',
        'nota',
        'Pagamento por Pix. Gemas e moedas entram na conta assim que o banco confirma, em geral em segundos. Gemas compram itens épicos, lendários e exclusivos; nada do que se compra muda o desempenho do kart.',
      ),
    );
  }

  function showOrder(order: OrderView): void {
    area.replaceChildren();
    if (order.status === 'PAID') {
      // O perfil já foi recarregado por quem trouxe o pedido pago.
      options.setStatus(
        order.coins > 0
          ? `${formatGems(order.gems)} e ${formatCoins(order.coins)} na sua conta`
          : `${formatGems(order.gems)} na sua conta`,
      );
      updatePilot();
      burstToPilot('gem', area);
      if (order.coins > 0) window.setTimeout(() => burstToPilot('coin', area), 260);
      options.onPaid();
      return;
    }
    if (order.status !== 'PENDING') {
      showPackages(
        order.status === 'EXPIRED' ? 'O Pix venceu. Gere outro.' : 'Este pedido foi estornado.',
      );
      return;
    }
    options.setStatus('Aguardando o pagamento do Pix');
    const image = el('img', 'pix-qr');
    image.src = `data:image/png;base64,${order.qrCodeBase64}`;
    image.alt = 'QR code do Pix';
    const code = el('textarea', 'pix-codigo');
    code.readOnly = true;
    code.rows = 3;
    code.value = order.qrCode;
    code.setAttribute('aria-label', 'Código Pix copia e cola');
    const actions = el('div', 'botoes');
    actions.append(
      btn('primario', 'Copiar código', () => {
        navigator.clipboard
          ?.writeText(order.qrCode)
          .then(() => options.setStatus('Código Pix copiado'))
          .catch(() => {
            code.select();
            options.setStatus('Selecionei o código: copie com Ctrl+C', true);
          });
      }),
      btn('', 'Cancelar', () => {
        window.clearTimeout(timer);
        options.setStatus('Pedido deixado de lado');
        showPackages();
      }),
    );
    if (import.meta.env.DEV) {
      // Só com o Pix de mentira do servidor de desenvolvimento: não envolve dinheiro.
      actions.append(
        btn('', 'Simular pagamento (dev)', () => {
          devPayOrder(order.orderId)
            .then((paid) => {
              if (!stopped) showOrder(paid);
            })
            .catch((reason: unknown) => {
              options.setStatus(reason instanceof Error ? reason.message : 'Falhou.', true);
            });
        }),
      );
    }
    const expires = new Date(order.expiresAt).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    area.append(
      block(
        `${formatGems(order.gems)}${order.coins > 0 ? ` + ${formatCoins(order.coins)}` : ''} · ${formatBrl(order.amountCents)}`,
        image,
        el(
          'p',
          'nota',
          'Abra o app do seu banco, escolha Pix e leia o QR, ou cole o código abaixo.',
        ),
        code,
        actions,
        el('p', 'nota', `Aguardando o pagamento… O código vale até ${expires}.`),
      ),
    );
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      fetchGemOrder(order.orderId)
        .then((next) => {
          if (!stopped) showOrder(next);
        })
        .catch(() => {
          if (!stopped) showOrder(order); // falha passageira: tenta de novo
        });
    }, POLL_MS);
  }

  showPackages();
  return stop;
}
