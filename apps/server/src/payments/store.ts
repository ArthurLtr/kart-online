import type { PrismaClient } from '@prisma/client';
import type { OrderView } from '@kart/shared';
import { gemPackage } from '@kart/shared';
import { ageOn, HttpError } from '../accounts/auth.js';
import type { PaymentProvider } from './PaymentProvider.js';

/** Idade mínima para comprar com dinheiro real. */
export const MIN_PURCHASE_AGE = 18;

type Order = {
  id: string;
  status: OrderView['status'];
  gemsAmount: number;
  coinsBonus: number;
  amountBrl: number;
  qrCode: string | null;
  qrCodeBase64: string | null;
  expiresAt: Date;
};

const view = (order: Order): OrderView => ({
  orderId: order.id,
  status: order.status,
  gems: order.gemsAmount,
  coins: order.coinsBonus,
  amountCents: order.amountBrl,
  qrCode: order.qrCode ?? '',
  qrCodeBase64: order.qrCodeBase64 ?? '',
  expiresAt: order.expiresAt.toISOString(),
});

/** Loja de gemas: cria pedidos Pix e credita as gemas quando o provedor confirma. */
export class GemStore {
  constructor(
    private readonly prisma: PrismaClient,
    readonly provider: PaymentProvider | null,
    private readonly pixMinutes: number,
  ) {}

  private requireProvider(): PaymentProvider {
    if (!this.provider) {
      throw new HttpError(503, 'A loja de gemas não está configurada neste servidor.');
    }
    return this.provider;
  }

  /**
   * Cria o pedido e a cobrança Pix. Menor de 18 (ou conta sem data de
   * nascimento) não compra com dinheiro real.
   */
  async createOrder(userId: string, packageId: unknown, now = new Date()): Promise<OrderView> {
    const provider = this.requireProvider();
    const pack = typeof packageId === 'string' ? gemPackage(packageId) : undefined;
    if (!pack) throw new HttpError(404, 'Pacote de gemas não encontrado.');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isGuest || !user.email) {
      throw new HttpError(403, 'Entre na sua conta para comprar gemas.');
    }
    if (!user.birthDate || ageOn(user.birthDate, now) < MIN_PURCHASE_AGE) {
      throw new HttpError(
        403,
        'Compras com dinheiro real são só para maiores de 18 anos. Todos os itens de moedas continuam liberados para você.',
      );
    }
    const expiresAt = new Date(now.getTime() + this.pixMinutes * 60_000);
    const order = await this.prisma.paymentOrder.create({
      data: {
        userId,
        packageId: pack.id,
        amountBrl: pack.amountCents,
        gemsAmount: pack.gems,
        coinsBonus: pack.coins,
        provider: provider.name,
        expiresAt,
      },
    });
    try {
      const charge = await provider.createPixCharge({
        orderId: order.id,
        amountCents: pack.amountCents,
        description: `Kart Online: ${pack.gems} gemas`,
        payerEmail: user.email,
        expiresAt,
      });
      const saved = await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          externalId: charge.externalId,
          qrCode: charge.qrCode,
          qrCodeBase64: charge.qrCodeBase64,
        },
      });
      return view(saved);
    } catch (error) {
      // Sem cobrança, o pedido não serve para nada.
      await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: { status: 'EXPIRED' },
      });
      throw error;
    }
  }

  /** Estado de um pedido do próprio jogador. Pedido vencido é marcado como tal. */
  async order(userId: string, orderId: unknown, now = new Date()): Promise<OrderView> {
    if (typeof orderId !== 'string') throw new HttpError(400, 'Informe o pedido.');
    let order = await this.prisma.paymentOrder.findFirst({ where: { id: orderId, userId } });
    if (!order) throw new HttpError(404, 'Pedido não encontrado.');
    if (order.status === 'PENDING' && order.externalId && this.provider) {
      // Se o aviso do provedor se perdeu, a consulta do jogador resolve.
      await this.settle(order.externalId).catch(() => undefined);
      order = (await this.prisma.paymentOrder.findUnique({ where: { id: order.id } })) ?? order;
    }
    if (order.status === 'PENDING' && order.expiresAt < now) {
      await this.prisma.paymentOrder.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      order = { ...order, status: 'EXPIRED' };
    }
    return view(order);
  }

  /**
   * Consulta a cobrança no provedor e acerta o pedido. Idempotente: o crédito
   * acontece na mesma transação que tira o pedido de PENDING, então o mesmo
   * aviso chegando duas (ou dez) vezes credita uma vez só.
   * @returns o que mudou neste chamado
   */
  async settle(externalId: string): Promise<'paid' | 'refunded' | 'unchanged'> {
    const provider = this.requireProvider();
    const charge = await provider.fetchCharge(externalId);
    const order = await this.prisma.paymentOrder.findUnique({
      where: { provider_externalId: { provider: provider.name, externalId } },
    });
    if (!order) return 'unchanged';
    // A cobrança tem de ser a deste pedido e no valor certo.
    if (charge.orderId !== order.id || charge.amountCents !== order.amountBrl) {
      console.error(`[pix] cobrança ${externalId} não bate com o pedido ${order.id}`);
      return 'unchanged';
    }
    if (charge.status === 'paid') {
      return this.prisma.$transaction(async (tx) => {
        const marked = await tx.paymentOrder.updateMany({
          where: { id: order.id, status: { in: ['PENDING', 'EXPIRED'] } },
          data: { status: 'PAID', paidAt: new Date() },
        });
        if (marked.count !== 1) return 'unchanged' as const;
        await tx.user.update({
          where: { id: order.userId },
          data: { gems: { increment: order.gemsAmount } },
        });
        await tx.gemLedger.create({
          data: {
            userId: order.userId,
            amount: order.gemsAmount,
            type: 'purchase',
            referenceId: order.id,
          },
        });
        if (order.coinsBonus > 0) {
          await tx.profile.updateMany({
            where: { userId: order.userId },
            data: { coins: { increment: order.coinsBonus } },
          });
          await tx.coinEntry.create({
            data: { userId: order.userId, amount: order.coinsBonus, reason: 'pix', ref: order.id },
          });
        }
        return 'paid' as const;
      });
    }
    if (charge.status === 'refunded') {
      return this.prisma.$transaction(async (tx) => {
        const marked = await tx.paymentOrder.updateMany({
          where: { id: order.id, status: 'PAID' },
          data: { status: 'REFUNDED' },
        });
        if (marked.count !== 1) return 'unchanged' as const;
        // O saldo pode ficar negativo se as gemas já foram gastas: fica registrado.
        await tx.user.update({
          where: { id: order.userId },
          data: { gems: { decrement: order.gemsAmount } },
        });
        await tx.gemLedger.create({
          data: {
            userId: order.userId,
            amount: -order.gemsAmount,
            type: 'refund',
            referenceId: order.id,
          },
        });
        if (order.coinsBonus > 0) {
          await tx.profile.updateMany({
            where: { userId: order.userId },
            data: { coins: { decrement: order.coinsBonus } },
          });
          await tx.coinEntry.create({
            data: {
              userId: order.userId,
              amount: -order.coinsBonus,
              reason: 'refund',
              ref: order.id,
            },
          });
        }
        return 'refunded' as const;
      });
    }
    if (charge.status === 'expired') {
      await this.prisma.paymentOrder.updateMany({
        where: { id: order.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
    }
    return 'unchanged';
  }
}
