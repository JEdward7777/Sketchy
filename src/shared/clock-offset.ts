/**
 * Client clock offset from `ping`/`pong` samples (stage 2.5, `SPEC.md` §14).
 *
 * The client sends `ping {t}` with its own clock; the room answers
 * `pong {t, serverTime}` (src/shared/protocol.ts). When the pong arrives at
 * client time `received`, the round trip is `received − t`, and assuming the
 * two legs took equally long the server read its clock at client time
 * `(t + received) / 2`. So
 *
 *     offset = serverTime − (t + received) / 2
 *     server time ≈ client time + offset
 *
 * The error of one sample is at most half its round trip (when one leg took
 * all of it), so the sample with the lowest round trip bounds the error
 * tightest and is the one used.
 */

export interface ClockSample {
  /** Client clock when the ping was sent (echoed back as `pong.t`). */
  readonly sent: number;
  /** Client clock when the pong arrived. */
  readonly received: number;
  /** `pong.serverTime`. */
  readonly serverTime: number;
}

export interface ClockOffset {
  /** Add to the client clock to get server time. */
  readonly offset: number;
  /** Round trip of the sample used; the offset is within ± rtt / 2. */
  readonly rtt: number;
}

/**
 * The estimate from the lowest-round-trip sample, or null when no sample is
 * usable. Samples with non-finite fields or a negative round trip (a client
 * clock that jumped backwards) are skipped. On equal round trips the
 * earlier sample in the list wins.
 */
export function estimateClockOffset(samples: readonly ClockSample[]): ClockOffset | null {
  let best: ClockOffset | null = null;
  for (const s of samples) {
    if (![s.sent, s.received, s.serverTime].every(Number.isFinite)) continue;
    const rtt = s.received - s.sent;
    if (rtt < 0) continue;
    if (best === null || rtt < best.rtt) best = { offset: s.serverTime - (s.sent + s.received) / 2, rtt };
  }
  return best;
}

/** Server time now, given the client's clock and an offset estimate. */
export function serverNow(clientNow: number, offset: ClockOffset): number {
  return clientNow + offset.offset;
}
