import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

/** Nome com o hash de conteúdo do Vite (ex.: index-B1x9_kQz.js). */
const HASHED_NAME = /-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

/**
 * Entrega o cliente compilado (apps/client/dist). Arquivos com hash no nome
 * (pasta assets/ do Vite) ficam em cache por um ano; o resto, sempre
 * revalidado. Rota desconhecida sem extensão cai no index.html.
 */
export function createStaticHandler(dir: string) {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`Cliente compilado não encontrado em ${root} (rode pnpm build).`);
  }

  const send = (request: IncomingMessage, response: ServerResponse, file: string): void => {
    const size = statSync(file).size;
    // Só arquivos do Vite com hash no nome; as artes de public/assets mudam sem trocar de nome.
    const hashed = file.startsWith(join(root, 'assets') + sep) && HASHED_NAME.test(file);
    response.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': size,
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  };

  return function serve(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
    } catch {
      response.writeHead(400).end();
      return;
    }
    const file = normalize(join(root, path));
    // Nada fora da pasta do cliente.
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isFile()) {
      send(request, response, file);
      return;
    }
    if (extname(path)) {
      response
        .writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Não encontrado.');
      return;
    }
    send(request, response, join(root, 'index.html'));
  };
}
