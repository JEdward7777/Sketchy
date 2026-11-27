/**
 * Picks the round screen for the public phase. Phase 8 builds dealing,
 * briefing and draw, phase 9 the slideshow and free browse; every later
 * phase is still `GamePlaceholder` until its phase builds it (10–11).
 */

import type { PublicState } from '../../../shared/core/views';
import type { RoomConnection, RoomSnapshot } from '../../net/connection';
import { GamePlaceholder } from '../GamePlaceholder';
import { Briefing, Dealing } from './Briefing';
import { DrawPhase } from './DrawPhase';
import { Evidence } from './Evidence';

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
    default:
      return <GamePlaceholder {...props} />;
  }
}
