# Sketchy — Game & Technical Specification

> A spy-themed party drawing game. Everyone draws the secret word — except the faker, who has to bluff.
> Concept by Joshua's daughter. Spec locked 2026-11-22.

---

## 1. Concept

Every player sees the same secret word and draws it on their own phone, all at the same time and without seeing anyone else's screen. One player, the **faker**, sees only the category and has to draw something believable anyway. Then everyone looks through all the drawings and votes on who the faker is. The faker scores by staying hidden, by framing someone else, and by guessing the real word from everyone's drawings.

Players aren't eliminated. Every round awards points, and every player is faker the same number of times.

## 2. Setting & players

- **3–10 players**, normally in the same room, each on their own phone.
- Talking happens out loud. There's no in-app chat. Remote play may come later, so nothing in the design should rule it out.
- Players join by **scanning a QR code** (or typing the room code).
- On joining, each player picks a **name**, a **color** (unique within the room) and a **spy icon** (fedora, sunglasses, magnifying glass, mustache, trench coat, briefcase, binoculars, fingerprint…).
- Name, color and icon appear on drawing labels, votes and the scoreboard.

## 3. Roles

- **Host**: the player who created the room. The host is a normal player who also controls settings, starts the game and can remove disconnected players. Narrator is **on** by default for the host.
- **Player**: everyone else. Narrator is **off** by default, and anyone can toggle it.
- **Faker**: one player per round, chosen by the cycle schedule (§7).
- **Big-screen display** (optional bonus): a TV or laptop can open a display view that shows the drawings, votes and scoreboard large. Nothing depends on it, and every phone can see everything it shows. It could also join as a player later if that's useful.

## 4. Round flow

| # | Phase | What happens | Ends when |
|---|-------|--------------|-----------|
| 1 | **Briefing** | Each phone shows a "classified envelope" panel. **Press and hold** to reveal the category + secret word, or for the faker, the category + "You are the faker!" It hides again on release. Every phone looks identical unless held. The panel stays available during drawing. | Short fixed countdown (~8 s) or host taps continue |
| 2 | **Draw** | Everyone draws at the same time on their own canvas, without seeing other screens. | Draw timer expires (anyone can tap "Done" early; the phase ends early if everyone is done) |
| 3 | **Reveal slideshow** | All phones show a synced slideshow: every drawing, labeled with its artist, shown in sequence, **two full passes**. **Voting is open** throughout. | Two passes complete |
| 4 | **Free browse** | Players can flip back and forth through all drawings freely while the vote countdown runs. | Vote timer expires **or** the last connected player locks in |
| 5 | **Unmask** | Votes are shown (who voted for whom). The faker is revealed. | Short fixed beat |
| 6 | **Faker's guess** | The faker types a guess at the word and submits it. Exact match (normalized) → accepted automatically. Otherwise everyone **except the faker** votes on whether it counts (accept/reject); a **tie goes to the faker**. | Guess resolved (guess timer ~30 s; no guess = wrong) |
| 7 | **Round results** | Points earned this round + running scoreboard. | Host taps "Next round" (or auto after a few seconds; pick one in implementation) |

After the final round there's a **Final results** screen (podium, totals) with **Play again**, which keeps the same room and players and resets scores.

### Voting rules
- Votes are **public**: everyone sees, live, who is voting for whom (color/icon chips on each drawing).
- **Everyone votes, the faker included.** Nobody can vote for themselves.
- A player can change their vote until they **lock in**. A locked vote is final.
- A vote that isn't locked when time runs out counts as cast, if one is selected.

### Guess normalization (auto-accept)
Lowercase, trim, collapse whitespace, strip punctuation, and compare with plural tolerance (`sock` = `socks`, `box` = `boxes`, `berry` = `berries`). Each word entry may also list `alt` accepted spellings/synonyms.

## 5. Scoring

| Who | Earns |
|-----|-------|
| Real player | **+1** for voting for the faker |
| Faker | **+1** for each real player who did **not** vote for them |
| Faker | **+2** for a correct word guess |
| Faker | **+1** if the player the faker voted for received the **most votes** (a tie for most counts) |

Not included (considered and rejected): no early-lock bonus and no penalty for drawing suspicion as an innocent. Being suspected already costs points, because votes on an innocent player are points the faker gains.

### Scoring edge cases (decided by Claude; please review)
- A real player who is **connected but casts no vote** counts as "did not vote for the faker" → faker +1.
- A player who is **disconnected for the whole voting phase** is excluded from the round's tally (neither side scores from them).
- For "most votes", tally every cast vote including the faker's own.
- A cancelled round (faker disconnects, §7) awards **no points to anyone**.

## 6. Words

- A built-in, family-friendly list in `data/words.json`, in three difficulty levels:
  - **Concrete**: objects (sock, umbrella, ladder)
  - **Medium**: places, events, actions, seasons (birthday, winter, camping)
  - **Abstract**: feelings and ideas (love, brave, surprise)
- **The category is always shown**, the faker included.
- The host picks a difficulty: Concrete, Medium, Abstract or Mixed.
- **Global deck:** one singleton `DeckDO` holds a seeded shuffle and a current position for each difficulty, shared by **every game everywhere**. Each round takes the next word in order. When a deck runs out, it reshuffles with a new seed. With few groups playing, nobody sees repeats. If the game ever becomes popular, picks are effectively random at no extra cost.
- If a dealt word was already used in the current game (possible with popularity), skip it and deal the next one.

## 7. Fairness, cycles & connection handling

