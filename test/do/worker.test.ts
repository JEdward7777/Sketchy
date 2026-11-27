import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { CLOSE_NO_ROOM } from '../../src/shared/protocol';
import { ORIGIN, freshCode, newRoom, roomStub } from './helpers';

const get = (path: string, init?: RequestInit) => exports.default.fetch(`${ORIGIN}${path}`, init);

describe('Worker routing (stage 1.3)', () => {
  it('answers the health check', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'sketchy' });
  });

  it('claims the whole /api namespace: unknown paths are JSON 404s, never the shell', async () => {
    for (const path of ['/api', '/api/', '/api/nope', '/api/room/ABCD/x']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-type'), path).toContain('application/json');
      expect(await res.json(), path).toEqual({ error: 'not_found' });
    }
  });

  it('routes /ws/:code to a room and requires an upgrade', async () => {
    const code = await newRoom();
    expect((await get(`/ws/${code}`)).status).toBe(426);
    const ok = await get(`/ws/${code}`, { headers: { Upgrade: 'websocket' } });
    expect(ok.status).toBe(101);
    ok.webSocket?.accept();
    ok.webSocket?.close(1000, 'done');
  });

  it('tells an upgrade to a room nobody created no_room and closes 4004, writing nothing', async () => {
    const code = freshCode();
    const res = await get(`/ws/${code}`, { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const frames: string[] = [];
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    ws.addEventListener('message', (e) => frames.push(String(e.data)));
    ws.accept();
    expect(await closed).toBe(CLOSE_NO_ROOM);
    expect(frames.map((f) => JSON.parse(f))).toEqual([{ type: 'error', code: 'no_room', message: 'no such room' }]);
    // The exact signal costs no storage: no tables, no rows, no alarm.
    const left = await runInDurableObject(roomStub(code), async (_room, state) => ({
      tables: [...state.storage.sql.exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\_cf%' ESCAPE '\\'`)].map((r) => r.name),
      alarm: await state.storage.getAlarm(),
    }));
    expect(left).toEqual({ tables: [], alarm: null });
    // And the code is still free to create.
    expect(await runInDurableObject(roomStub(code), (room) => room.create(code))).toBe(true);
  });

  it('rejects /ws paths that do not name one room', async () => {
    for (const path of ['/ws', '/ws/', '/ws/AB-CD', '/ws/ABCD/extra', `/ws/${'A'.repeat(17)}`]) {
      const res = await get(path, { headers: { Upgrade: 'websocket' } });
      expect(res.status, path).toBe(404);
    }
  });

  it('hands every other path to the static assets', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('fixture shell');
  });
});

describe('DeckDO shell (stage 1.4)', () => {
  it('is SQLite-backed', async () => {
    const stub = env.DECK.getByName('global');
    const one = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql.exec<{ one: number }>('SELECT 1 AS one').one().one,
    );
    expect(one).toBe(1);
  });
});
