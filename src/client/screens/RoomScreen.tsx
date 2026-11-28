/**
 * Everything under `/join/<code>`: owns the room connection and picks the
 * screen from it: the connection's end states (gone, replaced, new
 * version), the join form, the lobby, or the round screens (GameScreen).
 * The header carries the host's game controls (HostMenu) and, below it,
 * the "reconnecting…" banner for this device (11.5), and on every screen
 * the narrator toggle and the ⓘ rules (phase 12), with the narrator itself.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RoomTools } from '../components/RoomTools';
import { ToolsGlyph } from '../components/SpyArt';
import { HOLD_EXEMPT_ATTR } from '../game/hold-throttle';
import { Button, Notice, Panel, Screen } from '../components/ui';
import { useNarrator } from '../narrator/use-narrator';
import { useRoom } from '../net/room-hook';
import { updateAndReload } from '../update';
import { GameScreen } from './game/GameScreen';
import { HostMenu } from './HostMenu';
import { JoinForm } from './JoinForm';
import { Lobby } from './Lobby';

/**
 * The room header. Short landscape round screens (draw, evidence, guess,
 * judging) have no room for it, so there it folds into one floating
 * briefcase button that opens the same controls (polish.css; O-18, O-20):
 * the host menu, the narrator toggle, ⓘ and the code stay one tap away.
 * Elsewhere the button is hidden and the header is the usual row.
 */
function Header({ code, inert, isHost, children }: { code: string; inert: boolean; isHost: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    // A tap anywhere else, or Escape, folds it again.
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <header ref={ref} className="row room-header" style={{ justifyContent: 'space-between' }} inert={inert} data-expanded={open}>
      <h1 className="screen-title" style={{ color: 'var(--accent-text)' }}>Sketchy</h1>
      <button
        type="button"
        className="btn btn-secondary icon-btn tools-toggle"
        aria-expanded={open}
        aria-controls="room-header-tools"
        aria-label="Room tools"
        title="Room tools"
        onClick={() => setOpen((o) => !o)}
        data-testid="tools-toggle"
        {...{ [HOLD_EXEMPT_ATTR]: '' }}
      >
        <ToolsGlyph />
      </button>
      <span className="row room-header-end" id="room-header-tools">
        {children}
        <RoomTools isHost={isHost} />
        <span className="tag" data-testid="header-code">
          {/* Narrow phones drop the word "Room" so the controls stay on one row (polish.css). */}
          <span className="tag-room">Room </span>
          {code}
        </span>
      </span>
    </header>
  );
}

export function RoomScreen({ code, onLeave }: { code: string; onLeave: (notice: string | null) => void }) {
  const { conn, snap } = useRoom(code);
  useNarrator(snap.state, snap.you?.id ?? null, snap.clock, conn);

  useEffect(() => {
    if (snap.status === 'no_room') onLeave(`There's no room ${code}. It may have expired. Start a new one, or check the code.`);
  }, [snap.status, code, onLeave]);

  let body;
  if (snap.status === 'replaced') {
    body = (
      <Panel title="You're on another device" testId="replaced">
        <p className="muted">Your agent is now active in another tab or on another phone.</p>
        <Button wide onClick={() => conn.takeOver()}>Play here instead</Button>
      </Panel>
    );
  } else if (snap.status === 'version') {
    body = (
      <Panel title="New version of HQ" testId="version-prompt">
        <p className="muted">Sketchy was updated. Reload to get back in the game; you'll keep your agent.</p>
        <Button wide onClick={() => void updateAndReload()}>Reload</Button>
      </Panel>
    );
  } else if (!snap.state) {
    body = <Notice testId="connecting">Contacting HQ…</Notice>;
  } else if (!snap.you) {
    // Only the automatic token rejoin hides the form, including while the
    // socket is re-established to send it; a typed join keeps the form (and
    // its fields) on screen so a refusal can be corrected in place.
    body = snap.identifying === 'rejoin' || (snap.resuming && snap.status !== 'open') ? (
      <Notice testId="connecting">Checking your credentials…</Notice>
    ) : (
      <JoinForm state={snap.state} snap={snap} conn={conn} />
    );
  } else if (snap.state.phase.name === 'lobby') {
    body = <Lobby state={snap.state} you={snap.you.id} snap={snap} conn={conn} />;
  } else {
    body = <GameScreen state={snap.state} you={snap.you.id} snap={snap} conn={conn} />;
  }

  const reconnecting = snap.state !== null && (snap.status === 'connecting' || snap.status === 'waiting');
  // The host's game controls (phase 11); the lobby has its own player list and settings.
  const hostMenu =
    snap.state && snap.you && snap.state.hostId === snap.you.id && snap.state.phase.name !== 'lobby' ? (
      <HostMenu state={snap.state} you={snap.you.id} conn={conn} />
    ) : null;
  // While paused, the pause screen (GameScreen) is modal: the header and banner are inert with the round screen.
  const frozen = snap.state !== null && snap.you !== null && snap.state.paused !== null && snap.state.phase.name !== 'lobby';
  return (
    <Screen testId="room">
      <Header code={code} inert={frozen} isHost={snap.state !== null && snap.you !== null && snap.state.hostId === snap.you.id}>
        {hostMenu}
      </Header>
      {reconnecting ? (
        <div className="banner" inert={frozen}>
          <Notice tone="warn" testId="reconnecting">Lost contact with HQ. Reconnecting…</Notice>
        </div>
      ) : null}
      {body}
    </Screen>
  );
}
