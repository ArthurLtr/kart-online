import type { PrismaClient } from '@prisma/client';
import type { QueueAudit } from './matchmaking.js';

/**
 * Grava no banco cada passagem pela fila: quando entrou, com que habilidade,
 * quanto esperou, com que faixa a partida saiu e em que sala. A fila viva
 * continua no Redis (ou na memória); isto é o histórico para medir o equilíbrio.
 */
export function createQueueAudit(prisma: PrismaClient): QueueAudit {
  return {
    async joined(queue, ticket) {
      // Passagem antiga que ficou aberta (servidor reiniciado, aba fechada) é encerrada.
      await prisma.matchmakingTicket.updateMany({
        where: { userId: ticket.userId, outcome: 'waiting' },
        data: { outcome: 'left', closedAt: new Date(ticket.joinedAt) },
      });
      await prisma.matchmakingTicket.create({
        data: {
          userId: ticket.userId,
          queue,
          skill: ticket.skill,
          uncertainty: ticket.uncertainty,
          joinedAt: new Date(ticket.joinedAt),
        },
      });
    },
    async left(queue, userId, now) {
      const open = await prisma.matchmakingTicket.findFirst({
        where: { userId, queue, outcome: 'waiting' },
        orderBy: { joinedAt: 'desc' },
      });
      if (!open) return;
      await prisma.matchmakingTicket.update({
        where: { id: open.id },
        data: {
          outcome: 'left',
          closedAt: new Date(now),
          waitedMs: Math.max(0, now - open.joinedAt.getTime()),
        },
      });
    },
    async matched(queue, group, roomId, bands, now) {
      for (const [i, ticket] of group.entries()) {
        const open = await prisma.matchmakingTicket.findFirst({
          where: { userId: ticket.userId, queue, outcome: 'waiting' },
          orderBy: { joinedAt: 'desc' },
        });
        if (!open) continue;
        await prisma.matchmakingTicket.update({
          where: { id: open.id },
          data: {
            outcome: 'matched',
            closedAt: new Date(now),
            waitedMs: Math.max(0, now - ticket.joinedAt),
            band: bands[i] ?? null,
            roomId,
          },
        });
      }
    },
  };
}
