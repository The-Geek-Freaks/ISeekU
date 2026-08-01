# ISeekU — the way to done

<!-- wayfinder:map — the index. Detail lives in the tickets, never here. -->

## Destination

ISeekU is an ICQ recreation that a person who used ICQ in 2001 would recognise
on sight and a person who uses messengers in 2026 would not find crippled. It
reaches the icqr.net network over XMPP, carries WhatsApp and Telegram
alongside, and unlocks a richer set of features when both ends run ISeekU.

Done means: the era skins are faithful, the chat does what ICQ's chat did,
two ISeekU clients can send each other a file of any size and place a call
directly, the old games are playable against a Contact, skins people made
twenty years ago load, and the README sells all of it properly.

## Notes

- **Domain**: `CONTEXT.md` is authoritative. "Contact List" never "roster",
  "Owner" for the local user, "UIN" for the numeric id, "Event" for an
  incoming message.
- **Ground truth**: `docs/ORIGINAL-REFERENCE.md` holds every measured fact
  about the original, with its source. Anything about how ICQ looked or
  behaved is settled there, not from memory — the flower colours were wrong
  once already because they came from the website palette rather than the
  application.
- **Honesty about limits**: the server is unencrypted and says so; OMEMO is
  impossible without PEP; imported skins carry colours, not bitmaps; "P2P with
  no relay" is untrue for users behind symmetric NAT. Each of these is written
  down where a user will meet it. Keep it that way.
- **Skills to consult**: `coding-standards` for the code, `impeccable` for
  anything a user looks at, `system-design-101` for the transport work.
- **Execution is carried into this map.** Tickets here are built, not just
  decided.

## Decisions so far

- [XMPP is the ICQ transport](../docs/adr/0001-xmpp-is-the-icq-transport.md) —
  icqr.net speaks XMPP, not OSCAR; measured against the live service.
- [icqr.net is unencrypted and must say so](../docs/adr/0002-icqr-net-is-unencrypted-and-must-say-so.md) —
  no STARTTLS, SASL PLAIN only; the client refuses unless told, every session.
- [WhatsApp and Telegram stay](../docs/adr/0003-whatsapp-and-telegram-stay-as-extra-transports.md) —
  inherited from the fork and kept as extra transports.
- **Two eras, both native-framed** — `icq99` (Windows 98 chrome, 16px rows) and
  `icq78` (ICQ 7 green, 31px rows) as switchable skins inside the OS frame,
  rather than one self-drawn window.
- **Themes are allow-by-shape** — `electron/lib/icq-theme.js` permits colours,
  gradients and a keyword list; everything else is dropped with a reason,
  because the set of things CSS can be talked into is not enumerable.
- **ICQ Lite 5 `.skn` imports** — OLE compound file, `SkinData` stream, colours
  paired with the property that owns them. 13/13 real skins load.
- **ICQ Plus `.ipz` imports** — ZIP plus binary `skininfo.dat`. Text is never a
  colour, colours come in runs, only section blocks are read. 23/23 load.
- **Message styling is XEP-0393** — XHTML-IM was deprecated in 2018 after XSS
  problems; the markup that survives is the plain text itself.

## Open

<!-- one line per ticket; detail in PLAN/tickets/ -->

- **WebRTC transport** — the one thing standing between the finished transfer
  and call protocols and a working feature. Needs a decision on
  `node-datachannel` (a native dependency, N-API 8 so ABI-stable across Node
  releases) versus doing it in a renderer process where WebRTC already exists.
- **Signalling over XMPP** — carrying the offer/answer/candidate shapes the
  two protocols define as custom elements through `electron/icq/client.js`.
  Blocked on nothing; it just follows the transport decision.
- **Game surfaces** — rules and turn protocol are done and tested; they need a
  board to be played on and a way to invite a Contact.
- **Contact context menu** — the original had Send/Launch/User sections with
  per-Contact Alert and Accept modes. Needs measuring against the screenshots
  in `ORIGINAL-REFERENCE.md` before it can be built faithfully.

## Decisions made this round

- **Chat formatting** — XEP-0393, wired through `StyledBody`, with a toolbar
  that preserves the composer's selection via `onMouseDown`/`preventDefault`
  (a click would blur the textarea and wipe the selection first).
- **Appearance** — local rendering only, stated in the interface. Fixed font
  list rather than system enumeration: enumeration is a fingerprinting
  surface, and offering a font the recipient lacks is a promise the client
  cannot keep. Backgrounds are gradients, never image paths.
- **Peer discovery** — XEP-0115 with the spec's worked example as a fixture,
  cache keyed by recomputed hash so a Contact cannot plant capabilities.
- **File transfer / calls** — protocols and state machines complete and tested,
  including glare resolution that is symmetric across both ends. Transport
  deliberately separate.
- **Games** — Tic-Tac-Toe and Quatro, reimplemented. Opponent moves are
  untrusted and re-checked locally; position reproducible from the move list.
- **ICQ 6.5 / 7 skins** — Boxely XML, read from an unpacked package rather
  than the Inno Setup installer, since requiring `innoextract` of every user
  is not reasonable. 6/6 real skins import.
- **README** — hero in SVG with the flower at its measured colours and the two
  eras drawn as miniature windows, rendered and checked in a fallback font
  because GitHub uses the reader's own.

## Not yet specified

- **Signalling over XMPP** — the call and transfer state machines define their
  message shapes, but carrying them as custom elements through
  `electron/icq/client.js` is unwritten. Graduates once both state machines
  land, since their shapes decide it.
- **TURN** — 20-30% of users need a relay for a direct connection to work at
  all. Whether ISeekU ships a default one, asks the Owner for theirs, or
  degrades to "call failed" is a decision with a cost attached, and it is the
  Owner's call to make.
- **Contact context menu** — the original had Send/Launch/User sections with
  per-Contact Alert and Accept modes. Needs `ORIGINAL-REFERENCE.md` measured
  against the screenshots before it can be built faithfully.

## Out of scope

- **Android and iOS.** Electron does not run there. Reaching them means a
  second client (Tauri v2 or Capacitor) against the same server, and the
  server offers only raw TCP with no WebSocket endpoint, so it needs a bridge
  too. That is its own project, not a ticket on this map. Any XMPP client
  reaches icqr.net today — Conversations on Android, Monal on iOS.
- **The original games as shipped files.** The `.swf` files are not ours to
  distribute and Flash is dead. Reimplementation is in scope; redistribution
  is not.
- **OMEMO.** Needs PEP, which this server does not have. Documented in
  `docs/STATUS.md` rather than attempted.
- **ProSieben branding.** Present in the era's German ICQ and deliberately
  left out.
