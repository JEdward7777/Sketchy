/**
 * Drawing delivery (stage 6.5, decisions 0006, 0009, 0030): outside `state`,
 * once per socket per round, never before the slideshow starts.
 *
 * Which drawings are public is the core's rule (`publicDrawings`); this
 * module only tracks, in each socket's attachment, the round it has already
 * been sent, and frames the stored strokes. One `drawing` frame per card,
 * so a frame is at most one stored drawing plus its envelope, which the
 * intake limit keeps under `STROKES_MAX_BYTES` + a few dozen bytes, and the
 * room never builds more than one at a time.
 *
 * The rows are read only when some live socket still needs them, so the
 * events of a slideshow (every `vote:set`) read nothing once everyone has
 * them; then one row at a time.
 */

import { publicDrawings, type RoomState } from '../shared/core';
import type { RoomStore } from './room-store';
import { attachmentOf, isLive, sendRaw, setAttachment } from './sockets';

/**
 * A `drawing` frame around strokes already stored as JSON text by the room
 * (validated and re-encoded at intake), spliced in without parsing them
 * again. `playerId` is a room-made id (`p1`, `p2`, …), so `JSON.stringify`
 * of the envelope fields is exact.
 */
export function drawingFrame(roundNo: number, playerId: string, strokesJson: string): string {
  return `{"type":"drawing","roundNo":${JSON.stringify(roundNo)},"playerId":${JSON.stringify(playerId)},"strokes":${strokesJson}}`;
}

/**
 * Send this round's public drawings to every live, helloed socket that has
 * not had them yet, after the `state` that opened the slideshow (callers
 * deliver state first). A socket bound or not gets them: from the slideshow
 * on they are as public as `state`.
 *
 * Card by card: read one row, frame it, send it to every socket that needs
 * it, and let it go before the next, so the room holds one drawing at a
 * time (phase 6 review: memory, not storage, binds first, decision 0031).
 * The sockets are marked once every card has gone out.
 */
export function deliverDrawings(sockets: readonly WebSocket[], state: RoomState, store: RoomStore): void {
  const pub = publicDrawings(state);
  if (!pub) return;
  const needing: WebSocket[] = [];
  for (const ws of sockets) {
    const a = attachmentOf(ws);
    if (a && a.helloed && isLive(ws) && a.drawingsRound !== pub.roundNo) needing.push(ws);
  }
  if (needing.length === 0) return;
  for (const d of pub.drawings) {
    const strokes = store.drawingText(d.key);
    // A reference without its row cannot happen (they commit in one
    // transaction); a missing row shows as a dark card, not an error.
    if (strokes === null) continue;
    const frame = drawingFrame(pub.roundNo, d.playerId, strokes);
    for (const ws of needing) sendRaw(ws, frame);
  }
  for (const ws of needing) setAttachment(ws, { ...attachmentOf(ws)!, drawingsRound: pub.roundNo });
}
