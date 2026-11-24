/**
 * Service worker: caches the app shell so the PWA opens fast and offline
 * (`SPEC.md` §13). Every decision comes from `./sw-policy`; a `bypass`
 * request is not answered here at all, so the browser handles it as if no
 * worker existed.
 */
import {
  SHELL_CACHE,
  cacheKeyFor,
  cachePutKey,
  isCacheable,
  precacheList,
  staleCacheKeys,
  swStrategy,
} from './sw-policy';

declare const self: ServiceWorkerGlobalScope;
/** Replaced with the build's /assets/ files by `shellAssetsPlugin` (vite.config.ts). */
declare const __SHELL_ASSETS__: readonly string[];

const PRECACHE = precacheList(__SHELL_ASSETS__);

/**
 * Fetch and check every precache URL before storing any. Unlike
 * `cache.addAll`, this rejects the SPA fallback's HTML served for a file
 * that is missing (say, mid-deploy), so install fails and the previous
 * worker stays in charge instead of caching index.html as JavaScript.
 */
async function precache(): Promise<void> {
  const responses = await Promise.all(
    PRECACHE.map(async (url) => {
      const response = await fetch(url, { cache: 'reload' });
      const { pathname } = new URL(url, self.location.origin);
      if (!response.ok || !isCacheable(pathname, response.headers.get('content-type'), false)) {
        throw new Error(`precache refused ${url}: ${response.status} ${response.headers.get('content-type')}`);
      }
      return [url, response] as const;
    }),
  );
  const cache = await caches.open(SHELL_CACHE);
  for (const [url, response] of responses) await cache.put(url, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL_CACHE) await caches.delete(key);
      const cache = await caches.open(SHELL_CACHE);
      const cached = (await cache.keys()).map((r) => r.url);
      for (const url of staleCacheKeys(cached, PRECACHE, self.location.origin)) await cache.delete(url);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const strategy = swStrategy(event.request, self.location.origin);
  if (strategy === 'bypass') return;
  event.respondWith(strategy === 'cache-first' ? cacheFirst(event.request) : networkFirst(event.request));
});

/** Store `response` if the policy allows; reports whether it did. */
async function store(request: Request, response: Response): Promise<boolean> {
  if (!response.ok) return false;
  const key = cachePutKey(request, response.headers.get('content-type'));
  if (key === null) return false;
  await (await caches.open(SHELL_CACHE)).put(key, response.clone());
  return true;
}

/** /assets/ files: content-hashed, so a cached copy is always right. */
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && !(await store(request, response))) {
    // The SPA fallback's HTML for a missing asset: an honest 404 instead.
    return new Response(null, { status: 404, statusText: 'Not Found' });
  }
  return response;
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    await store(request, response);
    return response;
  } catch (err) {
    const cached = await caches.match(cacheKeyFor(request));
    if (cached) return cached;
    throw err;
  }
}
