/**
 * Join form (stage 4.10.2, `SPEC.md` §2): name, a color nobody else has
 * (taken ones disabled, removed players' included, 0019), and a spy icon.
 * Above it, "Rejoin as…" (§7, stage 4.5) lists the disconnected players;
 * during a round that only asks the host (decision 0024).
 */

import { useState, type FormEvent } from 'react';
import { NAME_MAX_LENGTH, PLAYER_COLORS, SPY_ICONS } from '../../shared/core/rules';
import type { PublicState } from '../../shared/core/views';
import { PlayerChip } from '../components/PlayerChip';
import { SpyIcon, spyIconLabel } from '../components/SpyIcon';
import { RadioChoices } from '../components/RadioChoices';
import { Button, Notice, Panel } from '../components/ui';
import { rejoinCandidates, takenColors } from '../lobby/lobby-model';
import { errorText } from '../messages';
import type { RoomConnection, RoomSnapshot } from '../net/connection';
import { playerColorLabel, playerColorVar } from '../theme/player-colors';
import { useFlash } from './use-flash';

export function JoinForm({ state, snap, conn }: { state: PublicState; snap: RoomSnapshot; conn: RoomConnection }) {
  const taken = takenColors(state);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [icon, setIcon] = useState<string>(SPY_ICONS[0]);
  const error = useFlash(snap.error);
  const busy = snap.identifying !== null;

  // A color someone took while this form was open is no longer a choice.
  const color = picked !== null && !taken.has(picked) ? picked : (PLAYER_COLORS.find((c) => !taken.has(c)) ?? null);
  const candidates = rejoinCandidates(state);
  const inRound = !['lobby', 'scrubbed', 'results', 'final'].includes(state.phase.name);
  const notice = snap.rejoinNotice;
  const noticeName = notice ? state.players.find((p) => p.id === notice.playerId)?.name ?? 'that agent' : '';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!color || name.trim() === '') return;
    conn.send({ type: 'join', name: name.trim(), color, icon });
  }

  if (notice?.status === 'pending') {
    return (
      <Panel title="Waiting for clearance" testId="rejoin-pending">
        <p className="muted">You asked to rejoin as {noticeName}. The host has to OK it mid-round.</p>
        <Button variant="ghost" wide onClick={() => conn.cancelRejoinAs()}>
          Never mind
        </Button>
      </Panel>
    );
  }

  return (
    <div className="stack">
      {state.phase.name !== 'lobby' ? (
        <Notice>A mission is under way. New agents join at the start of the next round.</Notice>
      ) : null}
      {notice?.status === 'declined' ? <Notice tone="warn">The host turned down your request to rejoin as {noticeName}.</Notice> : null}
      {notice?.status === 'cancelled' ? <Notice tone="warn">{noticeName} came back on their own device.</Notice> : null}
      {error ? <Notice tone="error" testId="join-error">{errorText(error.code)}</Notice> : null}

      {candidates.length > 0 ? (
        <Panel title="Rejoin as…" testId="rejoin-as">
          <p className="muted">
            {inRound ? 'Lost your phone? Pick your agent and the host will let you back in.' : 'Lost your phone? Pick your agent to carry on with the same score.'}
          </p>
          <ul className="player-list">
            {candidates.map((p) => (
              <li key={p.id}>
                <PlayerChip player={p} isHost={p.id === state.hostId}>
                  <Button
                    variant="secondary"
                    className="btn-small"
                    disabled={busy}
                    onClick={() => conn.send({ type: 'rejoinAs', playerId: p.id })}
                  >
                    That's me
                  </Button>
                </PlayerChip>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="New agent" testId="join-form">
        <form className="stack" onSubmit={submit}>
          <label className="field">
            Code name
            <input
              className="input"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="nickname"
              placeholder="Agent…"
              required
            />
          </label>

          <div className="field">
            <span aria-hidden="true">Color</span>
            <RadioChoices
              label="Color"
              className="choices"
              value={color}
              onPick={setPicked}
              options={PLAYER_COLORS.map((c) => ({
                value: c,
                label: `${playerColorLabel(c)}${taken.has(c) ? ' (taken)' : ''}`,
                disabled: taken.has(c),
                className: 'choice-color',
                style: { background: playerColorVar(c) },
                content: c === color ? <SpyIcon icon={icon} size={22} /> : null,
                data: { 'data-color': c },
              }))}
            />
          </div>

          <div className="field">
            <span aria-hidden="true">Spy icon</span>
            <RadioChoices
              label="Spy icon"
              className="choices"
              value={icon}
              onPick={setIcon}
              options={SPY_ICONS.map((i) => ({
                value: i,
                label: spyIconLabel(i),
                content: <SpyIcon icon={i} size={26} />,
                data: { 'data-icon': i },
              }))}
            />
          </div>

          <Button type="submit" wide disabled={busy || !color || name.trim() === '' || snap.status !== 'open'}>
            {snap.identifying === 'join' ? 'Checking credentials…' : 'Join the mission'}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
