/**
 * Picks the round screen for the public phase. Phase 8 builds dealing,
 * briefing and draw, phase 9 the slideshow and free browse, phase 10
 * unmask through the final podium; only `scrubbed` is still
 * `GamePlaceholder` until phase 11 builds it.
 */

import type { PublicState } from '../../../shared/core/views';
import type { RoomConnection, RoomSnapshot } from '../../net/connection';
import { GamePlaceholder } from '../GamePlaceholder';
import { Briefing, Dealing } from './Briefing';
import { DrawPhase } from './DrawPhase';
import { Evidence } from './Evidence';
import { FinalResults, RoundResults } from './Results';
import { GuessPhase, Judging, Unmask } from './Unmask';

export function GameScreen(props: { state: PublicState; you: string; snap: RoomSnapshot; conn: RoomConnection }) {
  const { state } = props;
  switch (state.phase.name) {
    case 'dealing':
      return <Dealing />;
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
    default:
      return <GamePlaceholder {...props} />;
  }
}
