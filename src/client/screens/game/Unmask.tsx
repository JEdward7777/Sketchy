/**
 * Unmask, the faker's guess and judging (stages 10.1–10.3, `SPEC.md` §4
 * phases 5–6, decision 0013).
 *
 * - Unmask: the votes first (who accused whom), then the faker's stamp
 *   lands a beat later (CSS delay; at once with reduced motion).
 * - Guess: only the faker gets the field, with the category in view;
 *   everyone else waits on the faker. Everyone can flip back through the
 *   drawings (§1: the faker guesses from them), the field kept above them.
 * - Judging: roster non-fakers get one final Accept / Reject tap; the
 *   faker and agents on deck watch the count. Ties go to the faker.
 *
 * Secrecy (0026 item 5): the word is not on these screens. A judge who
 * needs a reminder holds their own envelope (the private view, held only),
 * exactly as during the draw.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Notice } from '../../components/ui';
import { GUESS_MAX_LENGTH, canJudge, guessErrorText, judgeCount } from '../../game/results-model';
import { DrawingBrowser } from './DrawingBrowser';
import { Envelope } from './Envelope';
import { FakerStamp, RoundNotices, VoteBoard, type ScreenProps } from './ResultsParts';
import { CategoryBadge, Countdown } from './RoundParts';

const nameOf = (state: ScreenProps['state'], id: string | null) => state.players.find((p) => p.id === id)?.name ?? 'The faker';

export function Unmask(props: ScreenProps) {
  const { state, you, snap } = props;
  const phase = state.phase;
  const round = state.round;
  if (phase.name !== 'unmask' || !round) return null;
  return (
    <div className="stack round-screen" data-testid="unmask" data-phase="unmask">
      <RoundNotices {...props} />
      <div className="draw-top evidence-top">
        <CategoryBadge category={round.category} />
        <Countdown deadline={phase.endsAt} paused={state.paused} clock={snap.clock} label="The faker's guess opens in" urgentMs={2_000} testId="unmask-countdown" />
      </div>
      <h2 className="round-title">The votes are in</h2>
      <div className="results-layout">
        <VoteBoard round={round} players={state.players} you={you} />
        <FakerStamp round={round} players={state.players} you={you} animate />
      </div>
    </div>
  );
}

export function GuessPhase(props: ScreenProps) {
  const { state, you, snap, conn } = props;
  const phase = state.phase;
  const round = state.round;
  if (phase.name !== 'guess' || !round) return null;
  const isFaker = round.faker === you;
  return (
    <div className="stack round-screen review-screen" data-testid="guess" data-phase="guess" data-role-view={isFaker ? 'guesser' : 'waiting'}>
      <RoundNotices {...props} text={guessErrorText} />
      <div className="draw-top evidence-top">
        <CategoryBadge category={round.category} />
        <Countdown deadline={phase.endsAt} paused={state.paused} clock={snap.clock} label="Guess time left" testId="guess-countdown" />
      </div>
      <div className="results-layout review-layout">
        {isFaker ? (
          <GuessForm errorN={snap.error?.n ?? 0} opens={snap.opens} onSubmit={(text) => conn.send({ type: 'guess:submit', text })} />
        ) : (
          <div className="stack center" data-testid="guess-waiting">
            <h2 className="round-title">{nameOf(state, round.faker)} is cracking the code…</h2>
            <p className="muted">The faker gets one shot at the secret word. Exact match wins outright; anything else goes to the jury.</p>
          </div>
        )}
        <DrawingBrowser round={round} players={state.players} you={you} drawings={snap.drawings} title={isFaker ? 'Study the evidence' : 'The evidence'} />
      </div>
      <FakerStamp round={round} players={state.players} you={you} />
    </div>
  );
}

/** The faker's one guess. A refusal (empty after normalization) re-opens the field. */
function GuessForm({ errorN, opens, onSubmit }: { errorN: number; opens: number; onSubmit: (text: string) => boolean }) {
  const [text, setText] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [sentOn, setSentOn] = useState(opens);
  const input = useRef<HTMLInputElement>(null);
  // An error that arrives after the send answers it: let the faker try again.
  useEffect(() => {
    if (sentAt !== null && errorN > sentAt) setSentAt(null);
  }, [errorN, sentAt]);
  // A guess sent on a socket that has since dropped may never have arrived: offer the button again.
  if (sentAt !== null && opens !== sentOn) {
    setSentAt(null);
    setSentOn(opens);
  }
  useEffect(() => input.current?.focus(), []);
  const sent = sentAt !== null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (sent || !text.trim()) return;
    if (onSubmit(text)) {
      setSentAt(errorN);
      setSentOn(opens);
    }
  };
  return (
    <form className="guess-form stack" onSubmit={submit} data-testid="guess-form">
      <h2 className="round-title">Your cover's blown. Name the word!</h2>
      <p className="muted center guess-blurb">Flip through the drawings, trust your gut. Exact match scores at once; anything else, the jury decides.</p>
      <label className="field">
        <span className="field-label">Your guess at the secret word</span>
        <input
          ref={input}
          className="input guess-input"
          data-testid="guess-input"
          value={text}
          maxLength={GUESS_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          disabled={sent}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <Button type="submit" wide disabled={sent || !text.trim()} data-testid="guess-submit">
        {sent ? 'Guess filed…' : 'Submit guess'}
      </Button>
    </form>
  );
}

