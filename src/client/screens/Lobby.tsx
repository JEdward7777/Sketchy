/**
 * Lobby (stage 4.10.3): the invite (QR and code from `location.origin`,
 * §2, §13), the player list, the host's settings and Start (≥ 3 active,
 * 0011 item 1), and the 0010 / 0024 host controls.
 */

import { MIN_PLAYERS } from '../../shared/core/rules';
import type { PublicState } from '../../shared/core/views';
import { Button, Notice, Panel } from '../components/ui';
import { activePlayers, canStart } from '../lobby/lobby-model';
import { errorText } from '../messages';
import type { RoomConnection, RoomSnapshot } from '../net/connection';
import { ClaimHost, InvitePanel, PlayerList, RejoinRequests } from './RoomParts';
import { SettingsPanel } from './SettingsPanel';
import { useFlash } from './use-flash';

export function Lobby({ state, you, snap, conn }: { state: PublicState; you: string; snap: RoomSnapshot; conn: RoomConnection }) {
  const isHost = state.hostId === you;
  const host = state.players.find((p) => p.id === state.hostId);
  const active = activePlayers(state).length;
  const error = useFlash(snap.error);

  return (
    <div className="stack" data-testid="lobby">
      {error ? <Notice tone="error" testId="lobby-error">{errorText(error.code)}</Notice> : null}
      <ClaimHost state={state} you={you} conn={conn} />
      <RejoinRequests state={state} you={you} conn={conn} />
      <InvitePanel code={state.code} />
      <PlayerList state={state} you={you} conn={conn} />
      <SettingsPanel state={state} isHost={isHost} send={(settings) => conn.send({ type: 'host:settings', settings })} />
      {isHost ? (
        <Panel>
          <Button wide disabled={!canStart(state)} onClick={() => conn.send({ type: 'host:start' })} data-testid="start">
            Start the mission
          </Button>
          {active < MIN_PLAYERS ? (
            <p className="muted" data-testid="start-hint">
              Need {MIN_PLAYERS} agents online to start ({active} here).
            </p>
          ) : null}
        </Panel>
      ) : (
        <Notice testId="waiting-for-host">
          {host ? `Waiting for ${host.name} to start the mission.` : 'Waiting for a host.'}
        </Notice>
      )}
    </div>
  );
}
