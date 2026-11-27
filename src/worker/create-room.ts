/** `POST /api/room` (stage 4.2). */

import { randomRoomCode } from './random';
import type { RoomDO } from './room-do';

/**
 * Codes tried by `POST /api/room` before giving up. Each try is one DO
 * request (budget.md). With `ROOM_CODE_ALPHABET.length ** ROOM_CODE_LENGTH`
 * codes and few live rooms, a collision is rare and eight in a row rarer.
 */
export const ROOM_CREATE_ATTEMPTS = 8;

/**
 * Pick a code and ask that room to initialise; an occupied room refuses and
 * another code is tried (stage 4.2, decision 0007 item 1: only the DO knows
 * whether its code is live). Null when every try collided.
 */
export async function createRoomCode(
  rooms: DurableObjectNamespace<RoomDO>,
  nextCode: () => string = randomRoomCode,
): Promise<string | null> {
  for (let i = 0; i < ROOM_CREATE_ATTEMPTS; i++) {
    const code = nextCode();
    if (await rooms.getByName(code).create(code)) return code;
  }
  return null;
}
