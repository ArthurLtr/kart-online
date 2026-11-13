import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../accounts/auth.js';

/**
 * Pagamento por Pix para a compra de gemas.
 *
 * Fluxo:
 * 1. POST /api/store/create-order → o servidor cria o pedido (PENDING) e pede
 *    ao provedor uma cobrança Pix; devolve o QR e o código "copia e cola".
 * 2. O jogador paga no app do banco. O provedor avisa POST /api/webhooks/payment.
 * 3. O servidor confere a assinatura do aviso e, em vez de acreditar no que
 *    veio no corpo, consulta a cobrança direto no provedor. Só então marca o
 *    pedido como PAID e credita as gemas, uma única vez.
 */

export interface PixChargeRequest {
  /** Id do nosso pedido (PaymentOrder): volta na consulta da cobrança. */
  orderId: string;
  amountCents: number;
  description: string;
  payerEmail: string;
  expiresAt: Date;
}

export interface PixCharge {
  /** Id da cobrança no provedor. */
  externalId: string;
  /** Código "copia e cola". */
  qrCode: string;
  /** Imagem do QR, PNG em base64. */
  qrCodeBase64: string;
}

export interface WebhookRequest {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  query: URLSearchParams;
}

/** Estado de uma cobrança, lido direto do provedor. */
export interface ChargeStatus {
  externalId: string;
  /** Nosso pedido, como foi enviado na criação da cobrança. */
  orderId: string | null;
  status: 'pending' | 'paid' | 'expired' | 'refunded';
  amountCents: number;
}

export interface PaymentProvider {
  readonly name: string;
  createPixCharge(request: PixChargeRequest): Promise<PixCharge>;
  /**
   * Confere a assinatura do aviso e devolve o id da cobrança de que ele fala
   * (`null` = aviso de outro assunto, para ignorar). Lança HttpError 401 se a
   * assinatura não confere.
   */
  parseWebhook(request: WebhookRequest): string | null;
  /** Consulta a cobrança no provedor: é esta resposta que vale, não o corpo do aviso. */
  fetchCharge(externalId: string): Promise<ChargeStatus>;
}

const header = (request: WebhookRequest, name: string): string => {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
};

const MP_API = 'https://api.mercadopago.com';

/**
 * Assinatura dos webhooks do Mercado Pago: o cabeçalho `x-signature` traz
 * `ts=…,v1=…`, onde v1 é o HMAC-SHA256 (com o segredo da aplicação) do texto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 */