export function Judging(props: ScreenProps) {
  const { state, you, snap, conn } = props;
  const phase = state.phase;
  const round = state.round;
  // What this device tapped: the room says who judged, never how (protocol.md), so the choice is remembered here.
  // `opens` is the socket it went out on: a tap lost with a dropped socket can be made again on the next one.
  const [mine, setMine] = useState<{ accept: boolean; opens: number } | null>(null);
  // A second tap in the same frame, before React re-renders with the buttons disabled, must not send again.
  const sending = useRef(false);
  if (phase.name !== 'judging' || !round) return null;
  const isFaker = round.faker === you;
  const judge = canJudge(round, you);
  const pending = mine !== null && mine.opens === snap.opens;
  if (!pending) sending.current = false;
  const send = (accept: boolean) => {
    if (sending.current || pending) return;
    if (conn.send({ type: 'guess:judge', accept })) {
      sending.current = true;
      setMine({ accept, opens: snap.opens });
    }
  };
  const { judged, of } = judgeCount(round, (id) => state.players.find((p) => p.id === id)?.connected ?? false);
  const own = snap.round && snap.round.no === round.no && round.roster.includes(you) && !isFaker ? snap.round : null;
  const faker = nameOf(state, round.faker);
  return (
    <div className="stack round-screen review-screen" data-testid="judging" data-phase="judging" data-can-judge={judge}>
      <RoundNotices {...props} text={guessErrorText} hide={(code) => code === 'already_judged' && mine !== null} />
      <div className="draw-top evidence-top">
        <CategoryBadge category={round.category} />
        <Countdown deadline={phase.endsAt} paused={state.paused} clock={snap.clock} label="Judging closes in" testId="judging-countdown" />
      </div>
      <div className="results-layout review-layout">
        <div className="stack judge-col">
          <section className="guess-card" aria-label={`${faker}'s guess`}>
            <span className="guess-card-kicker">{isFaker ? 'Your guess' : `${faker} guessed`}</span>
            <q className="guess-card-text" data-testid="guess-text">{round.guess}</q>
          </section>
          {judge ? (
            <div className="stack" data-testid="judge-panel">
              <h2 className="round-title judge-title">Does it count?</h2>
              <p className="muted center judge-blurb">{pending ? 'Verdict sent…' : "Close enough to the secret word? One tap, and it's final."}</p>
              <div className="judge-buttons">
                <Button variant="secondary" disabled={pending} onClick={() => send(true)} data-testid="judge-accept">
                  It counts
                </Button>
                <Button disabled={pending} onClick={() => send(false)} data-testid="judge-reject">
                  No dice
                </Button>
              </div>
            </div>
          ) : round.judged.includes(you) ? (
            <Notice testId="judge-done">{mine === null ? 'Your verdict is in.' : `Your verdict is in: ${mine.accept ? 'accept' : 'reject'}.`} Waiting on the rest of the jury.</Notice>
          ) : isFaker ? (
            <Notice testId="judge-faker">The jury is out on your guess. Look innocent.</Notice>
          ) : (
            <Notice testId="judge-watch">You're on deck this round, so the jury does this one without you.</Notice>
          )}
          <p className="judge-count" data-testid="judge-count">
            {judged} of {of} {of === 1 ? 'agent has' : 'agents have'} judged · Majority rules; a tie goes to the faker.
          </p>
          {own ? (
            <div className="mini-envelope-row">
              <span className="muted">Need the word?</span>
              <Envelope round={own} size="mini" />
            </div>
          ) : null}
        </div>
        <DrawingBrowser round={round} players={state.players} you={you} drawings={snap.drawings} title="The evidence" />
      </div>
    </div>
  );
}
