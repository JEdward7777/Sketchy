# Phase 4 — Lobby

`RoomDO` as a thin adapter over the core reducer, and the first real screens:
create a room, show its QR code and room code, join with name, color and spy
icon, reconnect by token, "Rejoin as…", host settings, room expiry and clock
offset. The theme tokens and base components land here so every later screen
builds on them; the spy art pass waits for phase 12. The phase ends with a
lobby the owner can open on a phone after a deploy.

- `4` active: Lobby
  - `4.1` todo: `RoomDO` adapter: on each event load state from storage, call `reduce`, persist, perform effects, arm the alarm from `nextDeadline` (harness/AGENTS.md §5)
    - `4.1.1` todo: The socket attachment carries the player id, so presence survives hibernation
    - `4.1.2` todo: `webSocketClose`/`webSocketError` become presence events in `reduce`; a player is connected while any socket attached to them is open, and a new socket for the same player closes the older one
    - `4.1.3` todo: Public state is broadcast; `private` goes only to the owning socket (§14)
  - `4.2` todo: Create room: `POST /api/room` generates a code (2.6) and retries on collision (0007)
  - `4.3` todo: Handshake `hello` with protocol version; mismatch handling per 0007
  - `4.4` todo: Join with name, unique color, spy icon (§2); token kept in `localStorage`; automatic reconnect as the same player (§7)
  - `4.5` todo: "Rejoin as…" a disconnected player from a new device (§7)
  - `4.6` todo: Host settings: difficulty (§6), cycles 1–3, default 2, game length = cycles × players (§7, 0018, 0020), timer preset or Custom (§8)
  - `4.7` todo: Room expiry after inactivity through the multiplexed alarm, clearing storage (§14)
  - `4.8` todo: `ping`/`pong` with server time; client clock offset from 2.5 (§14)
  - `4.9` todo: Theme tokens and base components (§12)
    - `4.9.1` todo: Tokens as CSS custom properties: palette, player colors, type scale, radii, spacing, motion
    - `4.9.2` todo: Base components: button, panel, player chip (name, color, spy icon, connected state)
  - `4.10` todo: Lobby screens
    - `4.10.1` todo: Landing: create a room or type a code
    - `4.10.2` todo: Join form: name, color picker with taken colors disabled, spy icon picker
    - `4.10.3` todo: Lobby: player list with chips, QR and room code built from `location.origin` (§2, §13) with the loopback warning from confess_n_guess, host settings panel
  - `4.11` todo: Owner's: deploy, then on real phones scan the QR, join from two phones, reload one and see it reconnect, try "Rejoin as…"
      Owner's step; the deploy is the owner's unless 0.6 grants authority.

**Verification.** DO leg: N sockets join one room and all see each other;
duplicate color refused; a closed socket reconnects by token as the same
player; "Rejoin as…" lists only disconnected players; version mismatch gets
the 0007 response; the expiry alarm clears storage under
`runDurableObjectAlarm`; a private message never reaches another socket,
and no player token appears in any public `state` frame or reaches another
player's socket.
E2E leg: three browser contexts create, join and see the same lobby. 4.11 is
the owner's real-phone check and is never simulated.
