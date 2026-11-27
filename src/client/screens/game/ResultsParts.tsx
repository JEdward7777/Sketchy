/**
 * Pieces of the round-end screens (phase 10): the notices every screen
 * carries, the unmask vote board and faker stamp, the running scoreboard,
 * and the host's tools. Everything here reads public state only; the word
 * appears nowhere in this file (it is shown from `round.result.word` by
 * Results.tsx alone, 0026 item 5).
 */

import type { CSSProperties, ReactNode } from 'react';
import type { PublicPlayer, PublicRound, PublicState } from '../../../shared/core/views';
import type { ErrorCode } from '../../../shared/protocol';
import { Notice, Panel } from '../../components/ui';
import { gainedText, ordinal, scoreRows, voteLines, votesOnFaker } from '../../game/results-model';
import { errorText } from '../../messages';
import type { RoomConnection, RoomSnapshot } from '../../net/connection';
import { playerColorVar } from '../../theme/player-colors';
import { FairnessNotices } from './Fairness';
import { useFlash } from '../use-flash';
import { Badge } from './EvidenceParts';

type Players = readonly PublicPlayer[];
export type ScreenProps = { state: PublicState; you: string; snap: RoomSnapshot; conn: RoomConnection };

const find = (players: Players, id: string | null) => (id === null ? undefined : players.find((p) => p.id === id));
const nameOf = (players: Players, id: string | null) => find(players, id)?.name ?? 'Unknown agent';

/** A refusal (in this screen's words where it has some), the host claim, rejoin requests and the pause. */
export function RoundNotices({ state, you, snap, conn, text, hide }: ScreenProps & { text?: (code: ErrorCode) => string | null; hide?: (code: ErrorCode) => boolean }) {
  const shown = useFlash(snap.error);
  // A refusal that only confirms what the screen already shows (a double tap) is not worth a notice.
  const flash = shown && hide?.(shown.code) ? null : shown;
  return (
    <div className="evidence-notices">
      {flash ? <Notice tone="error" testId="round-error">{text?.(flash.code) ?? errorText(flash.code)}</Notice> : null}
      <FairnessNotices state={state} you={you} conn={conn} />
    </div>
  );
}

/** A player's badge and name in one line. */
export function AgentTag({ players, id, you, compact = false, children }: { players: Players; id: string | null; you: string; compact?: boolean; children?: ReactNode }) {
  const p = find(players, id);
  // Compact (the vote board's narrow columns): "You" in place of the name, no tag beside it.
  if (compact && id === you) {
    return (
      <span className="agent-tag" data-player={id}>
        <Badge player={p} size={30} />
        <span className="agent-tag-name">You</span>
        <PresenceText player={p} />
        {children}
      </span>
    );
  }
  return (
    <span className="agent-tag" data-player={id ?? ''}>
      <Badge player={p} size={30} />
      <span className="agent-tag-name">{id === null ? 'Nobody' : nameOf(players, id)}</span>
      {id === you ? <span className="tag tag-you">you</span> : null}
      <PresenceText player={p} />
      {children}
    </span>
  );
}

/** The badge's presence dot in words, for screen readers (11.5). */
function PresenceText({ player }: { player: PublicPlayer | undefined }) {
  if (!player || (player.connected && !player.removed)) return null;
  return <span className="sr-only">{player.removed ? '(removed)' : '(went dark)'}</span>;
}

/** "Faker unmasked": the stamp with the faker's badge (§4 phase 5, §12). */
export function FakerStamp({ round, players, you, animate = false }: { round: PublicRound; players: Players; you: string; animate?: boolean }) {
  const faker = find(players, round.faker);
  const caught = votesOnFaker(round);
  const voters = round.roster.length - 1;
  return (
    <section
      className="faker-stamp"
      data-testid="faker-reveal"
      data-faker={round.faker ?? ''}
      data-animate={animate}
      style={{ '--artist': playerColorVar(faker?.color ?? '') } as CSSProperties}
      aria-live="polite"
    >
      <span className="faker-stamp-kicker">Unmasked</span>
      <span className="faker-stamp-who">
        <Badge player={faker} size={56} />
        <span className="faker-stamp-name">{round.faker === you ? 'You were the faker!' : `${nameOf(players, round.faker)} was the faker!`}</span>
      </span>
      <span className="faker-stamp-count" data-testid="faker-caught">
        {caught === 0 ? 'Nobody saw through the disguise.' : `${caught} of ${voters} ${voters === 1 ? 'agent' : 'agents'} called it.`}
      </span>
    </section>
  );
}

/** Who voted for whom (§4 phase 5), in roster order; a vote on the faker is marked. */
export function VoteBoard({ round, players, you }: { round: PublicRound; players: Players; you: string }) {
  return (
    <ul className="vote-board" data-testid="vote-board" aria-label="Who voted for whom">
      {voteLines(round).map((l) => (
        <li key={l.voter} className="vote-line" data-testid="vote-line" data-voter={l.voter} data-target={l.target ?? ''} data-caught={l.caught} data-faker={l.voterIsFaker}>
          <AgentTag players={players} id={l.voter} you={you} compact />
          <span className="vote-arrow" aria-hidden="true">→</span>
          <span className="sr-only">accused</span>
          {l.target === null ? <span className="vote-none">No vote</span> : <AgentTag players={players} id={l.target} you={you} compact />}
          {/* The faker never accuses themselves, so a line has the check or the faker tag, never both. */}
          {l.caught ? (
            <span className="vote-hit">
              <span aria-hidden="true">✔</span>
              <span className="sr-only">caught the faker</span>
            </span>
          ) : l.voterIsFaker ? <span className="tag tag-faker">faker</span> : <span />}
        </li>
      ))}
    </ul>
  );
}

/** The running scoreboard with this round's points (§4 phase 7, §5). */
export function Scoreboard({ state, you, points }: { state: PublicState; you: string; points: Readonly<Record<string, number>> | null }) {
  const rows = scoreRows(state.players, points);
  return (
    <Panel title="Scoreboard" testId="scoreboard">
      <ol className="score-list">
        {rows.map((r) => (
          <li key={r.id} className="score-row" data-testid="score-row" data-player={r.id} data-score={r.score} data-gained={r.gained ?? ''} data-removed={r.removed}>
            <span className="score-place" aria-label={r.removed ? 'removed' : `${ordinal(r.place)} place`}>{r.removed ? '–' : r.place}</span>
            <AgentTag players={state.players} id={r.id} you={you} />
            {r.gained !== null ? <span className="score-gained" data-zero={r.gained === 0}>{gainedText(r.gained)}</span> : null}
            <span className="score-total">{r.score}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
