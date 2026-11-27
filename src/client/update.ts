/**
 * The "new version — reload" action (decision 0007 item 8): fetch the new
 * service worker, then reload. The shell is network-first (sw-policy.ts),
 * so the reload gets the new page even before the worker swaps. The player
 * token stays in localStorage, so the reload reconnects as the same player.
 */
export async function updateAndReload(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    // A failed update check still reloads; the network-first shell is new.
  }
  location.reload();
}
