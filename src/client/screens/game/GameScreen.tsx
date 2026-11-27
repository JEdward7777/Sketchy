/**
 * Picks the round screen for the public phase: phase 8 builds dealing,
 * briefing and draw, phase 9 the slideshow and free browse, phase 10
 * unmask through the final podium, phase 11 the scrubbed beat and the
 * pause screen over whichever screen froze (0011). While paused the screen
 * underneath is inert, so focus and taps stay on the pause screen.
 */

import type { PublicState } from '../../../shared/core/views';
import type { RoomConnection, RoomSnapshot } from '../../net/connection';
import { Briefing, Dealing } from './Briefing';
import { DrawPhase } from './DrawPhase';
import { Evidence } from './Evidence';
import { PauseScreen } from './Fairness';
import { FinalResults, RoundResults } from './Results';
import { Scrubbed } from './Scrubbed';
import { GuessPhase, Judging, Unmask } from './Unmask';

type Props = { state: PublicState; you: string; snap: RoomSnapshot; conn: RoomConnection };

function PhaseScreen(props: Props) {
  const { state } = props;
  switch (state.phase.name) {
    case 'dealing':
      return <Dealing {...props} />;
    case 'briefing':
      return <Briefing {...props} />;
    case 'draw':
      // Keyed by round, so a new round's canvas never starts with the last one's strokes.
      return <DrawPhase key={state.round?.no ?? 0} {...props} />;
    case 'slideshow':
    case 'browse':
      // Keyed by round: browse starts each round on the first exhibit.
      return <Evidence key={state.round?.no ?? 0} {...props} />;
    case 'unmask':
      return <Unmask {...props} />;
    case 'guess':
      return <GuessPhase key={state.round?.no ?? 0} {...props} />;
    case 'judging':
      // Keyed by round: a judge's remembered tap never carries into the next round.
      return <Judging key={state.round?.no ?? 0} {...props} />;
    case 'results':
      return <RoundResults key={state.round?.no ?? 0} {...props} />;
    case 'final':
      return <FinalResults {...props} />;
    case 'scrubbed':
      return <Scrubbed {...props} />;
    case 'lobby':
      return null;
  }
}

export function GameScreen(props: Props) {
  const paused = props.state.paused !== null;
  return (
    <>
      {/* `display: contents`, so the draw screen's one-viewport flex column is unchanged. */}
      <div className="game-frame" inert={paused} data-paused={paused}>
        <PhaseScreen {...props} />
      </div>
      <PauseScreen {...props} />
    </>
  );
}
