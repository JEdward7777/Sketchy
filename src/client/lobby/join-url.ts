/**
 * The join link the QR code carries (`SPEC.md` §2, §13): built from the
 * page's own origin, so a custom domain later needs no code change.
 */

export function joinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/join/${code.toUpperCase()}`;
}

/** The big-screen display view of a room (stage 12.4, `SPEC.md` §3): read-only, for a TV or laptop. */
export function displayUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/display/${code.toUpperCase()}`;
}

/**
 * Whether phones on the Wi-Fi cannot reach this origin: a QR code for
 * `localhost` or `127.0.0.1` points every phone at itself
 * (reference/sibling-projects.md, confess_n_guess's loopback warning).
 */
export function isLoopbackOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '[::1]' || host === '::1' || host === '0.0.0.0') return true;
  return /^127(\.\d{1,3}){3}$/.test(host);
}

/** The room code in a `/join/<code>` path, upper-cased; null for any other path. */
export function codeFromPath(pathname: string): string | null {
  const m = /^\/join\/([A-Za-z]{1,16})\/?$/.exec(pathname);
  return m ? m[1]!.toUpperCase() : null;
}

/** The room code in a `/display/<code>` path, upper-cased; null for any other path. */
export function displayCodeFromPath(pathname: string): string | null {
  const m = /^\/display\/([A-Za-z]{1,16})\/?$/.exec(pathname);
  return m ? m[1]!.toUpperCase() : null;
}
