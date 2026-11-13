// Para o PostgreSQL embutido de desenvolvimento (o que sobe sozinho sem Docker).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const { pg_ctl } = await import(
  pathToFileURL(
    createRequire(require.resolve('embedded-postgres')).resolve(
      `@embedded-postgres/${platform}-${process.arch}`,
    ),
  ).href
);
const dataDir = fileURLToPath(new URL('../.data/pg', import.meta.url));
spawnSync(pg_ctl, ['stop', '-D', dataDir, '-m', 'fast'], { stdio: 'inherit' });
