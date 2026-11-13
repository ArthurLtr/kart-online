import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../accounts/auth.js';
import {
  createPaymentProvider,
  FakePixProvider,
  MercadoPagoPixProvider,
  mercadoPagoSignatureValid,
} from './PaymentProvider.js';

const SECRET = 'segredo-de-teste';
const sign = (dataId: string, requestId: string, ts: string, secret = SECRET): string => {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`;
};

describe('assinatura do webhook do Mercado Pago', () => {
  it('aceita a assinatura certa', () => {
    expect(
      mercadoPagoSignatureValid(SECRET, '123456', 'req-1', sign('123456', 'req-1', '1700')),
    ).toBe(true);
  });

  it('recusa outro segredo, outro id, outro request-id e cabeçalho torto', () => {
    const good = sign('123456', 'req-1', '1700');
    expect(mercadoPagoSignatureValid('outro', '123456', 'req-1', good)).toBe(false);
    expect(mercadoPagoSignatureValid(SECRET, '999999', 'req-1', good)).toBe(false);
    expect(mercadoPagoSignatureValid(SECRET, '123456', 'req-2', good)).toBe(false);
    expect(mercadoPagoSignatureValid(SECRET, '123456', 'req-1', 'v1=abc')).toBe(false);
    expect(mercadoPagoSignatureValid(SECRET, '123456', 'req-1', '')).toBe(false);
  });

  it('o provedor só devolve a cobrança de um aviso de pagamento bem assinado', () => {
    const provider = new MercadoPagoPixProvider('token', SECRET, undefined);
    const request = (signature: string, type = 'payment') => ({
      rawBody: JSON.stringify({ type, data: { id: '123456' } }),
      headers: { 'x-signature': signature, 'x-request-id': 'req-1' },
      query: new URLSearchParams({ 'data.id': '123456', type }),
    });
    expect(provider.parseWebhook(request(sign('123456', 'req-1', '1700')))).toBe('123456');
    expect(
      provider.parseWebhook(request(sign('123456', 'req-1', '1700'), 'merchant_order')),
    ).toBeNull();
    expect(() => provider.parseWebhook(request('ts=1700,v1=forjada'))).toThrow(HttpError);
  });

  it('sem segredo configurado, nenhum aviso é aceito', () => {
    const provider = new MercadoPagoPixProvider('token', undefined, undefined);
    expect(() =>
      provider.parseWebhook({
        rawBody: '{}',
        headers: {},
        query: new URLSearchParams({ 'data.id': '1', type: 'payment' }),
      }),
    ).toThrow(HttpError);
  });
});

describe('provedor em uso', () => {
  const base = { mercadoPagoWebhookSecret: undefined, publicApiUrl: undefined };

  it('em produção sem token a loja fica desligada; nunca usa o Pix de mentira', () => {
    expect(
      createPaymentProvider({ ...base, production: true, mercadoPagoToken: undefined }),
    ).toBeNull();
    expect(
      createPaymentProvider({ ...base, production: false, mercadoPagoToken: undefined }),
    ).toBeInstanceOf(FakePixProvider);
    expect(
      createPaymentProvider({ ...base, production: true, mercadoPagoToken: 'token' }),
    ).toBeInstanceOf(MercadoPagoPixProvider);
  });

  it('Pix de mentira: cobrança nasce pendente e só muda quando acertada', async () => {
    const fake = new FakePixProvider();
    const charge = await fake.createPixCharge({
      orderId: 'pedido-1',
      amountCents: 490,
      description: 'teste',
      payerEmail: 'a@b.test',
      expiresAt: new Date(),
    });
    expect(await fake.fetchCharge(charge.externalId)).toMatchObject({
      orderId: 'pedido-1',
      status: 'pending',
      amountCents: 490,
    });
    expect(fake.settle(charge.externalId, 'paid')).toBe(true);
    expect((await fake.fetchCharge(charge.externalId)).status).toBe('paid');
    expect(fake.settle('inexistente', 'paid')).toBe(false);
  });
});
