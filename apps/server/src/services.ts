import type { PrismaClient } from '@prisma/client';
import type { Accounts } from './accounts/accounts.js';
import type { Matchmaker } from './ranked/matchmaking.js';

/** Tudo o que depende do banco. Sem banco, o servidor ainda roda Casual e Sala privada sem conta. */
export interface Services {
  prisma: PrismaClient;
  accounts: Accounts;
  matchmaker: Matchmaker;
  /** Segredo do processo: só o próprio servidor consegue criar sala ranqueada. */
  serverKey: string;
}

let current: Services | null = null;

export function setServices(services: Services): void {
  current = services;
}

export function getServices(): Services | null {
  return current;
}
