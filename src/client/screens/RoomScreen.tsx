/**
 * Everything under `/join/<code>`: owns the room connection and picks the
 * screen from it: the connection's end states (gone, replaced, new
 * version), the join form, the lobby, or the in-game placeholder.
 */

import { useEffect } from 'react';
import { Button, Notice, Panel, Screen } from '../components/ui';
import { useRoom } from '../net/room-hook';
import { updateAndReload } from '../update';
import { GamePlaceholder } from './GamePlaceholder';
import { JoinForm } from './JoinForm';
import { Lobby } from './Lobby';

function Header({ code }: { code: string }) {
  return (
    <header className="row" style={{ justifyContent: 'space-between' }}>
      <h1 className="screen-title" style={{ color: 'var(--accent-text)' }}>Sketchy</h1>
      <span className="tag" data-testid="header-code">Room {code}</span>
    </header>
  );
}

export function RoomScreen({ code, onLeave }: { code: string; onLeave: (notice: string | null) => void }) {
  const { conn, snap } = useRoom(code);

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
    body = <GamePlaceholder state={snap.state} you={snap.you.id} snap={snap} conn={conn} />;
  }

  const reconnecting = snap.state !== null && (snap.status === 'connecting' || snap.status === 'waiting');
  return (
    <Screen testId="room">
      <Header code={code} />
      {reconnecting ? (
        <div className="banner">
          <Notice tone="warn" testId="reconnecting">Lost contact with HQ. Reconnecting…</Notice>
        </div>
      ) : null}
      {body}
    </Screen>
  );
}
