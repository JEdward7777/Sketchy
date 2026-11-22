# Sketchy — notes for Claude Code

Read `SPEC.md` first. It is the locked game design. Don't change game rules without asking Joshua.

## Before writing any code

1. **Study the sibling projects** in the parent folder (other party games Joshua has built). Match their conventions:
   - language/framework, build tooling, folder layout and package manager
   - how they do **QR-code join** and room codes
   - how they do the **narrator / host TTS screen**
   - Cloudflare setup (`wrangler` config style, Durable Object patterns, deploy scripts)
   - styling approach, testing approach, README style
2. Summarize what you found and propose a project layout before scaffolding.
3. If a sibling project conflicts with `SPEC.md` §13–14 (architecture), point out the conflict and ask.

## Implementation order (suggested)

1. Scaffold: Worker with static assets + `RoomDO` + `DeckDO`, PWA manifest/icons/service worker, deploy to `workers.dev`.
2. Lobby: create room, QR/room code, join with name + color + spy icon, token-based reconnect, "Rejoin as…".
3. `DeckDO` global shuffled deck reading `data/words.json`.
4. Round state machine in `RoomDO` with alarm-driven deadlines and the briefing hold-to-reveal (secret sent privately).
5. Drawing canvas + image submit.
6. Synced slideshow (two passes) + live public voting + lock-in + free browse.
7. Unmask, faker guess, auto-match + group judging, scoring (`SPEC.md` §5), results screens.
8. Cycles/fairness, disconnect handling, host remove, late joiners.
9. Narrator TTS, ⓘ rules sheet, spy theme polish, optional big-screen display view.

## Must-not-break rules

- The secret word and faker identity never reach the wrong client before unmask, including in the shared state, logs and dev tools.
- The server is authoritative for timers and scoring.
- Stay within the Cloudflare free tier: WebSocket Hibernation API, no per-slide messages, small images.
- Write scoring as pure functions with unit tests covering the edge cases in `SPEC.md` §5.

## Data

`data/words.json` has 400 words: 200 concrete, 120 medium and 80 abstract, each with a category and some with `alt` accepted answers. Words are unique across the whole file. Expand it freely, keeping it family-friendly.
