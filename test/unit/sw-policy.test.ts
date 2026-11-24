import { describe, expect, it } from 'vitest';
import {
  cacheKeyFor,
  cachePutKey,
  isCacheable,
  precacheList,
  staleCacheKeys,
  swStrategy,
} from '../../src/client/sw-policy';

const ORIGIN = 'https://sketchy.example.workers.dev';
const get = (path: string) => ({ url: `${ORIGIN}${path}`, method: 'GET' });

describe('service worker fetch policy (stage 1.5.1)', () => {
  it('never answers /ws or /api, whatever the method or query', () => {
    for (const path of ['/ws', '/ws/ABCD', '/ws/ABCD?x=1', '/api', '/api/health', '/api/room/ABCD/x']) {
      expect(swStrategy(get(path), ORIGIN), path).toBe('bypass');
      expect(swStrategy({ url: `${ORIGIN}${path}`, method: 'POST' }, ORIGIN), path).toBe('bypass');
    }
  });

  it('does not mistake look-alike paths for server paths', () => {
    expect(swStrategy(get('/wsx'), ORIGIN)).toBe('network-first');
    expect(swStrategy(get('/apiary'), ORIGIN)).toBe('network-first');
  });

  it('bypasses non-GET and cross-origin requests', () => {
    expect(swStrategy({ url: `${ORIGIN}/`, method: 'POST' }, ORIGIN)).toBe('bypass');
    expect(swStrategy({ url: 'https://fonts.example.com/a.css', method: 'GET' }, ORIGIN)).toBe('bypass');
  });

  it('serves hashed assets cache-first and the shell network-first', () => {
    expect(swStrategy(get('/assets/main-abc123.js'), ORIGIN)).toBe('cache-first');
    expect(swStrategy(get('/'), ORIGIN)).toBe('network-first');
    expect(swStrategy(get('/join/ABCD'), ORIGIN)).toBe('network-first');
    expect(swStrategy(get('/manifest.webmanifest'), ORIGIN)).toBe('network-first');
  });

  it('precaches nothing it would refuse to serve', () => {
    for (const path of precacheList(['/assets/main-abc.js'])) {
      expect(swStrategy(get(path), ORIGIN), path).not.toBe('bypass');
    }
  });
});

describe('service worker cache bounds', () => {
  it('precaches the shell plus the build assets', () => {
    const list = precacheList(['/assets/main-abc.js', '/assets/main-def.css']);
    expect(list).toContain('/');
    expect(list).toContain('/assets/main-abc.js');
    expect(list).toContain('/assets/main-def.css');
  });

  it('stores every navigation under the one key /', () => {
    for (const path of ['/', '/join/ABCD', '/join/WXYZ?x=1']) {
      expect(cacheKeyFor({ ...get(path), mode: 'navigate' }), path).toBe('/');
    }
    expect(cacheKeyFor({ ...get('/assets/a.js'), mode: 'no-cors' })).toBe(`${ORIGIN}/assets/a.js`);
  });

  it('deletes the previous build on activate and keeps the current one', () => {
    const precache = precacheList(['/assets/main-new.js']);
    const cached = [
      `${ORIGIN}/`,
      `${ORIGIN}/manifest.webmanifest`,
      `${ORIGIN}/assets/main-old.js`,
      `${ORIGIN}/assets/main-new.js`,
      `${ORIGIN}/join/ABCD`,
    ];
    expect(staleCacheKeys(cached, precache, ORIGIN)).toEqual([
      `${ORIGIN}/assets/main-old.js`,
      `${ORIGIN}/join/ABCD`,
    ]);
  });
});

describe('what may be cached', () => {
  const HTML = 'text/html; charset=utf-8';

  it('refuses the SPA fallback HTML for any non-shell file', () => {
    for (const path of ['/assets/missing-abc.js', '/assets/main-x.css', '/icons/nope.png', '/manifest.webmanifest']) {
      expect(isCacheable(path, HTML, false), path).toBe(false);
      expect(isCacheable(path, ' Text/HTML', false), path).toBe(false);
    }
    expect(isCacheable('/assets/main-x.js', 'text/javascript', false)).toBe(true);
    expect(isCacheable('/assets/main-x.css', 'text/css', false)).toBe(true);
    expect(isCacheable('/icons/icon-192.png', 'image/png', false)).toBe(true);
  });

  it('caches the shell only as HTML', () => {
    expect(isCacheable('/', HTML, false)).toBe(true);
    expect(isCacheable('/', 'application/json', false)).toBe(false);
    expect(isCacheable('/join/ABCD', HTML, true)).toBe(true);
    expect(isCacheable('/join/ABCD', null, true)).toBe(false);
  });

  it('never lets a non-HTML navigation replace the offline shell', () => {
    const nav = (path: string) => ({ ...get(path), mode: 'navigate' });
    expect(cachePutKey(nav('/join/ABCD'), HTML)).toBe('/');
    expect(cachePutKey(nav('/manifest.webmanifest'), 'application/manifest+json')).toBeNull();
    expect(cachePutKey(nav('/sw.js'), 'text/javascript')).toBeNull();
    expect(cachePutKey(nav('/icons/icon-192.png'), 'image/png')).toBeNull();
  });

  it('stores files under their own URL, and SPA-fallback HTML not at all', () => {
    expect(cachePutKey(get('/assets/main-x.js'), 'text/javascript')).toBe(`${ORIGIN}/assets/main-x.js`);
    expect(cachePutKey(get('/assets/missing-abc.js'), HTML)).toBeNull();
  });
});
