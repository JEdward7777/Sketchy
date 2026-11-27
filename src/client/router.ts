/**
 * Two routes: `/` (landing) and `/join/<code>` (a room, also the QR link).
 * The Worker's asset layer serves the shell for any app path, so deep links
 * work on first load (test/e2e/smoke.spec.ts "navigations").
 */

import { useEffect, useState } from 'react';

const EVENT = 'sketchy:navigate';

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new Event(EVENT));
}

export function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const sync = () => setPath(location.pathname);
    window.addEventListener('popstate', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return path;
}
