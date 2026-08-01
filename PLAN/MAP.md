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

- [Chat formatting toolbar](tickets/formatting.md) — StyledBody built and
  tested but never wired into ChatWindow; no B/I/S/M buttons.
- [Appearance preferences](tickets/appearance.md) — font, size, colour and
  chat background, local rendering only.
- [Peer capability discovery](tickets/capabilities.md) — XEP-0115, so a
  Contact running ISeekU is recognised and peer features unlock.
- [P2P file transfer](tickets/transfer.md) — no size limit, over WebRTC data
  channels.
- [Audio and video calls](tickets/calls.md) — direct, not relayed through
  icqr.net.
- [Games against a Contact](tickets/games.md) — reimplemented, not the
  original Flash.
- [ICQ 6.5 and 7.x skin import](tickets/boxely-skins.md) — skins live inside
  Inno Setup and NSIS installers, Boxely XML+CSS within.
- [README at 12/10](tickets/readme.md) — hero graphics, SVGs, every feature
  shown. The last ticket, deliberately: it can only sell what exists.

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
