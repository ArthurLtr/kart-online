import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import colyseus from 'colyseus';
import type { QueueKind } from '@kart/shared';
import { botSkillFor, initPhysics, ROOM_NAME } from '@kart/shared';
import { Accounts } from './accounts/accounts.js';
import { config } from './config.js';
import { openDatabase } from './db/database.js';
import { createApi } from './http/api.js';
import type { MatchCreator, QueueStore } from './ranked/matchmaking.js';
import { createQueueAudit } from './ranked/audit.js';
import {
  averageSkill,
  Matchmaker,
  MemoryQueueStore,
  RedisQueueStore,
} from './ranked/matchmaking.js';
import { RaceRoom } from './rooms/RaceRoom.js';
import type { Services } from './services.js';
import { setServices } from './services.js';

// O pacote colyseus é CommonJS: no Node ESM só o export default é confiável.
const { Server, matchMaker } = colyseus;

/**
 * Sala de fila: só entra quem a fila escolheu, com um bilhete de uso único.
 * No Casual os bots completam o grid, no nível da habilidade média do grupo.
 */
const createQueuedMatch =
  (serverKey: string, mode: QueueKind): MatchCreator =>
  async (group) => {
    const tickets = Object.fromEntries(group.map(({ userId }) => [randomUUID(), userId]));
    const room = await matchMaker.createRoom(ROOM_NAME, {
      mode,
      serverKey,
      tickets,
      botSkill: botSkillFor(averageSkill(group) / 100),
    });
    const reservations = new Map<string, unknown>();
    for (const [ticket, userId] of Object.entries(tickets)) {
      reservations.set(userId, await matchMaker.reserveSeatFor(room, { mode, ticket }));
    }
    return { roomId: room.roomId, reservations };
  };

async function queueStores(): Promise<Record<QueueKind, QueueStore>> {
  if (!config.redisUrl) {
    console.log('[fila] sem REDIS_URL: filas de pareamento na memória');
    return { casual: new MemoryQueueStore(), ranked: new MemoryQueueStore() };
  }
  const { Redis } = await import('ioredis');
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  await redis.ping();
  console.log('[fila] Redis conectado');
  return {
    casual: new RedisQueueStore(redis, 'casual'),
    ranked: new RedisQueueStore(redis, 'ranked'),
  };
}

async function startServices(): Promise<Services | null> {
  try {
    const prisma = await openDatabase();
    const accounts = new Accounts(prisma);
    const season = await accounts.season();
    const serverKey = randomUUID();
    const stores = await queueStores();
    const audit = createQueueAudit(prisma);
    const queue = (kind: QueueKind): Matchmaker =>
      new Matchmaker(
        kind,
        stores[kind],
        config.matchmaking[kind],
        createQueuedMatch(serverKey, kind),
        audit,
      );
    const matchmakers = { casual: queue('casual'), ranked: queue('ranked') };
    matchmakers.casual.start(500);
    matchmakers.ranked.start();
    console.log(`[banco] pronto. ${season.name} até ${season.endsAt.toLocaleDateString('pt-BR')}`);
    return { prisma, accounts, matchmakers, serverKey };
  } catch (error) {
    console.error('[banco] indisponível: contas e Ranqueado desligados.', error);
    return null;
  }
}

// O Rapier (colisões) é WASM: carrega antes de qualquer sala existir.
await initPhysics();
const services = await startServices();
if (services) setServices(services);
const api = createApi(services);

const httpServer = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, accounts: services !== null }));
    return;
  }
  api(request, response);
});

const gameServer = new Server({ server: httpServer });
// Cada modo tem as suas salas: quem pede Casual só cai em sala Casual.
gameServer.define(ROOM_NAME, RaceRoom).filterBy(['mode']);

await gameServer.listen(config.port);
console.log(`Servidor Kart Online ouvindo em ws://localhost:${config.port}`);
