# 0002 — Build the client with React + Vite

- **Date:** 2026-11-22
- **Status:** accepted
- **Stage:** 0.2

## Decision
The PWA client is React + Vite + TypeScript. QR codes via `qrcode.react`. Tests
via vitest, with `@cloudflare/vitest-pool-workers` for Durable Object tests.

## Why
Many distinct screens (lobby, briefing, canvas, slideshow, voting, unmask,
judging, results, rules sheet), which suits components. It matches
confess_n_guess and Storython2, so their QR-join and announcer patterns port
directly. Owner confirmed 2026-11-22.

## Rejected
- Vanilla TS + esbuild (Satellite-Chess): lighter, but much more hand-written UI
  for a screen-heavy party game.

## Revisit if
Bundle size measurably hurts cold load on phones on venue Wi-Fi.
