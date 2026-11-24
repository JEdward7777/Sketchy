/**
 * Register the shell-caching service worker. Skipped under the Vite dev
 * server, where modules are served unbundled and caching them would fight HMR.
 */
export function registerServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.warn('service worker registration failed', err);
    });
  });
}
