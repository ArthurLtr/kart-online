/**
 * Desenho da loja paga (NÃO implementada nesta etapa: o inventário é concedido
 * por seed ou por administrador).
 *
 * Fluxo previsto:
 * 1. Cliente pede POST /api/payments/checkout { itemId } → o servidor chama
 *    `createCheckout` e devolve a URL de pagamento do provedor.
 * 2. O provedor chama POST /api/payments/webhook quando o pagamento conclui.
 * 3. O servidor valida a assinatura com `parseWebhook` e, se `paid`, concede o
 *    item com Accounts.grant(userId, itemId, 'purchase'). O `eventId` é
 *    guardado para o mesmo aviso não conceder duas vezes.
 * Contas de menores (`minor`) não podem iniciar checkout.
 */
export interface CheckoutRequest {
  userId: string;
  itemId: string;
  /** Preço em centavos. */
  amountCents: number;
  currency: 'BRL';
}

export interface PaymentEvent {
  /** Id único do aviso no provedor (idempotência). */
  eventId: string;
  userId: string;
  itemId: string;
  status: 'paid' | 'refunded' | 'failed';
}

export interface PaymentProvider {
  createCheckout(request: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  /** Valida a assinatura do webhook e devolve o evento; lança se for inválida. */
  parseWebhook(rawBody: string, signature: string | undefined): PaymentEvent;
}

/** Provedor de mentira: deixa claro que a loja ainda não existe. */
export class StubPaymentProvider implements PaymentProvider {
  createCheckout(): Promise<{ checkoutUrl: string }> {
    return Promise.reject(new Error('Loja não implementada nesta etapa.'));
  }
  parseWebhook(): PaymentEvent {
    throw new Error('Loja não implementada nesta etapa.');
  }
}