export function mercadoPagoSignatureValid(
  secret: string,
  dataId: string,
  requestId: string,
  signature: string,
): boolean {
  const parts = new Map(
    signature.split(',').map((part) => {
      const [key = '', value = ''] = part.split('=');
      return [key.trim(), value.trim()] as const;
    }),
  );
  const ts = parts.get('ts');
  const given = parts.get('v1');
  if (!ts || !given) return false;
  // Id alfanumérico entra em minúsculas no texto assinado.
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

const MP_STATUS: Record<string, ChargeStatus['status']> = {
  approved: 'paid',
  refunded: 'refunded',
  charged_back: 'refunded',
  cancelled: 'expired',
  rejected: 'expired',
};

/** Pix pelo Mercado Pago (API REST de pagamentos). */
export class MercadoPagoPixProvider implements PaymentProvider {
  readonly name = 'mercadopago';

  constructor(
    private readonly accessToken: string,
    private readonly webhookSecret: string | undefined,
    /** Endereço público do servidor, para o Mercado Pago avisar do pagamento. */
    private readonly publicApiUrl: string | undefined,
  ) {}

  private async call(method: string, path: string, body?: unknown, idempotencyKey?: string) {
    let response: Response;
    try {
      response = await fetch(MP_API + path, {
        method,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
          ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new HttpError(502, 'Não consegui falar com o Mercado Pago. Tente de novo.');
    }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      console.error('[pix] Mercado Pago recusou', response.status, data.message ?? '');
      throw new HttpError(502, 'O Mercado Pago recusou a cobrança. Tente de novo em instantes.');
    }
    return data;
  }

  async createPixCharge(request: PixChargeRequest): Promise<PixCharge> {
    const data = await this.call(
      'POST',
      '/v1/payments',
      {
        transaction_amount: request.amountCents / 100,
        description: request.description,
        payment_method_id: 'pix',
        payer: { email: request.payerEmail },
        external_reference: request.orderId,
        date_of_expiration: request.expiresAt.toISOString(),
        ...(this.publicApiUrl
          ? { notification_url: `${this.publicApiUrl.replace(/\/$/, '')}/api/webhooks/payment` }
          : {}),
      },
      // O mesmo pedido nunca gera duas cobranças.
      request.orderId,
    );
    const transaction = ((data.point_of_interaction as Record<string, unknown> | undefined)
      ?.transaction_data ?? {}) as Record<string, unknown>;
    const qrCode = transaction.qr_code;
    const qrCodeBase64 = transaction.qr_code_base64;
    if (data.id === undefined || typeof qrCode !== 'string' || typeof qrCodeBase64 !== 'string') {
      throw new HttpError(502, 'O Mercado Pago não devolveu o QR do Pix.');
    }
    return { externalId: String(data.id), qrCode, qrCodeBase64 };
  }

  parseWebhook(request: WebhookRequest): string | null {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(request.rawBody || '{}') as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Aviso inválido.');
    }
    const dataId =
      request.query.get('data.id') ??
      String((body.data as Record<string, unknown> | undefined)?.id ?? '');
    const topic = request.query.get('type') ?? String(body.type ?? '');
    if (!this.webhookSecret) {
      throw new HttpError(503, 'Webhook do Mercado Pago sem segredo configurado.');
    }
    const valid = mercadoPagoSignatureValid(
      this.webhookSecret,
      dataId,
      header(request, 'x-request-id'),
      header(request, 'x-signature'),
    );
    if (!valid) throw new HttpError(401, 'Assinatura do aviso não confere.');
    return topic === 'payment' && dataId ? dataId : null;
  }

  async fetchCharge(externalId: string): Promise<ChargeStatus> {
    if (!/^\d{1,32}$/.test(externalId)) throw new HttpError(400, 'Cobrança inválida.');
    const data = await this.call('GET', `/v1/payments/${externalId}`);
    return {
      externalId,
      orderId: typeof data.external_reference === 'string' ? data.external_reference : null,
      status: MP_STATUS[String(data.status)] ?? 'pending',
      amountCents: Math.round(Number(data.transaction_amount) * 100),
    };
  }
}

/**
 * Pix de mentira, só para desenvolvimento (nunca em produção): não envolve
 * dinheiro. O pagamento é "feito" pela rota POST /api/store/dev-pay.
 */
export class FakePixProvider implements PaymentProvider {
  readonly name = 'fake';
  private readonly charges = new Map<string, ChargeStatus>();

  async createPixCharge(request: PixChargeRequest): Promise<PixCharge> {
    const externalId = `fake-${randomBytes(6).toString('hex')}`;
    this.charges.set(externalId, {
      externalId,
      orderId: request.orderId,
      status: 'pending',
      amountCents: request.amountCents,
    });
    return {
      externalId,
      qrCode: `PIX-DE-TESTE-${externalId}-NAO-PAGUE`,
      // PNG 1×1 transparente: em desenvolvimento não há QR de verdade.
      qrCodeBase64:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    };
  }

  /** Marca a cobrança como paga ou estornada (o que o banco faria de verdade). */
  settle(externalId: string, status: 'paid' | 'refunded'): boolean {
    const charge = this.charges.get(externalId);
    if (!charge) return false;
    charge.status = status;
    return true;
  }

  parseWebhook(request: WebhookRequest): string | null {
    return request.query.get('data.id');
  }

  async fetchCharge(externalId: string): Promise<ChargeStatus> {
    const charge = this.charges.get(externalId);
    if (!charge) throw new HttpError(404, 'Cobrança não encontrada.');
    return { ...charge };
  }
}

export interface PaymentSettings {
  production: boolean;
  mercadoPagoToken: string | undefined;
  mercadoPagoWebhookSecret: string | undefined;
  publicApiUrl: string | undefined;
}

/** Provedor em uso: Mercado Pago com token; em desenvolvimento sem token, o de mentira. */
export function createPaymentProvider(settings: PaymentSettings): PaymentProvider | null {
  if (settings.mercadoPagoToken) {
    return new MercadoPagoPixProvider(
      settings.mercadoPagoToken,
      settings.mercadoPagoWebhookSecret,
      settings.publicApiUrl,
    );
  }
  return settings.production ? null : new FakePixProvider();
}
