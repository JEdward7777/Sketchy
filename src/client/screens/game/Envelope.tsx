/**
 * The classified envelope (stages 8.3, 8.3.1, `SPEC.md` §4 and §12): the
 * signature interaction. Press and hold and the flap opens and the letter
 * slides up; let go and it drops back in.
 *
 * Secrecy (8.3.3): the letter's text (word, or "You are the faker!") is
 * rendered only while held, and the closed envelope is the same markup for
 * every player, faker or not. The envelope is exempt from the host's hold
 * taps (decision 0017).
 *
 * `size="mini"` is the one kept on the draw and waiting screens (8.3.2):
 * a small envelope tab; while held its letter opens over the screen.
 */

import { useEffect, useReducer, type KeyboardEvent, type PointerEvent } from 'react';
import type { PrivateRound } from '../../../shared/core/views';
import { CLOSED, envelopeLetter, envelopeReducer, isOpen } from '../../game/envelope-model';
import { Fingerprint, WaxSeal } from '../../components/SpyArt';

function LetterBody({ round }: { round: PrivateRound }) {
  const l = envelopeLetter(round);
  return (
    <span className="letter-body" data-testid="envelope-letter">
      <span className="letter-category">
        <span className="letter-label">Category</span> {l.category}
      </span>
      <span className="letter-kicker">{l.kicker}</span>
      <span className="letter-line" data-testid="envelope-line">{l.line}</span>
      <span className="letter-hint">{l.hint}</span>
    </span>
  );
}

export function Envelope({ round, size = 'full' }: { round: PrivateRound; size?: 'full' | 'mini' }) {
  const [state, dispatch] = useReducer(envelopeReducer, CLOSED);
  const open = isOpen(state);

  // A hold never outlives its pointer, the page losing focus, or the page being hidden (8.3.1).
  useEffect(() => {
    const cancel = () => dispatch({ type: 'cancel' });
    const hidden = () => {
      if (document.visibilityState !== 'visible') cancel();
    };
    // A release anywhere ends the hold, captured or not.
    const released = (e: globalThis.PointerEvent) => dispatch({ type: 'release', pointerId: e.pointerId });
    window.addEventListener('pointerup', released);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pointerup', released);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pagehide', cancel);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);

  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // No focus ring flash, no text selection, no drag start.
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture failed (rare): the window-level pointerup/pointercancel listeners below still end the hold
      // when the finger or mouse is released outside the envelope.
    }
    dispatch({ type: 'press', pointerId: e.pointerId });
  };
  const up = (e: PointerEvent<HTMLButtonElement>) => dispatch({ type: 'release', pointerId: e.pointerId });
  const cancel = () => dispatch({ type: 'cancel' });
  const keyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) dispatch({ type: 'keyDown' });
  };
  const keyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') dispatch({ type: 'keyUp' });
  };

  return (
    <button
      type="button"
      className={`envelope envelope-${size}`}
      data-open={open}
      data-hold-exempt=""
      data-testid={size === 'mini' ? 'envelope-mini' : 'envelope'}
      aria-label="Classified envelope. Press and hold to read your briefing; let go to hide it."
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={cancel}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={keyDown}
      onKeyUp={keyUp}
      onBlur={cancel}
    >
      <span className="envelope-back" aria-hidden="true" />
      <span className="envelope-letter" aria-live="polite">
        {open ? <LetterBody round={round} /> : null}
      </span>
      <span className="envelope-front" aria-hidden="true">
        <span className="envelope-postage">
          <Fingerprint />
        </span>
        <span className="envelope-stamp">Classified</span>
        <span className="envelope-hint">{size === 'mini' ? 'Hold' : 'Press & hold'}</span>
      </span>
      <span className="envelope-flap" aria-hidden="true" />
      {/* Same for every player: decoration of the closed envelope (8.3.3). */}
      <span className="envelope-seal" aria-hidden="true">
        <WaxSeal />
      </span>
    </button>
  );
}
