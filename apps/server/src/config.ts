import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_DEFAULT_PORT } from '@kart/shared';

/** Pasta apps/server (um nível acima de src/ ou dist/). */
export const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const envFile = resolve(SERVER_ROOT, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const number = (name: string, fallback: number): number => {
  const value = Number(env[name]);
  return env[name] !== undefined && Number.isFinite(value) ? value : fallback;
};

export const config = {
  production: env.NODE_ENV === 'production',
  port: number('SERVER_PORT', SERVER_DEFAULT_PORT),
  databaseUrl: env.DATABASE_URL ?? 'postgresql://kart:kart_dev@localhost:5432/kart_online',
  /** Sem REDIS_URL a fila de matchmaking fica na memória do processo (só desenvolvimento). */
  redisUrl: env.REDIS_URL,
  /** Assina as sessões. Em produção é obrigatório definir. */
  authSecret: env.AUTH_SECRET ?? 'kart-dev-nao-use-em-producao',
  /** Chave das rotas de administração; sem ela, as rotas ficam desligadas. */
  adminKey: env.ADMIN_KEY,
  seasonName: env.SEASON_NAME ?? 'Temporada 1',
  seasonDays: number('SEASON_DAYS', 90),
  matchmaking: {
    /** Karts por partida ranqueada. */
    size: number('RANKED_PLAYERS', 9),
    /** Depois de `shortAfterSeconds` de espera, a partida sai com pelo menos isto. */
    minPlayers: number('RANKED_MIN_PLAYERS', 2),
    /** Diferença de pontos aceita no começo da espera. */
    baseBand: number('MM_BASE_BAND', 200),
    /** A faixa começa a crescer depois deste tempo. */
    widenAfterSeconds: number('MM_WIDEN_AFTER', 30),
    /** Quanto a faixa cresce a cada 10 s depois disso. */
    widenStep: number('MM_WIDEN_STEP', 150),
    shortAfterSeconds: number('MM_SHORT_AFTER', 60),
  },
};

export type MatchmakingConfig = typeof config.matchmaking;

if (config.production && !env.AUTH_SECRET) {
  throw new Error('Defina AUTH_SECRET em produção.');
}
