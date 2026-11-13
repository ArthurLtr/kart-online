import type { PrismaClient } from '@prisma/client';
import type { QueueKind } from '@kart/shared';
import type { Accounts } from './accounts/accounts.js';
import type { GemStore } from './payments/store.js';
import type { Matchmaker } from './ranked/matchmaking.js';

/** Tudo o que depende do banco. Sem banco, o servidor ainda roda Casual e Sala privada sem conta. */
export interface Services {
  prisma: PrismaClient;
  accounts: Accounts;
  /** Loja de gemas (Pix). */
  store: GemStore;
  /** Uma fila de pareamento por modo. */
  matchmakers: Record<QueueKind, Matchmaker>;
  /** Segredo do processo: só o próprio servidor consegue criar sala de fila. */
  serverKey: string;
}

let current: Services | null = null;

export function setServices(services: Services): void {
  current = services;
}

export function getServices(): Services | null {
  return current;
}
