/**
 * Routes: `/` is the landing, `/join/<code>` a room (and the QR link).
 * A code that cannot be a room code goes back to the landing with a note.
 */

import { useCallback, useState } from 'react';
import { parseRoomCode } from '../shared/room-code';
import { codeFromPath } from './lobby/join-url';
import { navigate, usePath } from './router';
import { Landing } from './screens/Landing';
import { RoomScreen } from './screens/RoomScreen';

export function App() {
  const path = usePath();
  const [notice, setNotice] = useState<string | null>(null);
  const leave = useCallback((text: string | null) => {
    setNotice(text);
    navigate('/', { replace: true });
  }, []);

  const raw = codeFromPath(path);
  if (raw !== null) {
    const code = parseRoomCode(raw);
    if (code) return <RoomScreen key={code} code={code} onLeave={leave} />;
    return <Landing notice={`"${raw}" isn't a room code. Codes are four letters.`} />;
  }
  return <Landing notice={notice} />;
}
