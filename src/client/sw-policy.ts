/**
 * What the service worker does with each request, and what it keeps, as pure
 * functions so the unit leg can test them without a browser.
 *
 * The rule that matters (`SPEC.md` §13, plan stage 1.5.1): the service worker
 * never answers `/ws` or `/api`. Gameplay needs a live connection, and a
 * cached API response or a stale shell in place of a room would be a silent
 * desync rather than an honest error.
 */

/** The one cache. Entries are bounded by `cacheKeyFor` and `staleCacheKeys`. */
export const SHELL_CACHE = 'sketchy-shell-v1';

/** Fixed shell files; the build adds its hashed /assets/ files (`precacheList`). */
export const SHELL_URLS: readonly string[] = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/**
 * Everything fetched on install so the shell opens offline after one visit:
 * the fixed files plus the build's assets, which the Vite build writes into
 * sw.js (`shellAssetsPlugin` in vite.config.ts). Because that list carries
 * content hashes, every build changes sw.js, so browsers install the new
 * worker and its activate step clears the previous build's assets.
 */
export function precacheList(builtAssets: readonly string[]): string[] {
  return [...SHELL_URLS, ...builtAssets];
}

export type SwStrategy = 'bypass' | 'network-first' | 'cache-first';

export interface SwRequest {
  url: string;
  method: string;
  mode?: string;
}

function isServerPath(pathname: string): boolean {
  return (
    pathname === '/ws' ||
    pathname.startsWith('/ws/') ||
    pathname === '/api' ||
    pathname.startsWith('/api/')
  );
}

export function swStrategy(request: SwRequest, origin: string): SwStrategy {
  if (request.method !== 'GET') return 'bypass';
  const url = new URL(request.url);
  if (url.origin !== origin) return 'bypass';
  if (isServerPath(url.pathname)) return 'bypass';
  // Vite content-hashes everything under /assets/, so a cached copy is never stale.
  if (url.pathname.startsWith('/assets/')) return 'cache-first';
  // The shell, manifest and icons: fresh when online, cached when not.
  return 'network-first';
}

/**
 * The cache key to look a request up under. Every navigation (`/`,
 * `/join/ABCD`, …) is the same SPA shell, so all of them share the key `/`
 * instead of each room code storing its own copy of index.html.
 */
export function cacheKeyFor(request: SwRequest): string {
  return request.mode === 'navigate' ? '/' : request.url;
}

/**
 * Whether a response may be cached for this path. Only the shell is HTML: a
 * navigation, or the precached `/` itself. Anything else that comes back as
 * HTML is the asset layer's SPA fallback for a missing file (wrangler.jsonc
 * `not_found_handling`), e.g. an old build's /assets/ file after a deploy;
 * caching it would serve index.html as JavaScript until the next deploy.
 * Likewise a navigation that is not HTML (opening the manifest or an icon in
 * a tab) must not replace the offline shell.
 */
export function isCacheable(pathname: string, contentType: string | null, isNavigation: boolean): boolean {
  const html = (contentType ?? '').trim().toLowerCase().startsWith('text/html');
  const expectsHtml = isNavigation || pathname === '/';
  return expectsHtml ? html : !html;
}

/** The key to store a fresh response under, or null to leave it uncached. */
export function cachePutKey(request: SwRequest, contentType: string | null): string | null {
  const isNavigation = request.mode === 'navigate';
  const { pathname } = new URL(request.url);
  return isCacheable(pathname, contentType, isNavigation) ? cacheKeyFor(request) : null;
}

/**
 * Cached URLs to delete on activate: everything not in the current precache
 * list. That removes the previous builds' /assets/ and any other same-origin
 * file the worker cached at runtime under its own URL, so after each activate
 * the cache holds only the current precache list.
 */
export function staleCacheKeys(
  cachedUrls: readonly string[],
  precache: readonly string[],
  origin: string,
): string[] {
  const keep = new Set(precache.map((p) => new URL(p, origin).href));
  return cachedUrls.filter((u) => !keep.has(new URL(u, origin).href));
}
