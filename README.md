# Sketchy 🕵️✏️

A spy-themed party drawing game for 3–10 players on their own phones.
Everyone draws the secret word, except the faker, who has to bluff. Then everyone votes on who faked it.

- `SPEC.md`: the full game design and technical spec
- `CLAUDE.md`: implementation notes and order for Claude Code
- `data/words.json`: the built-in word list (concrete / medium / abstract, with categories)

Target: an installable PWA on Cloudflare Workers + Durable Objects (free tier), hosted on `workers.dev`.

Status: design locked, implementation not started. Project memory and process: `harness/` (start with `harness/AGENTS.md`).