- The game runs in **cycles**. In each cycle, every active player is the faker exactly once, in a random secret order. The host sets the number of cycles before starting (default: 1 for a quick game, 2 for a longer one; allow 1–3).
- **Reconnecting:** on joining, each device stores a private player token in `localStorage`. A reload, sleep or Wi-Fi drop reconnects automatically as the same player with the same score. On a new device, scanning the QR code again offers **"Rejoin as…"** with a list of disconnected players.
- **Disconnect mid-round:** the round continues. A missing drawing shows as a blank "Agent went dark" card, and a missing vote scores nothing (see §5 edge cases).
- **Faker disconnects** (during briefing or drawing): the round is **cancelled**, no points are awarded, and that player's faker turn is moved to later in the cycle if they come back, otherwise dropped.
- **Leaving for good:** the host can **remove** a disconnected player. Their remaining faker turns are dropped and their score stays visible, greyed out.
- **Late joiners** wait in the lobby and join at the **start of the next cycle**, so they get a full fair share of faker turns.
- The game requires ≥3 active players. If it drops below 3, it pauses until someone rejoins or the host ends it.

## 8. Timers (host-configurable)

| Preset | Draw | Per slide | Vote (after slideshow) | Guess |
|--------|------|-----------|------------------------|-------|
| Quick | 40 s | 2.5 s | 30 s | 20 s |
| **Normal (default)** | 60 s | 3.5 s | 45 s | 30 s |
| Relaxed | 90 s | 5 s | 60 s | 45 s |
| Custom | any | any | any | any |

The slideshow length is `players × 2 × perSlide` (10 players on Normal = 70 s). The vote countdown starts **after** the second pass, and voting is open during the slideshow too.

## 9. Drawing tools (keep it simple)

- About 8 colors, 2–3 brush sizes, an eraser, undo, and clear (with confirmation).
- A fixed-aspect canvas (e.g. 4:3) so every drawing displays the same on every device.
- Touch-first, using pointer events, with no scrolling or zooming while drawing.
- On submit or timeout, the client exports a compressed image (WebP/PNG, scaled to ~600 px wide) and sends it to the room. Strokes can stay client-side.

## 10. Narrator (TTS)

- Browser `speechSynthesis`, with no server cost.
- Reads phase transitions in the spy voice: "Agents, your mission briefing is ready." "Draw now — sixty seconds." "Pencils down. Let's review the evidence." "The faker was… Maya!" plus final results.
- On by default for the host, off for everyone else, with a toggle on every device. It never blocks gameplay.

## 11. Rules screen

An **ⓘ** button on **every screen** (the lobby included) opens a sheet with the full rules and the scoring table. Opening it never interrupts or pauses the game.

## 12. Look & feel

- **Colorful and playful, but polished**, in the style of Jackbox games. Bold colors, crisp shapes, smooth animation, witty spy wording ("Agent Maya, your briefing is classified").
- Spy motifs: classified envelopes and stamps, dossiers, fingerprints, magnifying glasses, disguises.
- **Not moody/dark, and not baby-ish.** It should be fun for kids without making teens feel it's beneath them. No cutesy mascot.
- The briefing hold-to-reveal is the signature interaction: an envelope that slides open while held.

## 13. Platform & hosting

- **Installable PWA:** manifest, icons, and a service worker that caches the app shell for fast loads. Gameplay needs a live connection.
- **Cloudflare free tier:** a Worker with static assets serves the PWA, and Durable Objects run the game.
  - `RoomDO`: one per room code. It is the authoritative game state machine and uses WebSockets (the **Hibernation API**, to keep duration charges minimal), with **alarms** for phase timers.
  - `DeckDO`: a singleton global word deck (§6). It uses SQLite-backed DO storage, which the free plan supports.
- Hosted at the default **`*.workers.dev`** address for now. The QR code URL is built from `location.origin`, so a custom domain later needs no code changes.
- Check current Workers/DO free-tier limits when implementing. Previous projects at this scale have never hit them.

## 14. Architecture notes

- **The server is authoritative.** Clients send intents (`draw:submit`, `vote:set`, `vote:lock`, `guess:submit`, `guess:judge`, host actions), and the room broadcasts state.
- **The secret word is sent only to non-fakers**, and the faker's identity only to the faker, until unmask. Never broadcast either in the shared state before the reveal. Clients should never be able to see the role in dev tools.
- **Timers:** the server sends absolute deadlines (epoch ms) and clients compute countdowns using a measured clock offset. The slideshow index is derived from `slideshowStart + n × perSlide`, so all phones stay in sync without per-slide messages.
- **Room codes:** 4 letters, excluding confusable characters. A room expires after a period of inactivity (e.g. 2 h) using an alarm that clears storage.
- **State to persist in RoomDO storage** (so a DO eviction or restart doesn't lose the game): players, scores, settings, cycle schedule, current phase and deadline, current word, faker ID, votes, guess. Drawings can live in storage for the current round only.

### Sketch of messages (adjust to existing project conventions)

```
client → server
  join {name, color, icon, token?}       rejoin {token}       rejoinAs {playerId}
  host:settings {...}  host:start  host:next  host:remove {playerId}  host:end
  draw:done {image}
  vote:set {targetId}   vote:lock
  guess:submit {text}   guess:judge {accept: bool}
  ping {t}

server → client
  state {publicState}                    // the same for everyone
  private {role, word?, category}        // per player, briefing only
  pong {t, serverTime}
  error {code, message}
```

## 15. Out of scope for v1 (possible later)

- Remote play with in-app chat
- Custom word lists
- Accounts and persistent stats
- Multiple fakers
- Undercover-style "similar word" mode
