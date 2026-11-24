# 0021 — The ratchet runs until it is blocked on the owner; email before stopping

- **Date:** 2026-11-23
- **Status:** accepted
- **Stage:** 0.6

## Decision
Settles the remaining `pipeline/ratchet.md` operator inputs (the second-model
choice is 0008).

1. **Stop point: none.** The ratchet runs phase after phase and stops only when
   nothing else can be done without the owner. Later changes are expected and
   cheap; do not pause for check-ins.
2. **Owner stages do not stop the run.** Stages titled "Owner's:" that are
   real-phone checks (1.9's phone part, 4.11, 8.8, 12.1.5, 12.5, 13.2) are left
   `todo`, collected in `STATE.md`, and the run carries on with the next phase.
   They are never simulated.
3. **Deploy authority: granted** for `wrangler deploy` to this project's
   `*.workers.dev` Worker, once the owner has signed Wrangler in to Cloudflare.
   Signing in is the owner's.
4. **Email before stopping.** When the run is about to be blocked on the owner
   — a Cloudflare sign-in, a permission prompt on something important, a rule
   question only Joshua can answer — email the owner's own address through the
   Gmail connector, saying what is needed and what the run will do meanwhile.
   Keep working on anything not blocked.
5. **Pacing.** A local tool (`niceclaude`) may pause the session to stay under
   usage limits; `niceclaude status` shows why. A pause is not a failure.

## Why
The owner's ruling (2026-11-23): "don't stop unless you can't do anything else
without me", "send me an email whenever you are going to get stopped soon
because of needing something like signing in with Cloudflare or perhaps your
permission manager starts blocking you on something important", and the run is
expected to last several days.

## Rejected
- Stop after phase 3 for a review (the recommendation).
- Deploys owner-only throughout: the owner listed Cloudflare sign-in as the
  expected blocker, so the run deploys once signed in.

## Revisit if
The owner wants checkpoints or withdraws deploy authority.
