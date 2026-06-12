// MestrePro Service Worker — Modo Offline + PWA
// Versão: 1.3.0 — 2026-06-12 (nova identidade visual dos ícones/splash)
const CACHE_NAME = 'mestrepro-v4';
const CACHE_STATIC = 'mestrepro-static-v4';

// Assets críticos que funcionam offline
const STATIC_ASSETS = [
  '/',
  '/pintopro-app.html',
  '/pintopro-login.html',
  '/pintopro-orcamentos.html',
  '/pintopro-laudos.html',
  '/pintopro-assinar.html',
  '/pp-modules.js',
  '/pp-config.js',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable.svg',
];

// ── INSTALL — pré-cacher assets estáticos ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(() => console.warn('[SW] Falha ao cachear:', url))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE — limpar caches antigos ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH — estratégia por tipo de request ──
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requests não-GET, extensões do browser e Supabase/APIs externas
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('anthropic.com')) return;
  if (url.hostname.includes('mercadopago.com')) return;
  if (url.hostname.includes('mercadolibre.com')) return;
  // CDNs e fontes externas — deixar passar sem interferência do SW
  if (url.hostname.includes('googleapis.com')) return;
  if (url.hostname.includes('gstatic.com')) return;
  if (url.hostname.includes('jsdelivr.net')) return;
  if (url.hostname.includes('cdnjs.cloudflare.com')) return;
  if (url.hostname.includes('unpkg.com')) return;

  // Estratégia: Network First com fallback para cache
  // Para HTML/JS/CSS: tenta rede, se falhar usa cache
  if (isStaticAsset(url)) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // Para outros requests: network only com fallback para página offline
  // IMPORTANTE: sempre retornar uma Response válida — nunca undefined
  event.respondWith(
    fetch(request).catch(() => {
      if (request.destination === 'document') {
        return caches.match('/offline.html') || new Response(OFFLINE_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      // Fallback para recursos não-documento (scripts, estilos, imagens)
      return new Response('', { status: 503, statusText: 'Service Unavailable' });
    })
  );
});

function isStaticAsset(url) {
  return STATIC_ASSETS.some(asset => url.pathname === asset || url.pathname.endsWith(asset)) ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2');
}

async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_STATIC);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Fallback: página offline para documentos
    if (request.destination === 'document') {
      return cache.match('/offline.html') || new Response(OFFLINE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    return new Response('', { status: 503 });
  }
}

// ── SYNC em background — quando reconectar ──
self.addEventListener('sync', event => {
  if (event.tag === 'sync-pending-data') {
    event.waitUntil(syncPendingData());
  }
});

async function syncPendingData() {
  // Notifica todos os clientes que a conexão voltou
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'ONLINE_RESTORED' }));
}

// Página offline embutida (fallback sem rede e sem cache)
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MestrePro — Sem conexão</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f0;color:#2c2c2a}
  .box{text-align:center;padding:40px 24px;max-width:380px}
  .icon{font-size:56px;margin-bottom:16px}
  h1{font-size:20px;font-weight:600;margin:0 0 8px}
  p{font-size:14px;color:#888;line-height:1.6;margin:0 0 24px}
  button{background:#185FA5;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:14px;cursor:pointer}
</style>
</head>
<body>
<div class="box">
  <div class="icon">📶</div>
  <h1>Você está sem internet</h1>
  <p>O MestrePro precisa de conexão para carregar pela primeira vez. Depois do primeiro acesso, muitas funções ficam disponíveis offline.</p>
  <button onclick="location.reload()">Tentar novamente</button>
</div>
</body>
</html>`;
