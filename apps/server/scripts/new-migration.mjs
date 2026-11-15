// Gera uma migração nova a partir do que mudou no schema.prisma desde a última.
// Uso: pnpm --filter @kart/server db:migration nome_da_mudanca
// Precisa do banco de desenvolvimento no ar (pnpm dev sobe o embutido). Usa um
// banco "sombra" (kart_shadow) no mesmo servidor só para comparar.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://kart:kart_dev@localhost:5432/kart_online';

const name = (process.argv[2] ?? '').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
if (!name) {
  console.error('Informe um nome: pnpm --filter @kart/server db:migration nome_da_mudanca');
  process.exit(1);
}

const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const prisma = (args, input) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', input });

const shadow = new URL(databaseUrl);
shadow.pathname = '/kart_shadow';
// Cria o banco sombra se ainda não existir (o erro de "já existe" é esperado).
prisma(['db', 'execute', '--url', databaseUrl, '--stdin'], 'CREATE DATABASE kart_shadow;');

const diff = prisma([
  'migrate',
  'diff',
  '--from-migrations',
  'prisma/migrations',
  '--to-schema-datamodel',
  'prisma/schema.prisma',
  '--shadow-database-url',
  shadow.href,
  '--script',
]);
if (diff.status !== 0) {
  console.error(diff.stderr || diff.stdout);
  process.exit(1);
}
if (/^-- This is an empty migration\.\s*$/m.test(diff.stdout) || !diff.stdout.trim()) {
  console.log('Nada mudou no schema.prisma: nenhuma migração criada.');
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const dir = join(root, 'prisma', 'migrations', `${stamp}_${name}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'migration.sql'), diff.stdout);
console.log(`Migração criada: prisma/migrations/${stamp}_${name}/migration.sql`);
