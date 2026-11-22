# 0005 — Public GitHub repo, MIT license, work on `main`

- **Date:** 2026-11-22
- **Status:** accepted
- **Stage:** 0.5

## Decision
- Git repository at the project root, branch `main`, no feature branches.
- Public GitHub repository `JEdward7777/Sketchy`, pushed after each ratchet phase.
- MIT license (`LICENSE`, "Copyright (c) 2026 Joshua L."), covering code and
  `data/words.json`.

## Why
Owner chose public and asked for a license recommendation; MIT matches
Satellite-Chess, niceclaude and most of the owner's projects (2026-11-22).
Working on `main` matches Satellite-Chess's experience that a review branch
for a one-person repo is ceremony.

## Rejected
- Private repo: owner preferred public.
- AGPL-3.0 / separate CC BY for content: more friction than a family party game needs.

## Revisit if
Third-party art or fonts with different licenses are added — record their
terms in a `NOTICE` file.
