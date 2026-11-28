/**
 * React side of the room connection: one `RoomConnection` per mounted room
 * screen, wired to the browser (WebSocket, localStorage, timers),
 * and woken when the phone comes back to the foreground or online.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { RoomConnection, type RoomSnapshot } from './connection';
import { browserStorage, tokenStore } from './token-store';

export function roomSocketUrl(origin: string, code: string): string {
  return `${origin.replace(/^http/, 'ws')}/ws/${encodeURIComponent(code)}`;
}

export function createBrowserConnection(code: string, display = false): RoomConnection {
  return new RoomConnection(code, {
    url: roomSocketUrl(location.origin, code),
    openSocket: (url) => new WebSocket(url),
    tokens: tokenStore(browserStorage()),
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => window.clearTimeout(h as number),
    display,
  });
}

/** `display`: a read-only big-screen socket (stage 12.4); fixed for the hook's life. */
export function useRoom(code: string, display = false): { conn: RoomConnection; snap: RoomSnapshot } {
  const [conn] = useState(() => createBrowserConnection(code, display));
  useEffect(() => {
    conn.start();
    const wake = () => {
      if (document.visibilityState === 'visible') conn.nudge();
    };
    const online = () => conn.nudge();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', online);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', online);
      conn.stop();
    };
  }, [conn]);
  const snap = useSyncExternalStore(conn.subscribe, conn.getSnapshot);
  return { conn, snap };
}
