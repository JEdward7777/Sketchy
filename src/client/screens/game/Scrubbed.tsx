/**
 * "Mission scrubbed" (stage 11.4, `SPEC.md` §7): the beat after a round is
 * cancelled, either because the faker went dark in the briefing or the draw,
 * or by a 0023/0025 restart with new agents. The wording is generic on
 * purpose (decision 0012 item 3): it names nobody and does not say why, so
 * it never points at the faker, though the cancel itself is revealing.
 * No points, and the round does not count toward the game (0020 item 3);
 * the next round starts on its own at `scrubbed.endsAt`.
 */

import { Notice } from '../../components/ui';
import { errorText } from '../../messages';
import { useFlash } from '../use-flash';
import { FairnessNotices } from './Fairness';
import type { ScreenProps } from './ResultsParts';
import { Countdown } from './RoundParts';

export function Scrubbed(props: ScreenProps) {
  const { state, snap } = props;
  const phase = state.phase;
  const error = useFlash(snap.error);
  if (phase.name !== 'scrubbed') return null;
  const progress = state.progress;
  return (
    <div className="stack round-screen" data-testid="scrubbed" data-phase="scrubbed">
      <div className="evidence-notices">
        {error ? <Notice tone="error" testId="round-error">{errorText(error.code)}</Notice> : null}
        <FairnessNotices {...props} />
      </div>
      <section className="scrubbed-card" aria-labelledby="scrubbed-title">
        <span className="scrubbed-stamp" aria-hidden="true">Scrubbed</span>
        <h2 id="scrubbed-title" className="round-title">
          Mission scrubbed
        </h2>
        <p className="scrubbed-text" data-testid="scrubbed-text">
          HQ called this one off. No points change hands, and it won't count toward the game.
        </p>
        <p className="muted">Shred your notes, agents. Fresh envelopes are on the way.</p>
      </section>
      <div className="row center-row" data-testid="scrubbed-next">
        <span className="muted">Next briefing in</span>
        <Countdown deadline={phase.endsAt} paused={state.paused} clock={snap.clock} label="Next briefing in" testId="scrubbed-countdown" />
      </div>
      {progress ? (
        <p className="muted center" data-testid="scrubbed-progress">
          {progress.completed} of {progress.total} {progress.total === 1 ? 'round' : 'rounds'} complete
        </p>
      ) : null}
    </div>
  );
}
