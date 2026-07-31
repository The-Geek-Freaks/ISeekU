# ISeekU

A fork of [Felix-Helleckes/ICQ](https://github.com/Felix-Helleckes/ICQ), rebuilt into an
authentic ICQ 5/6 client that speaks XMPP and is protocol-compatible with the
icqr.net network, keeping the WhatsApp and Telegram bridges as extra Transports.

Read [CONTEXT.md](../CONTEXT.md) for the domain language, [docs/adr/](adr/) for the
decisions that are hard to reverse, and [ROAD_TO_ISEEKU.md](ROAD_TO_ISEEKU.md) for the
implementation backlog.

---

## The icqr.net network, as measured

Everything here was verified live against the running service on 2026-07-31, not
inferred from documentation.

| | |
|---|---|
| Address | `132.145.202.182:5222`, plain TCP |
| Protocol | XMPP (RFC 6120/6121) — **not** OSCAR |
| XMPP domain | `132.145.202.182` — the IP literal itself |
| JID form | `<UIN>@132.145.202.182` |
| Resource | `ICQReborn-<HOSTNAME>` |
| Encryption | **none** — the server advertises no STARTTLS |
| SASL | `PLAIN` only |
| Registration | XEP-0077 open; fields `username`, `password` |

The lack of encryption is not a detail. It means the password and every Message
cross the network in readable form. See
[ADR 0002](adr/0002-icqr-net-is-unencrypted-and-must-say-so.md) for how the client
handles that, and the plan's "Plaintext-PLAIN / No-TLS Surfaces" section for every
place it must be visible to the Owner.

---

## Status — 2026-07-31

159 tests green (`npm run test:electron`, `npm run test:unit`).

| Area | Where | State |
|---|---|---|
| Insecure-server gate + downgrade protection | `electron/lib/icq-auth-policy.js` | done · 16 tests · verified live |
| The eight ICQ Statuses ↔ XMPP presence | `electron/lib/icq-presence.js` | done · 23 tests |
| Contacts, Groups, Authorization, Not In List | `electron/lib/icq-contact.js` | done · 31 tests |
| History TSV, reads the official client's archives | `electron/lib/icq-history.js` | done · 25 tests |
| Connection, auth, reconnect back-off | `electron/icq/client.js` | done · verified live |
| XEP-0077 registration | `electron/icq/register.js` | done · `inspect()` verified live |
| Account facade: roster, presence, messages, history | `electron/icq/bridge.js` | done · not yet wired to IPC |
| ICQ 5.1 skin | `src/skins/icq5.css` · `src/components/icq/StatusIcon.js` | done · previewable |
| Server capability probe | `tools/probe-server.js` | done · verified live |
| Sign-in smoke test | `tools/icq-smoke.js` | done · verified live |
| Skin preview | `tools/skin-preview.html` | done |

**Not yet built:** IPC wiring in `main.js`/`preload.js`, the login panel, every
dialog, the WhatsApp/Telegram re-homing.

### Try it

Look at the skin without running anything:

```bash
start tools/skin-preview.html
```

Ask the server what it supports (prompts for a password, stores nothing):

```bash
node tools/probe-server.js --uin <YOUR_UIN> --server 132.145.202.182 --out server-probe.json
```

Sign in and watch live traffic:

```bash
node tools/icq-smoke.js --uin <YOUR_UIN> --server 132.145.202.182 --insecure --seconds 90
```

`--insecure` is required and deliberate: without it the client refuses to
authenticate, before the password reaches the socket.

---

## Where the plan is out of date

[ROAD_TO_ISEEKU.md](ROAD_TO_ISEEKU.md) was written before the code existed. Where
it conflicts with what is built, the code is right.

**1. Module layout.** The plan proposes `electron/xmpp/`, `electron/ipc/` and
`electron/preload/`, which restructures the repo. The implementation follows the
existing bridge pattern instead: `electron/icq/` beside `whatsapp-bridge.js` and
`telegram-bridge.js`, pure logic in `electron/lib/`, IPC registered in `main.js`
the way `wa:*` and `tg:*` already are. Smaller diff, one pattern instead of two.

**2. IPC channel names.** The plan uses `xmpp:*`. The implementation uses `icq:*`,
matching the `wa:*` / `tg:*` convention already in `preload.js`.

**3. Three library claims that turned out to be wrong.** Each was checked against
the installed package, not assumed:

- `@xmpp/client` is **ESM-only**. A CommonJS main process must load it with a
  dynamic `import()`; `require()` fails.
- `@xmpp/client` **refuses SASL PLAIN on an unencrypted stream** — its
  `getMechanism()` filters PLAIN out when `entity.isSecure()` is false. Connecting
  to icqr.net is therefore *not* "zero code changes": it needs the documented
  `credentials` function hook to take over mechanism selection. That hook is where
  the security gate now lives, which is the correct place for it — after stream
  features are known, before any credential is sent.
- `@xmpp/reconnect` has **no back-off**. Its `delay` is a fixed number, not a
  callback. The exponential back-off (2s → 5min) is implemented in
  `electron/icq/client.js`.
