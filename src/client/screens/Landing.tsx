/**
 * Landing (stage 4.10.1): create a room, or type a code (case-insensitive,
 * `parseRoomCode`).
 */

import { useState, type FormEvent } from 'react';
import { ROOM_CODE_LENGTH, parseRoomCode } from '../../shared/room-code';
import { Button, Notice, Panel, Screen } from '../components/ui';
import { navigate } from '../router';

export function Landing({ notice }: { notice?: string | null }) {
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function create() {
    setCreating(true);
    setProblem(null);
    try {
      const res = await fetch('/api/room', { method: 'POST' });
      const body = (await res.json()) as { code?: string };
      if (res.status !== 201 || typeof body.code !== 'string') throw new Error(`create failed: ${res.status}`);
      navigate(`/join/${body.code}`);
    } catch {
      setProblem("Couldn't reach HQ to open a room. Check the Wi-Fi and try again.");
      setCreating(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const parsed = parseRoomCode(code);
    if (!parsed) {
      setProblem(`Room codes are ${ROOM_CODE_LENGTH} letters, like the one on the host's screen.`);
      return;
    }
    navigate(`/join/${parsed}`);
  }

  return (
    <Screen testId="landing">
      <div className="stack" style={{ marginTop: 'var(--space-6)' }}>
        <h1 className="wordmark">Sketchy</h1>
        <p className="tagline">Everyone draws the secret word. One agent is faking it.</p>
      </div>
      {notice ? <Notice tone="warn" testId="landing-notice">{notice}</Notice> : null}
      <Panel title="Host a mission">
        <p className="muted">Open a room, then have everyone scan the code.</p>
        <Button wide onClick={create} disabled={creating}>
          {creating ? 'Opening a room…' : 'Create a room'}
        </Button>
      </Panel>
      <Panel title="Got a room code?">
        <form className="stack" onSubmit={join}>
          <label className="field">
            Room code
            <input
              className="input input-code"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z]/g, '').slice(0, ROOM_CODE_LENGTH))}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              maxLength={ROOM_CODE_LENGTH}
              placeholder="ABCD"
            />
          </label>
          <Button type="submit" variant="secondary" wide disabled={code.length !== ROOM_CODE_LENGTH}>
            Join room
          </Button>
        </form>
      </Panel>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
    </Screen>
  );
}
