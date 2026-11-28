/**
 * The big-screen display (stage 12.4, `SPEC.md` §3): `/display/<code>` on
 * a TV or laptop shows the room large — lobby roster and QR, phase titles
 * and countdowns, the synced slideshow and the drawings, live votes,
 * unmask, results and the podium. Optional: nothing depends on it, and
 * every phone sees everything it shows.
 *
 * It connects as a display socket (protocol.md "Display sockets"): the
 * room never sends it `private`, and the connection refuses to send any
 * intent from it, so the view is read-only by construction. Screens are
 * fed `you = ''`, an id no player has, so shared components render the
 * spectator's view (no vote buttons, no "you" tags). Laid out for 16:9
 * landscape read from across the room (display.css).
 */

import { useEffect } from 'react';
import { Fingerprint } from '../../components/SpyArt';
import { Button, Notice } from '../../components/ui';
import { displayDeadline, displayHeadline, roundLine } from '../../game/display-model';
import type { RoomSnapshot } from '../../net/connection';
import { useRoom } from '../../net/room-hook';
import { updateAndReload } from '../../update';
import { CategoryBadge, Countdown } from '../game/RoundParts';
import { DisplayPhase } from './DisplayPhases';

function DisplayBar({ snap }: { snap: RoomSnapshot }) {
  const state = snap.state!;
  const head = displayHeadline(state);
  const deadline = displayDeadline(state.phase);
  const line = roundLine(state);
  const category = state.phase.name !== 'lobby' && state.phase.name !== 'final' ? (state.round?.category ?? null) : null;
  return (
    <header className="display-bar">
      <div className="display-brand">
        <Fingerprint className="display-brand-print" />
        <span className="display-wordmark">Sketchy</span>
      </div>
      <div className="display-head">
        <span className="display-kicker stamp-ink" data-testid="display-kicker">{head.kicker}</span>
        <h1 className="display-title" data-testid="display-title">{head.title}</h1>
        {line ? <span className="display-round muted" data-testid="display-round">{line}</span> : null}
      </div>
      <div className="display-meta">
        {category ? <CategoryBadge category={category} /> : null}
        {deadline ? <Countdown deadline={deadline.at} paused={state.paused} clock={snap.clock} label={deadline.label} testId="display-countdown" /> : null}
        <span className="display-code" data-testid="display-code">
          <span className="display-code-label">Room</span> {state.code}
        </span>
      </div>
    </header>
  );
}

export function DisplayScreen({ code }: { code: string }) {
  const { snap } = useRoom(code, true);
  // The display fills a landscape screen: wider column, type scaled to the viewport (display.css).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('display-mode');
    return () => root.classList.remove('display-mode');
  }, []);

  let body;
  if (snap.status === 'no_room') {
    body = (
      <div className="display-center" data-testid="display-no-room">
        <h1 className="display-title">No room {code}</h1>
        <p className="muted">It may have expired. Start a new mission on a phone, then open its big-screen link here.</p>
      </div>
    );
  } else if (snap.status === 'version') {
    body = (
      <div className="display-center" data-testid="version-prompt">
        <h1 className="display-title">New version of HQ</h1>
        <Button onClick={() => void updateAndReload()}>Reload</Button>
      </div>
    );
  } else if (!snap.state) {
    body = (
      <div className="display-center">
        <Notice testId="connecting">Contacting HQ…</Notice>
      </div>
    );
  } else {
    body = (
      <>
        <DisplayBar snap={snap} />
        <DisplayPhase state={snap.state} snap={snap} />
        {snap.state.paused && snap.state.phase.name !== 'lobby' ? (
          <div className="display-paused" data-testid="display-paused" role="status">
            <div className="display-paused-card panel">
              <span className="pause-stamp">On hold</span>
              <h2 className="display-title">Mission paused</h2>
              <p className="display-lead">Fewer than 3 agents are online. The clock is frozen until enough agents reconnect.</p>
            </div>
          </div>
        ) : null}
      </>
    );
  }
  const reconnecting = snap.state !== null && (snap.status === 'connecting' || snap.status === 'waiting');
  return (
    <main className="display" data-testid="display" data-phase={snap.state?.phase.name ?? ''}>
      {reconnecting ? (
        <div className="display-banner">
          <Notice tone="warn" testId="reconnecting">Lost contact with HQ. Reconnecting…</Notice>
        </div>
      ) : null}
      {body}
    </main>
  );
}
