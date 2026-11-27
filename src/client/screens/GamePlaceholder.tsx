/**
 * Stand-in for every screen after the draw until its phase builds it
 * (phases 9–11): the public phase name, round and progress, and the host's
 * Continue / End so a game can be clicked through. Shows nothing from the
 * private view (stage 8.3.3): only the held envelope ever shows the word
 * or role.
 */

import type { PublicState } from '../../shared/core/views';
import { Button, Notice, Panel } from '../components/ui';
import { screenPhase } from '../lobby/lobby-model';
import { errorText } from '../messages';
import type { RoomConnection, RoomSnapshot } from '../net/connection';
import { ClaimHost, PlayerList, RejoinRequests } from './RoomParts';
import { useFlash } from './use-flash';

/** Phases where `host:next` continues (protocol.md `host:next`). */
const CONTINUABLE = new Set(['briefing', 'results', 'final']);

export function GamePlaceholder({ state, you, snap, conn }: { state: PublicState; you: string; snap: RoomSnapshot; conn: RoomConnection }) {
  const isHost = state.hostId === you;
  const phase = state.phase.name;
  const error = useFlash(snap.error);
  return (
    <div className="stack" data-testid="game">
      {error ? <Notice tone="error">{errorText(error.code)}</Notice> : null}
      <ClaimHost state={state} you={you} conn={conn} />
      <RejoinRequests state={state} you={you} conn={conn} />
      <Panel title="Game in progress">
        <p data-testid="game-phase" data-phase={phase}>
          Phase: <strong>{phase}</strong>. The {phase} screen is coming in phase {screenPhase(phase)}.
        </p>
        {state.round ? <p className="muted">Round {state.round.no}{state.progress ? ` · ${state.progress.completed} of ${state.progress.total} complete` : ''}</p> : null}
        {state.paused ? <Notice tone="warn">Paused: fewer than 3 agents online.</Notice> : null}
        {isHost ? (
          <div className="row">
            {CONTINUABLE.has(phase) ? (
              <Button onClick={() => conn.send({ type: 'host:next', seq: state.seq })} data-testid="host-next">
                {phase === 'final' ? 'Play again' : 'Continue'}
              </Button>
            ) : null}
            {phase !== 'final' ? (
              <Button variant="danger" onClick={() => conn.send({ type: 'host:end' })} data-testid="host-end">
                End game
              </Button>
            ) : null}
          </div>
        ) : null}
      </Panel>
      <PlayerList state={state} you={you} conn={conn} />
    </div>
  );
}
