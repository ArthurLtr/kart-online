import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const REFERENCES_DIR = resolve(__dirname, '../../referencias');
const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Serve as imagens de referencias/ em /referencias/ só no servidor de
 * desenvolvimento, para a garagem comparar lado a lado. Não existe no build:
 * imagens de referência nunca vão para o jogo final.
 */
function referenceImages(): Plugin {
  return {
    name: 'kart-reference-images',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/referencias', (request, response, next) => {
        const name = decodeURIComponent((request.url ?? '').split('?')[0] ?? '').replace(/^\//, '');
        const extension = name.split('.').pop()?.toLowerCase() ?? '';
        const type = IMAGE_TYPES[extension];
        // Só nomes simples de imagem: nada de subpastas nem "..".
        if (!type || !/^[\w .+()-]+$/.test(name)) return next();
        const file = resolve(REFERENCES_DIR, name);
        if (!existsSync(file)) return next();
        response.setHeader('Content-Type', type);
        createReadStream(file).pipe(response);
      });
    },
  };
}

export default defineConfig({
  plugins: [referenceImages()],
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
