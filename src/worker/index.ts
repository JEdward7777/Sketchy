/**
 * Worker entry. `wrangler.jsonc` sends `/ws/*` and `/api/*` here before the
 * static-asset layer (`run_worker_first`); everything else is the PWA shell.
 */
import { createRoomCode } from './create-room';

// The entry module may export only handlers and classes: workerd refuses to
// start on any other export, so helpers live in their own modules.
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

async function handleApi(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true, service: 'sketchy' });
  }
  if (url.pathname === '/api/room') {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    try {
      const code = await createRoomCode(env.ROOM);
      return code ? json({ code }, 201) : json({ error: 'no_free_code' }, 503);
    } catch (err) {
      // A failed DO call: say so as JSON, never the runtime's HTML error page.
      console.error('room create failed:', err instanceof Error ? err.name : 'unknown error');
      return json({ error: 'internal' }, 500);
    }
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
      return handleApi(request, url, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
