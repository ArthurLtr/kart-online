import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import colyseus from 'colyseus';
import { ROOM_NAME } from '@kart/shared';
import { Accounts } from './accounts/accounts.js';
import { config } from './config.js';
import { openDatabase } from './db/database.js';
import { createApi } from './http/api.js';
import type { MatchCreator, QueueStore } from './ranked/matchmaking.js';
import { Matchmaker, MemoryQueueStore, RedisQueueStore } from './ranked/matchmaking.js';
import { RaceRoom } from './rooms/RaceRoom.js';
import type { Services } from './services.js';
import { setServices } from './services.js';

// O pacote colyseus é CommonJS: no Node ESM só o export default é confiável.
const { Server, matchMaker } = colyseus;

/** Sala ranqueada: só entra quem a fila escolheu, com um bilhete de uso único. */
const createRankedMatch =
  (serverKey: string): MatchCreator =>
  async (userIds) => {
    const tickets = Object.fromEntries(userIds.map((userId) => [randomUUID(), userId]));
    const room = await matchMaker.createRoom(ROOM_NAME, { mode: 'ranked', serverKey, tickets });
    const reservations = new Map<string, unknown>();
    for (const [ticket, userId] of Object.entries(tickets)) {
      reservations.set(userId, await matchMaker.reserveSeatFor(room, { mode: 'ranked', ticket }));
    }
    return reservations;
  };

async function queueStore(): Promise<QueueStore> {
  if (!config.redisUrl) {
    console.log('[fila] sem REDIS_URL: fila de matchmaking na memória');
    return new MemoryQueueStore();
  }
  const { Redis } = await import('ioredis');
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
  await redis.ping();
  console.log('[fila] Redis conectado');
  return new RedisQueueStore(redis);
}

async function startServices(): Promise<Services | null> {
  try {
    const prisma = await openDatabase();
    const accounts = new Accounts(prisma);
    const season = await accounts.season();
    const serverKey = randomUUID();
    const matchmaker = new Matchmaker(
      await queueStore(),
      config.matchmaking,
      createRankedMatch(serverKey),
    );
    matchmaker.start();
    console.log(`[banco] pronto. ${season.name} até ${season.endsAt.toLocaleDateString('pt-BR')}`);
    return { prisma, accounts, matchmaker, serverKey };
  } catch (error) {
    console.error('[banco] indisponível: contas e Ranqueado desligados.', error);
    return null;
  }
}

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
