/**
 * Host settings (stage 4.6): difficulty (§6, default Mixed per 0023),
 * cycles 1–3 (default 2, 0018), the game length `cycles × players` (0020),
 * and a timer preset or Custom within the 0022 bounds (§8). Everyone else
 * sees the same values read-only, live.
 */

import { useEffect, useState } from 'react';
import type { PublicState } from '../../shared/core/views';
import type { SettingsPatch } from '../../shared/protocol';
import { RadioChoices } from '../components/RadioChoices';
import { Button, Panel } from '../components/ui';
import { gameLengthText } from '../lobby/lobby-model';
import {
  CYCLE_OPTIONS,
  DIFFICULTY_OPTIONS,
  TIMER_FIELDS,
  TIMER_OPTIONS,
  boundsText,
  customDraft,
  parseCustomDraft,
  timerChoicePatch,
  timersSummary,
  type TimerKey,
} from '../lobby/settings-model';

function Choices<T extends string | number>({
  label,
  options,
  value,
  onPick,
  testId,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onPick: (v: T) => void;
  testId: string;
}) {
  return (
    <div className="field">
      <span aria-hidden="true">{label}</span>
      <RadioChoices label={label} options={options} value={value} onPick={onPick} testId={testId} />
    </div>
  );
}

export function SettingsPanel({ state, isHost, send }: { state: PublicState; isHost: boolean; send: (p: SettingsPatch) => void }) {
  const { settings } = state;
  const difficultyLabel = DIFFICULTY_OPTIONS.find((o) => o.value === settings.difficulty)?.label ?? settings.difficulty;
  const timersLabel = TIMER_OPTIONS.find((o) => o.value === settings.timers)?.label ?? settings.timers;

  if (!isHost) {
    return (
      <Panel title="Mission settings" testId="settings">
        <dl className="summary">
          <dt>Words</dt>
          <dd data-testid="settings-difficulty">{difficultyLabel}</dd>
          <dt>Length</dt>
          <dd data-testid="game-length">{gameLengthText(state)}</dd>
          <dt>Timers</dt>
          <dd data-testid="settings-timers">
            {timersLabel}: {timersSummary(settings)}
          </dd>
        </dl>
      </Panel>
    );
  }

  return (
    <Panel title="Mission settings" testId="settings">
      <Choices
        label="Words"
        testId="pick-difficulty"
        options={DIFFICULTY_OPTIONS}
        value={settings.difficulty}
        onPick={(difficulty) => send({ difficulty })}
      />
      <Choices
        label="Cycles (rounds per agent)"
        testId="pick-cycles"
        options={CYCLE_OPTIONS.map((c) => ({ value: c, label: String(c) }))}
        value={settings.cycles}
        onPick={(cycles) => send({ cycles })}
      />
      <p className="muted" data-testid="game-length">
        Game length: {gameLengthText(state)}
      </p>
      <Choices
        label="Timers"
        testId="pick-timers"
        options={TIMER_OPTIONS}
        value={settings.timers}
        onPick={(choice) => send(timerChoicePatch(choice, settings))}
      />
      {settings.timers === 'custom' ? <CustomTimers state={state} send={send} /> : (
        <p className="muted" data-testid="settings-timers">{timersSummary(settings)}</p>
      )}
    </Panel>
  );
}

function CustomTimers({ state, send }: { state: PublicState; send: (p: SettingsPatch) => void }) {
  const stored = customDraft(state.settings);
  const storedKey = JSON.stringify(stored);
  const [draft, setDraft] = useState(stored);
  // Follow the room when its stored Custom set changes (e.g. after Save).
  useEffect(() => setDraft(JSON.parse(storedKey) as typeof stored), [storedKey]);
  const parsed = parseCustomDraft(draft);
  const dirty = JSON.stringify(draft) !== storedKey;

  return (
    <div className="stack" data-testid="custom-timers">
      <div className="timer-grid">
        {TIMER_FIELDS.map(({ key, label }) => (
          <label className="field" key={key}>
            {label} <span className="muted">({boundsText(key)})</span>
            <input
              className={`input${!parsed.ok && parsed.fields.has(key) ? ' input-invalid' : ''}`}
              inputMode="decimal"
              name={key}
              value={draft[key]}
              aria-invalid={!parsed.ok && parsed.fields.has(key)}
              onChange={(e) => setDraft({ ...draft, [key as TimerKey]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <Button
        variant="secondary"
        disabled={!parsed.ok || !dirty}
        onClick={() => {
          if (parsed.ok) send({ custom: parsed.timers });
        }}
      >
        Save timers
      </Button>
    </div>
  );
}
