/**
 * Worker entry. `wrangler.jsonc` sends `/ws/*` and `/api/*` here before the
 * static-asset layer (`run_worker_first`); everything else is the PWA shell.
 */
export { RoomDO } from './room-do';
export { DeckDO } from './deck-do';

/**
 * A room code in the URL. Deliberately loose: the real alphabet (4 letters,
 * no confusables, `SPEC.md` §14) is validated where room codes are built. This
 * only stops arbitrary strings from naming a Durable Object.
 */
const WS_PATH = /^\/ws\/([A-Za-z0-9]{1,16})$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function handleApi(request: Request, url: URL): Promise<Response> {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true, service: 'sketchy' });
  }
  // The whole /api namespace is claimed: an unknown endpoint is an honest 404,
  // never the HTML shell.
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws' || url.pathname.startsWith('/ws/')) {
      const match = WS_PATH.exec(url.pathname);
      if (!match) return json({ error: 'not_found' }, 404);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return json({ error: 'upgrade_required' }, 426);
      }
      // Codes are letters, read off a phone or typed by hand: /ws/abcd and
      // /ws/ABCD must reach the same room, so the DO name is upper-cased.
      return env.ROOM.getByName(match[1]!.toUpperCase()).fetch(request);
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, url);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
