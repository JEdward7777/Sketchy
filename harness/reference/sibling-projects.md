# Sibling projects (surveyed 2026-11-22)

All in `../../` relative to the repo root.

| | confess_n_guess | Storython2 | Satellite-Chess |
|---|---|---|---|
| Client | React 18 + Vite, separate client package | React 19 + Vite, `src/{client,shared,worker}` | Vanilla TS + esbuild, `public/` |
| DOs | `GameDurableObject`, hibernation, alarms | `RoomDO`, hibernation, alarms | `GameDO` etc., one alarm multiplexed over a timers table |
| QR join | `qrcode.react`; join URL from own origin; warns when the URL is loopback | — | own QR encoder |
| TTS | `confess_n_guess_client/src/announcer.ts` phrase banks, no-repeat shuffle; `AnnouncerToggle.tsx` | — | — |
| Tests | node scripts driving a live game | vitest + pool-workers | vitest + pool-workers |
| Harness | ISSUES/TASKS/PROGRESS | SPEC/ARCHITECTURE/TASKS/PROGRESS | AGENTS/STATE/plan/decisions/sessions (adopted here) |

Borrow: Storython2's `src/{client,shared,worker}` layout and wrangler/vitest
setup; confess_n_guess's QR lobby and announcer; Satellite-Chess's harness,
one-alarm multiplexer and "no timing state in memory" discipline.

Platform facts confirmed across them: free plan needs `new_sqlite_classes`;
`observability.enabled` for Workers Logs.
