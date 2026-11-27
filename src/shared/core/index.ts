/**
 * The game core (phase 3, decision 0006 item 1): the pure reducer, its two
 * projections and the deadline the alarm is armed for. `RoomDO` (phase 4)
 * imports from here.
 */

export { reduce } from './reduce';
export { createRoom, type RoomState, type PlayerId, type ConnId } from './state';
export { projectPrivate, projectPublic, publicDrawings, type PublicDrawing } from './project';
export { nextDeadline } from './next-deadline';
export type { Effect, Input, Step } from './io';
export type { PrivateView, PublicState } from './views';
