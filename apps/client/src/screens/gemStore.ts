import type { OrderView } from '@kart/shared';
import { formatBrl, GEM_PACKAGES } from '@kart/shared';
import { createGemOrder, currentAccount, devPayOrder, fetchGemOrder } from '../net/account';
import { formatGems } from '../ui/buy';
import { btn, el } from '../ui/dom';
import { block, stat } from '../ui/sections';

export interface GemStoreOptions {
  setStatus(text: string, isError?: boolean): void;
  /** Chamado quando as gemas entram na conta (o perfil já foi recarregado). */
  onPaid(): void;
}

/** Intervalo entre as consultas do pedido enquanto o Pix não é pago. */
const POLL_MS = 4000;

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
      const row = el('li', 'pacote');
      const text = el('span', 'pacote-texto');
      text.append(el('strong', '', formatGems(pack.gems)), el('small', '', pack.name));
      const buy = btn('gema', formatBrl(pack.amountCents), () => {
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
        `Comprar ${formatGems(pack.gems)} por ${formatBrl(pack.amountCents)} no Pix`,
      );
      const cell = el('span', 'botoes');
      cell.append(buy);
      row.append(text, cell);
      list.append(row);
    }
    area.append(
      block('Pacotes de gemas', list),
      el(
        'p',
        'nota',
        'Pagamento por Pix. As gemas entram na conta assim que o banco confirma, em geral em segundos. Gemas compram itens épicos, lendários e exclusivos; nada do que se compra muda o desempenho do kart.',
      ),
    );
  }

  function showOrder(order: OrderView): void {
    area.replaceChildren();
    if (order.status === 'PAID') {
      // O perfil já foi recarregado por quem trouxe o pedido pago.
      options.setStatus(`${formatGems(order.gems)} na sua conta`);
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
        `${formatGems(order.gems)} · ${formatBrl(order.amountCents)}`,
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
