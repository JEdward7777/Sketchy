/**
 * The round's drawings as they arrive (protocol.md "Drawings", decision
 * 0030): one `drawing {roundNo, playerId, strokes}` frame per card, from
 * the slideshow on. Phase 9's slideshow and browse read them from here.
 *
 * - Keyed by (roundNo, playerId). A repeat of the same key replaces the
 *   earlier one, never adds a second card (protocol.md: a delivery may
 *   repeat after a failed storage read).
 * - Only the newest round is kept: a frame for a later round starts a new
 *   buffer, a frame for an earlier one is ignored, so memory never grows
 *   with the game.
 * - Strokes are decoded with the shared `decodeStrokes`; a frame that does
 *   not decode (the room validated it, so this means a bug or a tampered
 *   frame) is ignored rather than drawn.
 */

import { decodeStrokes, type Stroke } from '../../shared/stroke-codec';

export interface DrawingBuffer {
  readonly roundNo: number;
  readonly byPlayer: Readonly<Record<string, readonly Stroke[]>>;
}

export interface DrawingFrame {
  readonly roundNo: unknown;
  readonly playerId: unknown;
  readonly strokes: unknown;
}

/** The buffer with `frame` added; the same object when the frame is ignored. */
export function bufferDrawing(buf: DrawingBuffer | null, frame: DrawingFrame): DrawingBuffer | null {
  const { roundNo, playerId } = frame;
  if (typeof roundNo !== 'number' || !Number.isInteger(roundNo) || typeof playerId !== 'string') return buf;
  if (buf && roundNo < buf.roundNo) return buf;
  const decoded = decodeStrokes(frame.strokes);
  if (!decoded.ok) return buf;
  const base = buf && buf.roundNo === roundNo ? buf.byPlayer : {};
  return { roundNo, byPlayer: { ...base, [playerId]: decoded.strokes } };
}
