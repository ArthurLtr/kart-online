// Copia os decodificadores Draco e Basis (KTX2) do three para public/libs,
// de onde o DRACOLoader e o KTX2Loader os carregam em tempo de execução.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const libs = `${root}node_modules/three/examples/jsm/libs`;
const out = `${root}public/libs`;

if (!existsSync(libs)) {
  console.warn('[copy-decoders] three ainda não instalado; pulando.');
  process.exit(0);
}

mkdirSync(out, { recursive: true });
cpSync(`${libs}/draco/gltf`, `${out}/draco`, { recursive: true });
cpSync(`${libs}/basis`, `${out}/basis`, { recursive: true });
console.log('[copy-decoders] decodificadores copiados para public/libs');
