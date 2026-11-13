import type { IncomingMessage, ServerResponse } from 'node:http';
import type { QueueKind } from '@kart/shared';
import { skillNumber } from '@kart/shared';
import { HttpError } from '../accounts/auth.js';
import { config } from '../config.js';
import type { Services } from '../services.js';

const MAX_BODY_BYTES = 40_000;

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Requisição grande demais.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString()) as unknown;
    if (typeof body === 'object' && body !== null) return body as Record<string, unknown>;
  } catch {
    // cai no erro abaixo
  }
  throw new HttpError(400, 'JSON inválido.');
}

/** Limite de tentativas por endereço nas rotas de login e cadastro. */
class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  check(key: string, now = Date.now()): void {
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.max) {
      throw new HttpError(429, 'Muitas tentativas. Espere um minuto.');
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
  }
}

/**
 * API HTTP de contas, inventário e fila ranqueada. Devolve `true` se a rota
 * era dela (as demais ficam com o Colyseus).
 */
export function createApi(services: Services | null) {
  const authLimiter = new RateLimiter(10, 60_000);

  async function route(request: IncomingMessage, path: string): Promise<unknown> {
    if (!services) throw new HttpError(503, 'Contas indisponíveis: o servidor está sem banco.');
    const { accounts, matchmakers } = services;
    const method = request.method ?? 'GET';
    const key = `${method} ${path}`;
    const bearer = request.headers.authorization?.replace(/^Bearer /, '');
    const optionalUser = (): string | null => accounts.userIdOf(bearer);
    const user = (): string => {
      const id = optionalUser();
      if (!id) throw new HttpError(401, 'Entre na sua conta.');
      return id;
    };
    const address = request.socket.remoteAddress ?? '?';

    switch (key) {
      case 'POST /api/auth/guest':
        authLimiter.check(address);
        return accounts.guest((await readJson(request)).name);
      case 'POST /api/auth/register':
        authLimiter.check(address);
        return accounts.register(await readJson(request), optionalUser());
      case 'POST /api/auth/login':
        authLimiter.check(address);
        return accounts.login(await readJson(request));
      case 'GET /api/me':
        return accounts.me(user());
      case 'PUT /api/loadout':
        return { loadout: await accounts.setLoadout(user(), await readJson(request)) };
      case 'GET /api/ranking':
        return { ranking: await accounts.ranking() };
      case 'POST /api/queue/join': {
        const userId = user();
        const queue: QueueKind = (await readJson(request)).queue === 'casual' ? 'casual' : 'ranked';
        const player = await accounts.player(userId);
        if (!player) throw new HttpError(401, 'Sessão inválida.');
        if (queue === 'ranked' && player.guest) {
          throw new HttpError(403, 'O Ranqueado exige conta com e-mail. Crie a sua no Perfil.');
        }
        // Um jogador fica numa fila só.
        await matchmakers[queue === 'casual' ? 'ranked' : 'casual'].leave(userId);
        const skill = await accounts.queueSkill(userId, queue);
        await matchmakers[queue].join(userId, skillNumber(skill.mu), skillNumber(skill.sigma));
        return matchmakers[queue].status(userId);
      }
      case 'POST /api/queue/leave': {
        const userId = user();
        await Promise.all([matchmakers.casual.leave(userId), matchmakers.ranked.leave(userId)]);
        return { ok: true };
      }
      case 'GET /api/queue/status': {
        const userId = user();
        const casual = await matchmakers.casual.status(userId);
        return casual.state === 'idle' ? matchmakers.ranked.status(userId) : casual;
      }
      case 'POST /api/admin/grant': {
        if (!config.adminKey || request.headers['x-admin-key'] !== config.adminKey) {
          throw new HttpError(403, 'Acesso negado.');
        }
        const body = await readJson(request);
        await accounts.grant(body.user, body.item);
        return { ok: true };
      }
      case 'POST /api/payments/webhook':
        // Fluxo desenhado em payments/PaymentProvider.ts; a loja não existe nesta etapa.
        throw new HttpError(501, 'Loja não implementada.');
      default:
        throw new HttpError(404, 'Rota não encontrada.');
    }
  }

  return function handle(request: IncomingMessage, response: ServerResponse): boolean {
    const path = (request.url ?? '').split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return false;
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
      'cache-control': 'no-store',
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers).end();
      return true;
    }
    route(request, path)
      .then((body) => response.writeHead(200, headers).end(JSON.stringify(body)))
      .catch((error: unknown) => {
        const known = error instanceof HttpError;
        if (!known) console.error('[api]', error);
        response
          .writeHead(known ? error.status : 500, headers)
          .end(JSON.stringify({ error: known ? error.message : 'Erro interno.' }));
      });
    return true;
  };
}
