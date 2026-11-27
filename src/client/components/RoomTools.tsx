/**
 * The narrator toggle and the ⓘ rules button, side by side in the room
 * header and on the pause screen (stages 12.1.2, 12.2). Both are local to
 * this device: neither sends anything, and both are `data-hold-exempt`, so
 * the host can use them on the briefing without holding the Continue fill.
 */

import { HOLD_EXEMPT_ATTR } from '../game/hold-throttle';
import { narratorSupported, setNarrator, useNarratorOn } from '../narrator/use-narrator';
import { RulesButton } from './RulesSheet';
import { Button } from './ui';

const exempt = { [HOLD_EXEMPT_ATTR]: '' };

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {on ? (
        <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function NarratorToggle({ isHost }: { isHost: boolean }) {
  const on = useNarratorOn(isHost);
  const supported = narratorSupported();
  return (
    <Button
      variant="ghost"
      className="btn-small icon-btn"
      aria-pressed={supported && on}
      aria-label="Narrator"
      title={supported ? (on ? 'Narrator on: tap to mute' : 'Narrator off: tap to hear it') : "This browser can't speak"}
      disabled={!supported}
      onClick={() => setNarrator(!on)}
      data-testid="narrator-toggle"
      data-on={supported && on}
      {...exempt}
    >
      <SpeakerIcon on={supported && on} />
    </Button>
  );
}

export function RoomTools({ isHost }: { isHost: boolean }) {
  return (
    <span className="row room-tools" data-testid="room-tools">
      <NarratorToggle isHost={isHost} />
      <RulesButton />
    </span>
  );
}
