/**
 * A player chip (stage 4.9.2, `SPEC.md` §2: name, color and icon appear on
 * labels, votes and the scoreboard): the icon on the player's color, the
 * name, and badges for host, "you", offline and removed.
 */

import type { ReactNode } from 'react';
import type { PublicPlayer } from '../../shared/core/views';
import { playerColorLabel, playerColorVar } from '../theme/player-colors';
import { SpyIcon, spyIconLabel } from './SpyIcon';

export function PlayerChip({
  player,
  isHost = false,
  isYou = false,
  children,
}: {
  player: Pick<PublicPlayer, 'id' | 'name' | 'color' | 'icon' | 'connected' | 'removed'>;
  isHost?: boolean;
  isYou?: boolean;
  /** Extra controls on the right (e.g. the host's Remove). */
  children?: ReactNode;
}) {
  const state = player.removed ? 'removed' : player.connected ? 'online' : 'offline';
  return (
    <div className={`chip chip-${state}`} data-testid="player-chip" data-player={player.id} data-state={state}>
      <span
        className="chip-badge"
        style={{ background: playerColorVar(player.color) }}
        title={`${playerColorLabel(player.color)}, ${spyIconLabel(player.icon)}`}
      >
        <SpyIcon icon={player.icon} size={22} />
      </span>
      <span className="chip-name">{player.name}</span>
      <span className="chip-tags">
        {isYou ? <span className="tag tag-you">you</span> : null}
        {isHost ? <span className="tag tag-host">host</span> : null}
        {state === 'offline' ? <span className="tag tag-offline">went dark</span> : null}
        {state === 'removed' ? <span className="tag tag-offline">removed</span> : null}
      </span>
      {children ? <span className="chip-actions">{children}</span> : null}
    </div>
  );
}
