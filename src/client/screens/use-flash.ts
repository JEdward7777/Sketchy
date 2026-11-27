import { useEffect, useRef, useState } from 'react';
import type { GameError } from '../net/connection';
import { flashRemaining, seenAtMount } from './flash';

export { FLASH_MS } from './flash';

/**
 * The latest error until `FLASH_MS` after it arrived, then null (rules in
 * flash.ts). A repeat of the same code shows again (`GameError.n`).
 */
export function useFlash(error: GameError | null): GameError | null {
  const seen = useRef(seenAtMount(error, Date.now()));
  const [shown, setShown] = useState<GameError | null>(null);
  const n = error?.n ?? 0;
  useEffect(() => {
    if (!error || n <= seen.current) {
      if (!error) setShown(null);
      return;
    }
    seen.current = n;
    const left = flashRemaining(error, Date.now());
    if (left <= 0) return;
    setShown(error);
    const t = window.setTimeout(() => setShown(null), left);
    return () => window.clearTimeout(t);
    // Keyed on the counter only: a new error object always has a new n.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  return shown;
}
