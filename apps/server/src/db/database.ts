import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { CATALOG_ITEMS, DEFAULT_ITEM_IDS, paintRequirements } from '@kart/shared';
import { config, SERVER_ROOT } from '../config.js';

function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * Sem Docker na máquina de desenvolvimento, sobe um PostgreSQL de verdade
 * (binários do pacote embedded-postgres) no mesmo endereço do docker-compose.
 * Fica rodando como serviço à parte, então sobrevive aos reinícios do servidor;
 * os dados ficam em apps/server/.data/pg. Para parar: pnpm db:stop.
 */
async function startEmbedded(url: URL, restart = false): Promise<void> {
  const require = createRequire(import.meta.url);
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const binaries = (await import(
    pathToFileURL(
      createRequire(require.resolve('embedded-postgres')).resolve(
        `@embedded-postgres/${platform}-${process.arch}`,
      ),
    ).href
  )) as { pg_ctl: string; initdb: string };
  const dataDir = join(SERVER_ROOT, '.data', 'pg');
  const run = (file: string, args: string[]): void => {
    // Sem herdar a saída: o postgres fica vivo e seguraria o pipe aberto.
    const result = spawnSync(file, args, { stdio: 'ignore', timeout: 60_000 });
    if (result.status !== 0) throw new Error(`${file} ${args[0]} falhou (${result.status})`);
  };
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    mkdirSync(dataDir, { recursive: true });
    const passwordFile = join(SERVER_ROOT, '.data', 'pwfile');
    writeFileSync(passwordFile, decodeURIComponent(url.password));
    run(binaries.initdb, [
      '-D',
      dataDir,
      '-U',
      decodeURIComponent(url.username),
      '--auth=scram-sha-256',
      `--pwfile=${passwordFile}`,
      '-E',
      'UTF8',
    ]);
    rmSync(passwordFile);
  }
  run(binaries.pg_ctl, [
    restart ? 'restart' : 'start',
    '-w',
    '-D',
    dataDir,
    '-l',
    join(SERVER_ROOT, '.data', 'postgres.log'),
    '-o',
    `-p ${url.port || 5432} -c listen_addresses=localhost`,
  ]);
  console.log('[banco] PostgreSQL embutido no ar (sem Docker)');
}

/** Cria/atualiza as tabelas a partir do schema.prisma (só em desenvolvimento). */
function pushSchema(): void {
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [cli, 'db', 'push', '--skip-generate'], {
    cwd: SERVER_ROOT,
    env: { ...process.env, DATABASE_URL: config.databaseUrl },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`prisma db push falhou:\n${result.stderr}`);
}

/** Seed idempotente: o catálogo de cosméticos (raridade e preços) e a migração das contas antigas. */
export async function seed(prisma: PrismaClient): Promise<void> {
  for (const item of CATALOG_ITEMS) {
    const data = {
      slot: item.slot,
      key: item.key,
      name: item.name,
      starter: item.isDefault,
      rarity: item.rarity,
      priceCoins: item.priceCoins,
      priceGems: item.priceGems,
      unlockLevel: item.unlockLevel,
    };
    await prisma.cosmeticItem.upsert({
      where: { id: item.id },
      create: { id: item.id, ...data },
      update: data,
    });
  }
  await migrateLegacyAccounts(prisma);
}

/**
 * Contas de antes do kart inicial: já tinham um visual gravado, então não
 * passam pelo onboarding. Recebem os itens básicos e ficam com tudo o que
 * estavam usando (na época era livre), para ninguém perder o próprio kart.
 */
async function migrateLegacyAccounts(prisma: PrismaClient): Promise<void> {
  const known = new Set(CATALOG_ITEMS.map((item) => item.id));
  const legacy = await prisma.user.findMany({
    where: { hasCompletedOnboarding: false, isGuest: false, loadout: { isNot: null } },
    include: { loadout: true },
  });
  for (const user of legacy) {
    const data = (user.loadout?.data ?? {}) as Record<string, unknown>;
    const using = new Set(DEFAULT_ITEM_IDS);
    for (const [slot, key] of Object.entries(data)) {
      if (typeof key === 'string' && known.has(`${slot}:${key}`)) using.add(`${slot}:${key}`);
    }
    for (const id of paintRequirements(data.$paint)) if (known.has(id)) using.add(id);
    await prisma.$transaction([
      prisma.inventory.createMany({
        data: [...using].map((itemId) => ({ userId: user.id, itemId, source: 'legacy' })),
        skipDuplicates: true,
      }),
      prisma.user.update({ where: { id: user.id }, data: { hasCompletedOnboarding: true } }),
    ]);
  }
  if (legacy.length > 0) console.log(`[banco] ${legacy.length} conta(s) antiga(s) migrada(s)`);
}

/** Garante o banco no ar, com tabelas e seed, e devolve o cliente Prisma. */
export async function openDatabase(): Promise<PrismaClient> {
  const url = new URL(config.databaseUrl);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!(await reachable(url.hostname, Number(url.port || 5432)))) {
    if (!local || config.production) throw new Error(`Banco inacessível em ${url.host}`);
    console.log('[banco] iniciando PostgreSQL embutido…');
    await startEmbedded(url);
  }
  if (!config.production) {
    console.log('[banco] conferindo tabelas…');
    try {
      pushSchema();
    } catch (error) {
      // O PostgreSQL embutido às vezes fica de pé sem aceitar conexões (no Windows,
      // quando o terminal que o iniciou fecha). Reiniciar resolve; os dados ficam.
      if (!local || !existsSync(join(SERVER_ROOT, '.data', 'pg', 'PG_VERSION'))) throw error;
      console.log('[banco] sem resposta: reiniciando o PostgreSQL embutido…');
      await startEmbedded(url, true);
      pushSchema();
    }
  }
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl });
  await seed(prisma);
  return prisma;
}
