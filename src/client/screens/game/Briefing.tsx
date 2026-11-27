/**
 * Dealing and briefing (stages 8.3, 8.9, `SPEC.md` §4 phase 1): the
 * category in the open, the classified envelope, and the host's 0004
 * continue. Everyone else sees when drawing starts.
 *
 * Every seated player's screen is the same markup whatever their role;
 * only the held envelope differs (8.3, 8.3.3).
 */

import type { PublicState } from '../../../shared/core/views';
import { Notice } from '../../components/ui';
import { errorText } from '../../messages';
import type { RoomConnection, RoomSnapshot } from '../../net/connection';
import { ClaimHost, RejoinRequests } from '../RoomParts';
import { useFlash } from '../use-flash';
import { useHostHold } from '../../game/use-now';
import { AutoContinueButton } from './AutoContinue';
import { Envelope } from './Envelope';
import { CategoryBadge, Countdown, OnDeck } from './RoundParts';

export function Dealing() {
  return (
    <div className="stack round-screen" data-testid="dealing">
      <h2 className="round-title">Incoming transmission</h2>
      <Notice>HQ is sealing this round's envelopes…</Notice>
    </div>
  );
}

export function Briefing({ state, you, snap, conn }: { state: PublicState; you: string; snap: RoomSnapshot; conn: RoomConnection }) {
  const phase = state.phase;
  const isHost = state.hostId === you;
  const me = state.players.find((p) => p.id === you);
  const seated = state.round?.roster.includes(you) ?? false;
  // The private view belongs to this round only (its `no`); anything else is stale.
  const round = snap.round && snap.round.no === state.round?.no ? snap.round : null;
  const error = useFlash(snap.error);
  useHostHold(isHost && phase.name === 'briefing' && !state.paused, () => conn.send({ type: 'host:hold' }));
  if (phase.name !== 'briefing') return null;

  return (
    <div className="stack round-screen" data-testid="briefing">
      {error ? <Notice tone="error">{errorText(error.code)}</Notice> : null}
      <ClaimHost state={state} you={you} conn={conn} />
      <RejoinRequests state={state} you={you} conn={conn} />
      <div className="round-head">
        <h2 className="round-title">{me ? `Agent ${me.name}, your briefing is classified` : 'Your briefing is classified'}</h2>
        <CategoryBadge category={state.round?.category ?? null} />
      </div>
      {seated && round ? (
        <>
          <div className="envelope-stage">
            <Envelope round={round} />
          </div>
          <p className="muted center">Press and hold the envelope to read it. Let go and it seals itself.</p>
        </>
      ) : seated ? (
        <Notice>Your envelope is on its way…</Notice>
      ) : (
        <OnDeck />
      )}
      {state.paused ? <Notice tone="warn" testId="paused">Paused: fewer than 3 agents online.</Notice> : null}
      <div data-testid="briefing-footer">
      {isHost ? (
        <AutoContinueButton
          phase={phase}
          seq={state.seq}
          paused={state.paused}
          clock={snap.clock}
          label="Start drawing"
          onContinue={(seq) => conn.send({ type: 'host:next', seq })}
        />
      ) : (
        <div className="row center-row">
          <span className="muted">Pens up in</span>
          <Countdown deadline={phase.continueAt} paused={state.paused} clock={snap.clock} label="Drawing starts in" testId="briefing-countdown" />
        </div>
      )}
      </div>
    </div>
  );
}
