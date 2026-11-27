/**
 * Pieces the lobby and the game screens share: the player list with
 * the host's Remove (§7), the 0010 claim-host control, and the host's
 * admit/decline for mid-round "Rejoin as…" requests (0024).
 */

import { QRCodeSVG } from 'qrcode.react';
import type { PublicState } from '../../shared/core/views';
import { PlayerChip } from '../components/PlayerChip';
import { Button, Notice, Panel } from '../components/ui';
import { isLoopbackOrigin, joinUrl } from '../lobby/join-url';
import { canClaimHost, canRemove } from '../lobby/lobby-model';
import type { RoomConnection } from '../net/connection';

/** Every agent with presence; `scores` adds each score (greyed with a removed agent's chip, 0019 item 1). */
export function PlayerList({ state, you, conn, scores = false }: { state: PublicState; you: string; conn: RoomConnection; scores?: boolean }) {
  const isHost = state.hostId === you;
  const here = state.players.filter((p) => !p.removed).length;
  return (
    <Panel title={`Agents (${here})`} testId="player-list">
      <ul className="player-list">
        {state.players.map((p) => (
          <li key={p.id}>
            <PlayerChip player={p} isHost={p.id === state.hostId} isYou={p.id === you}>
              {scores ? (
                <span className="chip-score" data-testid="chip-score">
                  {p.score} {p.score === 1 ? 'pt' : 'pts'}
                </span>
              ) : null}
              {isHost && canRemove(p) ? (
                <Button variant="danger" className="btn-small" onClick={() => conn.send({ type: 'host:remove', playerId: p.id })} aria-label={`Remove ${p.name}`}>
                  Remove
                </Button>
              ) : null}
            </PlayerChip>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ClaimHost({ state, you, conn }: { state: PublicState; you: string; conn: RoomConnection }) {
  if (!canClaimHost(state, you)) return null;
  const host = state.players.find((p) => p.id === state.hostId);
  return (
    <Panel title="The host went dark" testId="claim-host">
      <p className="muted">{host ? `${host.name} lost contact.` : 'Nobody is running this mission.'} Someone has to take charge.</p>
      <Button variant="secondary" wide onClick={() => conn.send({ type: 'host:claim' })}>
        Take over as host
      </Button>
    </Panel>
  );
}

export function RejoinRequests({ state, you, conn }: { state: PublicState; you: string; conn: RoomConnection }) {
  if (state.hostId !== you || state.rejoinRequests.length === 0) return null;
  return (
    <Panel title="Agents asking to come back" testId="rejoin-requests">
      <p className="muted">A new device wants to take over one of these agents. Only say yes if it really is them.</p>
      <ul className="player-list">
        {state.rejoinRequests.map((id) => {
          const p = state.players.find((q) => q.id === id);
          if (!p) return null;
          return (
            <li key={id}>
              <PlayerChip player={p}>
                <Button className="btn-small" variant="secondary" onClick={() => conn.send({ type: 'host:admit', playerId: id, approve: true })}>
                  Let in
                </Button>
                <Button className="btn-small" variant="ghost" onClick={() => conn.send({ type: 'host:admit', playerId: id, approve: false })}>
                  Decline
                </Button>
              </PlayerChip>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function InvitePanel({ code }: { code: string }) {
  const url = joinUrl(location.origin, code);
  return (
    <Panel title="Recruit agents" testId="invite">
      <div className="qr" data-testid="qr">
        <QRCodeSVG value={url} size={176} marginSize={0} title={`Join room ${code}`} />
      </div>
      <p className="room-code" data-testid="room-code">{code}</p>
      <p className="join-link" data-testid="join-link">{url}</p>
      {isLoopbackOrigin(location.origin) ? (
        <Notice tone="warn" testId="loopback-warning">
          This page is open on {new URL(location.origin).hostname}, which only this computer can reach. Phones scanning
          this code will not find the room. Open the game by this computer's network address (or the deployed site)
          instead.
        </Notice>
      ) : null}
    </Panel>
  );
}
