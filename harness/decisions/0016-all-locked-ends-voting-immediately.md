# 0016 — When everyone has locked in, voting ends immediately, even mid-slideshow

- **Date:** 2026-11-23
- **Status:** accepted
- **Stage:** 0.8.7

## Decision
Clarifies `SPEC.md` §4's slideshow and free-browse end conditions.

1. Voting is select (`vote:set`) then lock (`vote:lock`), as §4 already has.
2. Once every connected roster player (after the 0012 blip grace) has locked,
   voting ends and the round moves straight to unmask — during the slideshow
   or free browse alike. The slideshow is cut short if still running.
3. Otherwise the slideshow ends after two passes and free browse runs until its
   timer or the last connected lock, as §4 says.

## Why
The owner's ruling (2026-11-23): "Once everyone has clicked lock it moves on to
the reveal right away even if you haven't gone through the pictures twice yet."
A group that has made up its mind should not wait.

## Rejected
- Play the slideshow out, then skip free browse.
- Run free browse's full timer anyway.

## Revisit if
Players lock too early and complain they missed drawings.
