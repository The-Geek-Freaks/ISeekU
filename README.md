<div align="center">
  <img src="public/icq-logo.png" width="88" alt="ISeekU" />
  <h1>ISeekU</h1>
  <p>
    An ICQ client — the 2005 one, rebuilt.<br/>
    Numeric UINs, the Contact List, the eight Statuses. Speaks XMPP,
    so it reaches the <a href="https://icqr.net">icqr.net</a> network.
  </p>

  <img src="https://img.shields.io/badge/Electron-29-47848F?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/XMPP-RFC%206120%2F6121-4DAB27" alt="XMPP" />
  <img src="https://img.shields.io/badge/tests-243-4DAB27" alt="243 tests" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</div>

---

Numeric UINs, the Contact List with its Groups and status icons, the eight
Statuses including Free For Chat and Invisible, Away Messages, Authorization
requests, a permanent local Message Archive. Windows XP chrome, Tahoma 8pt,
16-pixel rows, and no rounded corners anywhere.

Underneath it is XMPP, so it talks to the network where the UINs actually are.
WhatsApp and Telegram come along as extra accounts, inherited from the project
this is forked from.

Forked from [Felix-Helleckes/ICQ](https://github.com/Felix-Helleckes/ICQ) (MIT).

## Status

**Working:** signing in, creating a UIN, the Contact List, one-to-one Messages,
typing notifications, delivery receipts, Status and Status Text, Away Messages,
Alert-when-online, and a local History that reads the archives the official ICQ
Reborn client writes.

**Not yet built:** User Details, Add/Find Contact, the Message Archive browser,
Preferences, file transfer, avatars.

[`docs/ROAD_TO_ISEEKU.md`](docs/ROAD_TO_ISEEKU.md) is the backlog;
[`docs/STATUS.md`](docs/STATUS.md) is what is actually done.

## The network

Measured against the live icqr.net service, not taken from documentation:

| | |
|---|---|
| Address | `132.145.202.182:5222`, plain TCP |
| Protocol | XMPP (RFC 6120/6121) — not OSCAR |
| XMPP domain | `132.145.202.182`, the IP literal itself |
| JID | `<UIN>@132.145.202.182` |
| Encryption | **none** — the server advertises no STARTTLS |
| SASL | `PLAIN` only |
| Registration | XEP-0077 open |

### Read this part

**The icqr.net server does not encrypt anything.** Your password, and every
message you send, cross the network in a form anyone on the path can read.

ISeekU will not connect to such a server unless you say so, every session. The
refusal happens after the server has described itself and *before* your
password reaches the socket, and an account connected in the clear stays
visibly marked for as long as it is signed in. There is no "do not show this
again", on purpose.

Where a server does offer encryption, ISeekU uses it and prefers SCRAM over
PLAIN. A server that offered encryption last time and stops is refused outright
rather than accepted quietly.

Your password is stored via Electron `safeStorage` (DPAPI on Windows, Keychain
on macOS, libsecret on Linux) and never travels back out of the main process.

## Running it

```bash
npm install
```

```bash
npm start
```

### Without starting the app

Look at the skin:

```bash
start tools/skin-preview.html
```

Ask a server what it supports:

```bash
node tools/probe-server.js --uin YOUR_UIN --server 132.145.202.182 --out server-probe.json
```

Sign in and watch what arrives:

```bash
node tools/icq-smoke.js --uin YOUR_UIN --server 132.145.202.182 --insecure --seconds 90
```

Both prompt for the password, store nothing, and keep it out of their logs.
`--insecure` is required for icqr.net, and the run says why.

### Tests

```bash
npm run test:electron
```

```bash
npm run test:unit
```

## How it is put together

```
electron/lib/icq-*.js     the domain rules — Statuses, Contacts, History,
                          the security gate. No I/O, fully unit tested.
electron/icq/             the part that talks to a socket: connection,
                          registration, and the account facade.
electron/main.js          IPC, in the same icq:* / wa:* / tg:* pattern.
src/skins/icq5.css        ICQ 5.1, every value sourced or marked ESTIMATED.
src/components/icq/       Contact List, sign-in, Status menu, status icons.
```

[`CONTEXT.md`](CONTEXT.md) defines the vocabulary — the interface says "Contact
List", never "roster". [`docs/adr/`](docs/adr/) records the decisions that are
hard to reverse and would otherwise look like mistakes.

## Credits and licence

MIT, as inherited. Built on
[Felix-Helleckes/ICQ](https://github.com/Felix-Helleckes/ICQ) by Felix
Helleckes.

Not affiliated with ICQ, its former owners, or the icqr.net project. The
interface is an original recreation: no ICQ artwork is redistributed here, and
the status icons are drawn from scratch.
