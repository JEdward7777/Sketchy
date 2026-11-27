# Phase 4 — Lobby

`RoomDO` as a thin adapter over the core reducer, and the first real screens:
create a room, show its QR code and room code, join with name, color and spy
icon, reconnect by token, "Rejoin as…", host settings, room expiry and clock
offset. The theme tokens and base components land here so every later screen
builds on them; the spy art pass waits for phase 12. The phase ends with a
lobby the owner can open on a phone after a deploy.

- `4` active: Lobby
  - `4.1` done: `RoomDO` adapter: on each event load state from storage, call `reduce`, persist, perform effects, arm the alarm from `nextDeadline` (harness/AGENTS.md §5)
    - `4.1.1` done: The socket attachment carries the player id, so presence survives hibernation
    - `4.1.2` done: `webSocketClose`/`webSocketError` become presence events in `reduce`; a player is connected while any socket attached to them is open, and a new socket for the same player closes the older one
    - `4.1.3` done: Public state is broadcast; `private` goes only to the owning socket (§14)
  - `4.2` done: Create room: `POST /api/room` generates a code (2.6) and retries on collision (0007)
  - `4.3` done: Handshake `hello` with protocol version; mismatch handling per 0007
      Server side done in unit 4a (`error {code: "version"}`, close 4000); the client's reload prompt landed in 4b (`RoomConnection`, `RoomScreen`).
  - `4.4` done: Join with name, unique color, spy icon (§2); token kept in `localStorage`; automatic reconnect as the same player (§7)
      Server side done in unit 4a (join, color_taken, rejoin by token, one socket per player); `localStorage` (`tokenStore`) and auto-reconnect (`RoomConnection`, `reconnectDelay`) landed in 4b.
  - `4.5` done: "Rejoin as…" a disconnected player from a new device (§7)
      Server side done in unit 4a (immediate between rounds, host:admit mid-round, token rotation); the picker and the host's admit/decline landed in 4b (`JoinForm`, `RejoinRequests`).
  - `4.6` done: Host settings: difficulty (§6), cycles 1–3, default 2, game length = cycles × players (§7, 0018, 0020), timer preset or Custom (§8)
      Server side done in unit 4a (routed to the reducer, DO-tested); the settings panel landed in 4b (`SettingsPanel`, `settings-model.ts`).
  - `4.7` done: Room expiry after inactivity through the multiplexed alarm, clearing storage (§14)
  - `4.8` done: `ping`/`pong` with server time; client clock offset from 2.5 (§14)
      Server side done (since 1.8; DO test "answers ping with the injected clock"); the client's offset probe (`CLOCK_PROBES` pings per connect) landed in 4b.
  - `4.9` done: Theme tokens and base components (§12)
    - `4.9.1` done: Tokens as CSS custom properties: palette, player colors, type scale, radii, spacing, motion
    - `4.9.2` done: Base components: button, panel, player chip (name, color, spy icon, connected state)
  - `4.10` done: Lobby screens
    - `4.10.1` done: Landing: create a room or type a code
    - `4.10.2` done: Join form: name, color picker with taken colors disabled, spy icon picker
    - `4.10.3` done: Lobby: player list with chips, QR and room code built from `location.origin` (§2, §13) with the loopback warning from confess_n_guess, host settings panel
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
