/* Service worker do Kart Online: deixa o app instalável e o jogo carregando rápido.
 *
 * Nunca passa pelo cache: API (/api/, inclusive webhooks de pagamento),
 * matchmaking do Colyseus (/matchmake/), /health, WebSockets, métodos que não
 * são GET e qualquer endereço de outro site (Google, Mercado Pago…).
 *
 * - Página (navegação): rede primeiro, cache só se estiver offline.
 * - Arquivos do Vite com hash no nome: cache primeiro (o nome muda a cada versão).
 * - Demais arquivos (modelos .glb, imagens, sons, ícones): responde do cache e
 *   atualiza em segundo plano, para uma troca de arte chegar na próxima abertura.
 *
 * Mudou a lógica deste arquivo? Suba CACHE_VERSION: os caches antigos são apagados.
 */
const CACHE_VERSION = 'kart-online-v1';
const PAGES = `${CACHE_VERSION}-paginas`;
const STATIC = `${CACHE_VERSION}-arquivos`;

const NETWORK_ONLY = [/^\/api\//, /^\/matchmake\//, /^\/health$/, /^\/sw\.js$/];
const HASHED = /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
const STATIC_FILE =
  /\.(?:js|mjs|css|wasm|glb|gltf|bin|ktx2|webp|png|jpe?g|svg|ico|mp3|ogg|wav|woff2?|webmanifest)$/i;

self.addEventListener('install', (event) => {
  // A página inicial já fica guardada para abrir mesmo com a rede instável.
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.add(new Request('/', { cache: 'reload' })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('kart-online-') && !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (NETWORK_ONLY.some((pattern) => pattern.test(url.pathname))) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else if (HASHED.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (STATIC_FILE.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    // Uma página só (o jogo é de tela única): guarda sempre como "/".
    if (response.ok) await cache.put('/', response.clone());
    return response;
  } catch (error) {
    const cached = (await cache.match(request)) ?? (await cache.match('/'));
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }
  const response = await fresh;
  return response ?? Response.error();
}
