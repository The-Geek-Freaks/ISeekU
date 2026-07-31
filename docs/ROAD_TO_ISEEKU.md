# ISeekU — Engineering Implementation Plan

> Working directory: `C:/Users/Shadow-PC/CascadeProjects/ISeekU/ISeekU`
> Upstream: `Felix-Helleckes/ICQ` | Origin: `TheGeekFreaks/ISeekU`
> Stack: React 18 · Electron 29 · Node 20 · Jest · Playwright

---

## What We Deliberately Do NOT Build

| Feature | Reason |
|---|---|
| STARTTLS / TLS to icqr.net | Server advertises no `urn:ietf:params:xml:ns:xmpp-tls`. Building TLS negotiation adds dead code. We document the plaintext reality and gate every session with a user-visible warning instead. |
| SASL PLAIN base-64 "encryption" UI | base64 is not encryption. We never label the icqr.net connection "secure". |
| Invisible status (XEP-0186) | icqr.net does not confirm server-side presence suppression. Emulating it client-side is misleading — other clients would still receive presence. Deferred until confirmed on server. |
| Visible / Invisible per-contact lists (XEP-0016) | Depends on working Invisible mode. Same reason. |
| ICQ SMS / Email Express / Web Pager | Requires ICQ carrier gateway infrastructure that no longer exists. |
| ICQ Phone / VoIP / Video / Walkie-Talkie | Requires STUN/TURN/ICE media infrastructure not provided by icqr.net. |
| Random Chat | Requires server-side matchmaking; no XMPP XEP. |
| Web Aware status badge (status.icq.com) | Server endpoint offline since 2014. |
| ICQ Personal Homepage / ICQ2Go | Requires external web hosting service not part of icqr.net. |
| Multi-User Chat (XEP-0045) | icqr.net does not confirm a `conference.*` MUC component exists. Defer until probed live. |
| OSCAR/ICQ binary protocol | icqr.net speaks XMPP, not OSCAR. Building OSCAR would require a different server entirely. |
| ICQ Xtraz Flash games (live) | Flash is dead. Game state exchange over XMPP is theoretically feasible but zero-user-value without the original game assets. |
| Birthday-driven server broadcasts | ICQ's birthday server endpoints are offline; vCard `<BDAY>` client-side check remains viable (Phase 5). |
| People Navigator / live user directory | Requires server-side online user browsing API. |
| Zlango icon messaging | Third-party asset set unavailable. |
| Web Aware Show IP flag (STATUS_SHOWIP) | ICQ 2000 deliberately removed this. We follow suit. |

---

## npm Dependencies — Complete Diff from Baseline

Add to `package.json` (root, Electron main-process deps):

```json
"@xmpp/client": "0.14.0",
"@xmpp/xml": "0.14.0",
"ini": "4.1.3",
"node-fetch": "3.3.2"
```

Add to devDependencies:

```json
"@xmpp/debug": "0.14.0",
"@testing-library/jest-dom": "6.4.2",
"@testing-library/react": "15.0.7",
"@testing-library/user-event": "14.5.2"
```

Do **not** add `stanza`, `node-xmpp-client`, `@xmpp/sasl2`, or any WebSocket XMPP library.

---

## Phase 0 — Repo Hygiene, Tooling & Test Scaffolding

**Goal:** Clean slate with all tooling wired; CI green on existing tests; devs can run `npm test` and `npm run electron`.

### Steps

**0.1 — `package.json`**

Add the npm dependencies listed above. Pin exact versions. Add scripts:

```json
"test:main": "jest --testPathPattern=electron/",
"test:renderer": "react-scripts test --watchAll=false",
"test:e2e": "playwright test",
"lint": "eslint src electron --ext .js,.jsx"
```

**0.2 — `jest.config.js` (new file)**

```js
module.exports = {
  projects: [
    { displayName: 'main', testEnvironment: 'node',
      testMatch: ['<rootDir>/electron/**/*.test.js'],
      moduleNameMapper: { electron: '<rootDir>/electron/__mocks__/electron.js' } },
    { displayName: 'renderer', testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/**/*.test.js?(x)'] }
  ]
};
```

**0.3 — `electron/__mocks__/electron.js` (new file)**

Minimal mock exposing `ipcMain`, `ipcRenderer`, `app`, `safeStorage` so existing unit tests do not require a real Electron binary.

**0.4 — `electron/__mocks__/xmpp-client.js` (new file)**

Stub that returns an event-emitter object with `start`, `stop`, `send`, `on`, `removeAllListeners`. Used by every xmpp/* unit test.

**0.5 — `.eslintrc.js`**

Add `no-console: 'warn'`, `no-eval: 'error'`, `no-new-func: 'error'`. Electron main-process globals via `env.node: true`.

**0.6 — `playwright.config.js`**

Configure Electron launch via `@playwright/test` electron fixture pointing at the built app. Set `timeout: 30000`, screenshot on failure.

**0.7 — `electron/ipc/channels.js` (new file)**

Frozen constant object containing every IPC channel name:

```js
const CH = Object.freeze({
  // Renderer → Main
  XMPP_CONNECT: 'xmpp:connect',
  XMPP_DISCONNECT: 'xmpp:disconnect',
  XMPP_REGISTER: 'xmpp:register',
  XMPP_SEND_MESSAGE: 'xmpp:send-message',
  XMPP_SEND_CHAT_STATE: 'xmpp:send-chat-state',
  XMPP_SEND_RECEIPT: 'xmpp:send-receipt',
  XMPP_ROSTER_GET: 'xmpp:roster-get',
  XMPP_PRESENCE_SET: 'xmpp:presence-set',
  XMPP_VCARD_GET: 'xmpp:vcard-get',
  XMPP_VCARD_SET: 'xmpp:vcard-set',
  XMPP_UPLOAD_REQUEST: 'xmpp:upload-request',
  XMPP_UPLOAD_PUT: 'xmpp:upload-put',
  XMPP_MAM_QUERY: 'xmpp:mam-query',
  XMPP_BLOCK: 'xmpp:block',
  XMPP_UNBLOCK: 'xmpp:unblock',
  XMPP_DISCO: 'xmpp:disco',
  XMPP_LAST_ACTIVITY: 'xmpp:last-activity',
  STORAGE_GET: 'storage:get',
  STORAGE_SET: 'storage:set',
  // Main → Renderer (push)
  PUSH_CONNECTED: 'xmpp:connected',
  PUSH_DISCONNECTED: 'xmpp:disconnected',
  PUSH_AUTH_FAILED: 'xmpp:auth-failed',
  PUSH_MESSAGE: 'xmpp:message',
  PUSH_CHAT_STATE: 'xmpp:chat-state',
  PUSH_RECEIPT: 'xmpp:receipt',
  PUSH_PRESENCE: 'xmpp:presence',
  PUSH_ROSTER_UPDATE: 'xmpp:roster-update',
  PUSH_VCARD: 'xmpp:vcard',
  PUSH_MAM_RESULT: 'xmpp:mam-result',
  PUSH_MAM_COMPLETE: 'xmpp:mam-complete',
  PUSH_UPLOAD_SLOT: 'xmpp:upload-slot',
  PUSH_BLOCKLIST: 'xmpp:blocklist',
  PUSH_CARBON: 'xmpp:carbon',
  PUSH_INSECURE_WARNING: 'xmpp:insecure-warning',
  // Legacy bridge channels preserved unchanged
  ICQ_READY: 'icq:ready',
  ICQ_MESSAGE: 'icq:message',
  ICQ_PRESENCE: 'icq:presence',
  ICQ_AVATAR: 'icq:avatar',
  ICQ_TYPING: 'icq:typing',
});
module.exports = CH;
```

### Test Strategy — Phase 0

- `npm test` must pass all pre-existing tests (electron/lib/*.test.js).
- Add smoke test: `channels.js` exports a frozen object and every key is a non-empty string.
- Add smoke test: electron mock resolves `safeStorage.encryptString` and `decryptString`.

---

## Phase 1 — XMPP Storage & Credential Layer

**Goal:** Credentials can be saved and loaded securely. No UI, no connection yet.

### Steps

**1.1 — `electron/storage/credentials.js` (new file)**

```js
const { safeStorage } = require('electron');
const settings = require('./settings');

function savePassword(account, plaintext) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable');
  const encrypted = safeStorage.encryptString(plaintext);
  settings.set(account, 'password', encrypted.toString('hex'));
}

function loadPassword(account) {
  const hex = settings.get(account, 'password');
  if (!hex) return null;
  return safeStorage.decryptString(Buffer.from(hex, 'hex'));
}

function clearPassword(account) {
  settings.set(account, 'password', '');
}

module.exports = { savePassword, loadPassword, clearPassword };
```

**1.2 — `electron/storage/settings.js` (new file)**

Reads/writes `%APPDATA%/ICQReborn/settings.ini` (portable fallback next to `.exe` via `electron/lib/data-dir.js`). Uses the `ini` npm package. Maintains keys: `username`, `password` (safeStorage hex blob), `remember`, `lastStatus`. Exports `get(section, key)`, `set(section, key, value)`, `getAll(section)`.

**1.3 — `electron/storage/history-tsv.js` (new file)**

Appends and reads `history/<UIN>_<domain>.tsv`. TSV columns: `ISO8601 \t direction \t peer-bare-domain \t full-jid \t body`. Escapes `\t` → `\\t`, `\n` → `\\n` in the body column before write; unescapes on read. Uses `fs.appendFileSync` for crash-safety. Exports:
- `append(dataDir, uin, domain, row)` — row is `{timestamp, direction, peerDomain, fullJid, body}`
- `readLast(dataDir, uin, domain, peerJid, n)` — returns last n rows for a peer
- `search(dataDir, uin, domain, query)` — substring search across all rows

**1.4 — `electron/storage/credentials.test.js` (new file)**

Unit tests using the electron mock:
- `savePassword` + `loadPassword` round-trip.
- `loadPassword` returns `null` when no stored value.
- `savePassword` throws when `safeStorage.isEncryptionAvailable()` is false.

**1.5 — `electron/storage/history-tsv.test.js` (new file)**

Unit tests using a temp directory:
- `append` + `readLast` round-trip with normal messages.
- Messages containing tab and newline in body are escaped correctly.
- `search` finds matches and misses non-matches.

### Test Strategy — Phase 1

All tests are pure Node (no Electron binary). Run with `npm run test:main`. Coverage target: 90% on both new files.

---

## Phase 2 — XMPP Client Core (xmpp/* modules, no UI)

**Goal:** A working XMPP connection to `132.145.202.182:5222` can be established, authenticated, and torn down from a Node REPL or test.

### Steps

**2.1 — `electron/xmpp/client.js` (new file)**

```js
const { client, xml } = require('@xmpp/client');

const KNOWN_INSECURE = new Set(['132.145.202.182']);

class InsecureServerError extends Error {}

function createXmppClient({ service, domain, resource, username, password, insecure }) {
  const host = new URL(service).hostname;
  if (service.startsWith('xmpp://') && !insecure) {
    throw new InsecureServerError(
      `Server ${host} requires plain TCP (no TLS). ` +
      `Set insecure:true after user confirms the warning.`
    );
  }

  const entity = client({ service, domain, resource, username, password });

  let pingTimer = null;
  function dispose() {
    if (pingTimer) clearInterval(pingTimer);
    entity.stop().catch(() => {});
    entity.removeAllListeners();
  }

  return { entity, dispose, xml, InsecureServerError };
}

module.exports = { createXmppClient, InsecureServerError, KNOWN_INSECURE };
```

**2.2 — `electron/xmpp/auth.js` (new file)**

Validates the connection payload coming from IPC before it reaches `createXmppClient`. Ensures `username` is numeric (UIN constraint for icqr.net). Strips any credential logging by returning a sanitized error object on failure. Never logs `password`.

**2.3 — `electron/xmpp/connection.js` (new file)**

Wraps `entity.start()` / `entity.stop()`. Attaches listeners:
- `entity.on('online', jid => emit(CH.PUSH_CONNECTED, {jid: jid.toString()}))` 
- `entity.on('offline', () => emit(CH.PUSH_DISCONNECTED, {willReconnect: true}))`
- `entity.on('error', err => emit(CH.PUSH_DISCONNECTED, {reason: err.message, willReconnect: false}))` — strip any credential substring from `err.message` before emitting.

`emit` is a callback injected by `handlers.js` that calls `win.webContents.send(channel, data)` on all open windows.

Exports `connect(options, emit)` and `disconnect()`. Stores the `dispose` function returned by `createXmppClient`.

**2.4 — `electron/xmpp/ping.js` (new file)**

After `entity` emits `online`:
1. Schedule `setInterval` at 60 000 ms.
2. Each tick: send `<iq type='get' id='ping-N'><ping xmlns='urn:xmpp:ping'/></iq>` to server JID.
3. Set `setTimeout` at 10 000 ms; if no `<iq type='result'>` with matching `id` arrives, call `entity.disconnect()` (triggers `@xmpp/reconnect` back-off: `attempt => Math.min(2**attempt * 1000, 300_000)`).
4. On cleanup (`dispose()`), `clearInterval` + `clearTimeout`.

**2.5 — `electron/xmpp/disco.js` (new file)**

On `online` event:
1. Query `<iq type='get' to='{domain}'><query xmlns='http://jabber.org/protocol/disco#info'/></iq>`.
2. Populate module-scoped `featureSet: Set<string>`.
3. Query `disco#items` to populate `serviceMap: Map<string, string>` (category → JID).
4. Export `hasFeature(ns: string): boolean` and `getService(category: string): string | null`.

**2.6 — `electron/xmpp/plugins/version.js` (new file)**

Registers `entity.iqCallee.get('jabber:iq:version')`. Replies with `{ name: 'ICQReborn', version: require('../../../package.json').version, os: os.platform() + ' ' + os.release() }`. Never includes any path information.

**2.7 — `electron/xmpp/client.test.js` (new file)**

Unit tests:
- `createXmppClient` with `service: 'xmpp://...'` and `insecure: false` throws `InsecureServerError`.
- `createXmppClient` with `insecure: true` does not throw (uses mock).
- `KNOWN_INSECURE` contains `'132.145.202.182'`.

**2.8 — `electron/xmpp/connection.test.js` (new file)**

Unit tests using the `xmpp-client` mock:
- `connect` → mock entity emits `online` → `emit` called with `PUSH_CONNECTED`.
- Mock entity emits `error` → `emit` called with `PUSH_DISCONNECTED`.
- Error message in emit payload does not contain password string.

### Test Strategy — Phase 2

All pure Node, no Electron binary. `npm run test:main`. No live network calls — mock `@xmpp/client` entirely. Target: 85% coverage on xmpp/*.

---

## Phase 3 — XMPP Registration (XEP-0077)

**Goal:** A new UIN can be obtained from icqr.net via in-band registration without a web browser.

### Steps

**3.1 — `electron/xmpp/register.js` (new file)**

```js
const { client, xml } = require('@xmpp/client');

const ICQ_SERVICE = 'xmpp://132.145.202.182:5222';
const ICQ_DOMAIN  = '132.145.202.182';

async function registerUin(username, password) {
  // Open an unauthenticated client — no username/password in options
  const entity = client({ service: ICQ_SERVICE, domain: ICQ_DOMAIN,
                           resource: 'register' });

  await entity.start();

  // Step 1: fetch the registration form
  const formResult = await entity.iqCaller.get(
    xml('iq', { type: 'get', to: ICQ_DOMAIN },
      xml('query', { xmlns: 'jabber:iq:register' }))
  );

  // Verify the form fields match the known schema: username, password
  const query = formResult.getChild('query', 'jabber:iq:register');
  if (!query) throw new Error('Server did not return registration form');

  // Step 2: submit credentials
  await entity.iqCaller.set(
    xml('iq', { type: 'set' },
      xml('query', { xmlns: 'jabber:iq:register' },
        xml('username', {}, username),
        xml('password', {}, password)
      ))
  );

  // The assigned UIN is the username we submitted (icqr.net issues sequential UINs)
  // In practice icqr.net may return the assigned UIN in the result; parse it if present
  await entity.stop();
  return username; // caller must prompt user to use the assigned UIN
}

module.exports = { registerUin };
```

> **Note on icqr.net registration behaviour:** The server's XEP-0077 form uses `username` and `password` fields. The server assigns a numeric UIN as the username. If the submitted username is taken or invalid, the server returns a `<conflict/>` or `<not-acceptable/>` error stanza — catch these and surface a human-readable message to the renderer.

**3.2 — `electron/ipc/handlers.js` (new file, partial — registration handler only)**

```js
const { ipcMain } = require('electron');
const CH = require('./channels');
const { registerUin } = require('../xmpp/register');

ipcMain.handle(CH.XMPP_REGISTER, async (event, { username, password }) => {
  try {
    const uin = await registerUin(username, password);
    return { ok: true, uin };
  } catch (err) {
    return { ok: false, error: err.condition || err.message };
  }
});
```

**3.3 — `electron/xmpp/register.test.js` (new file)**

Tests using a mock `@xmpp/client`:
- Successful registration returns a UIN string.
- Server returns `<conflict/>` → `registerUin` throws with message `'conflict'`.
- The temp client is stopped even on error (test mock verifies `entity.stop()` called).

### Test Strategy — Phase 3

Pure Node, mock XMPP. Also add an **integration smoke test** (skipped in CI, run manually against live icqr.net):

```
npm run test:integration -- --grep "register UIN live"
```

This is the first phase that touches the live server. Run it once before committing to verify the form field names match.

---

## Phase 4 — XMPP Roster, Presence & Messaging (Core Protocol)

**Goal:** Connected, roster loaded, can send and receive plain text messages. Everything from this point is testable end-to-end via Playwright.

### Steps

**4.1 — `electron/xmpp/roster.js` (new file)**

On `entity` `online`:
1. Send `<iq type='get'><query xmlns='jabber:iq:roster'/></iq>`.
2. Parse response items: `{jid, name, subscription, groups:[]}`.
3. Emit `CH.PUSH_ROSTER_UPDATE` with full item array.
4. Register middleware for incoming `<iq type='set'><query xmlns='jabber:iq:roster'>` roster pushes — emit delta `PUSH_ROSTER_UPDATE`.
5. Handle subscription stanzas:
   - `<presence type='subscribe'>` from unknown JID → emit `PUSH_PRESENCE {type:'subscribe', jid}` for renderer to show auth-request UI.
   - `<presence type='subscribed'>` → emit `PUSH_PRESENCE {type:'subscribed', jid}` (contact accepted add).
   - `<presence type='unsubscribed'>` → emit `PUSH_PRESENCE {type:'unsubscribed', jid}`.
6. Roster-add IPC (`XMPP_ROSTER_GET`) → re-fetch and return current roster array.

For contacts where `subscription === 'from'` (they see us, we do not see them): tag the roster item `{notInList: true}` in the emitted payload. Renderer groups these under a "Not In List" section.

**4.2 — `electron/xmpp/presence.js` (new file)**

- On `online`: send initial presence `<presence><show>chat</show><status></status><priority>5</priority></presence>` (default = Free For Chat on first connect; user can change).
- Handle `XMPP_PRESENCE_SET {show, status, priority}` IPC: construct and send the appropriate `<presence>` stanza. Show values map: `online → (no show element)`, `ffc → chat`, `away → away`, `na → xa`, `dnd → dnd`, `occupied → dnd` + `<status>Occupied</status>`.
- Middleware on incoming `<presence>`: parse `show`, `status`, `type`, `priority`, extract XEP-0153 `<x xmlns='vcard-temp:x:update'><photo>` hash. Emit `PUSH_PRESENCE {jid, show, status, type, avatarHash}`. If `avatarHash` differs from cached value for that JID, enqueue a `vcard.js` fetch.
- Alert-when-online: maintain a `Set<jid>` of watched JIDs (populated from renderer calls). When a presence arrives with no `type` (= available) for a watched JID, emit a special `PUSH_PRESENCE {jid, alertFired: true}`.

**4.3 — `electron/xmpp/messaging.js` (new file)**

- `XMPP_SEND_MESSAGE {to, body, id}`: send `<message type='chat' to='{to}' id='{id}'><body>{body}</body><request xmlns='urn:xmpp:receipts'/><active xmlns='http://jabber.org/protocol/chatstates'/></message>`. Generate `id` via `crypto.randomUUID()` if not provided. Return `{id}`.
- Incoming message middleware: skip messages without `<body>`, skip if `from` is own JID (carbons handled separately). Parse `<received xmlns='urn:xmpp:receipts'>` children → emit `PUSH_RECEIPT`. Parse `<composing|paused|active|inactive>` children → emit `PUSH_CHAT_STATE`. If message has `<body>`, emit `PUSH_MESSAGE {from, to, id, body, type:'chat', timestamp, isHistorical:false}`.
- If incoming message contains `<request xmlns='urn:xmpp:receipts'/>`: send receipt reply immediately.

**4.4 — `electron/xmpp/carbons.js` (new file)**

After session start, if `disco.hasFeature('urn:xmpp:carbons:2')`:
- Send `<iq type='set'><enable xmlns='urn:xmpp:carbons:2'/></iq>`.
- Middleware: unwrap `<received|sent xmlns='urn:xmpp:carbons:2'><forwarded>` stanzas. Pass to `messaging.js` handler with `direction` set. Emit `PUSH_CARBON {direction, message}`.

**4.5 — `electron/xmpp/history.js` (new file)**

Calls `history-tsv.js` on every `PUSH_MESSAGE` and `PUSH_CARBON` event received internally. The `direction` column is `0` for outgoing (`fromMe`), `1` for incoming. TSV write happens synchronously inside the main process event loop (no renderer involvement). Deduplicate by `id` before writing (prevents duplicates from offline message burst + MAM overlap).

**4.6 — `electron/xmpp/typing.js` (new file)**

Encapsulates XEP-0085 chat state outbound logic:
- Debounce: first keystroke in renderer → `XMPP_SEND_CHAT_STATE {to, state:'composing'}` IPC → send `<composing/>` element in a message stanza to peer.
- After 5 000 ms no further keystrokes → `state:'paused'`.
- On message send → `state:'active'`.
- Only send to peers that have previously included a chat-state element in a message (track per JID in a `Set<jid> chatStateCapable`).

**4.7 — `electron/ipc/handlers.js` (expand)**

Add all remaining `ipcMain.handle` registrations using the CH constants. Each handler calls the appropriate xmpp/* module function and returns `{ok:true, data}` or `{ok:false, error}`. Inject the `emit` callback to push events to all open windows.

```js
function registerAllHandlers(getWindows) {
  const emit = (channel, data) => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, data);
    }
  };
  // ... all ipcMain.handle calls
}
```

**4.8 — `electron/xmpp/roster.test.js`**, **`messaging.test.js`**, **`presence.test.js`**, **`typing.test.js`** (new files)

Unit tests covering:
- Roster parse of `subscription='from'` sets `notInList:true`.
- Message middleware skips stanzas without `<body>`.
- Receipt reply is sent synchronously on incoming request.
- Composing debounce fires after first keystroke, paused after 5 s delay (use fake timers).
- Outgoing presence `show:'occupied'` generates `<show>dnd</show>` with `<status>Occupied</status>`.

### Test Strategy — Phase 4

Add Playwright e2e test (skipped on CI, live icqr.net):
1. Launch app, fill ICQ login panel with test UIN + password.
2. Accept insecure-warning modal.
3. Wait for roster to load (contact list has at least one entry).
4. Send a message to a second test UIN.
5. Assert message appears in the message log.

---

## Phase 5 — XMPP vCard, Avatars & File Upload

**Goal:** Contact photos appear; images can be pasted/sent; profile cards open.

### Steps

**5.1 — `electron/xmpp/vcard.js` (new file)**

- `XMPP_VCARD_GET {jid}`: send `<iq type='get' to='{jid}'><vCard xmlns='vcard-temp'/></iq>`. Parse fields: `FN`, `NICKNAME`, `EMAIL/USERID`, `URL`, `BDAY`, `DESC`, `ORG/ORGNAME`, `TITLE`, `TEL/NUMBER`, `PHOTO/BINVAL`, `PHOTO/TYPE`.
- Avatar: sha1 the `BINVAL` value. Compare to cached sha1 in `avatarCache: Map<jid, sha1>`. If different: write decoded PNG to `{dataDir}/avatars/{sha1hex}.png` (filename is **only** hex characters — no JID in path to prevent path traversal). Emit `PUSH_VCARD {jid, displayName, avatarPath, email, fields:{...}}`.
- `XMPP_VCARD_SET {vcard}`: construct and publish own vCard. Re-announce avatar hash in next presence stanza via `<x xmlns='vcard-temp:x:update'><photo>{sha1}</photo></x>`.
- On XEP-0153: when incoming presence carries a different `<photo>` hash for a JID we already know, enqueue a vCard fetch (rate-limit: max 5 concurrent, use `createConcurrencyLimiter(5)` from `electron/lib/concurrency.js`).

**5.2 — `electron/xmpp/upload.js` (new file)**

- Discover upload service JID from `disco.getService('store')` or by looking for `urn:xmpp:http:upload:0` in disco#items children.
- `XMPP_UPLOAD_REQUEST {filename, size, contentType}`: send slot request IQ to upload JID. Parse `<slot><put url='...'/><get url='...'/></slot>`. Emit `PUSH_UPLOAD_SLOT {putUrl, getUrl}`.
- `XMPP_UPLOAD_PUT {putUrl, fileBuffer}` (from renderer after user picks a file): perform `HTTPS PUT` from main process via Node's `https.request`. Never involve the renderer network layer. On success, caller sends the `getUrl` as the message body.

**5.3 — `electron/xmpp/mam.js` (new file)**

- Check `disco.hasFeature('urn:xmpp:mam:2')` before activating. If absent, fall back to `history-tsv.js` local reads.
- `XMPP_MAM_QUERY {peer, before, limit}`: send RSM-paged query for peer JID. Collect result messages by `queryId`. On `<fin>` stanza emit `PUSH_MAM_COMPLETE {queryId, complete}`. Each result message emitted as `PUSH_MAM_RESULT {queryId, message}`.

**5.4 — `electron/xmpp/blocking.js` (new file)**

- On session start: if `disco.hasFeature('urn:xmpp:blocking')` fetch blocklist and emit `PUSH_BLOCKLIST {jids}`. Otherwise attempt XEP-0016 privacy list fetch.
- `XMPP_BLOCK {jid}`: send `<block>` IQ (XEP-0191) or privacy list update (XEP-0016 fallback).
- `XMPP_UNBLOCK {jid}`: send `<unblock>` IQ or remove from privacy list.

**5.5 — `electron/xmpp/last-activity.js` (new file)**

- `XMPP_LAST_ACTIVITY {jid}`: send `<iq type='get' to='{jid}'><query xmlns='jabber:iq:last'/></iq>`. Parse `seconds` attribute, compute absolute timestamp (`Date.now() - seconds * 1000`). Return `{jid, lastSeen}`.
- Also handle incoming `jabber:iq:last` queries: reply with `{seconds: Math.floor((Date.now() - lastUserAction) / 1000)}`. Track `lastUserAction` via a main-process-side idle timer reset on any IPC call from the renderer.

**5.6 — `electron/xmpp/vcard.test.js`**, **`upload.test.js`** (new files)

Unit tests:
- `vcard.js` sanitizes avatar filename to hex-only characters.
- `vcard.js` does not fetch vCard a second time if sha1 matches cache.
- `upload.js` returns `{ok:false}` when disco returns no upload service.
- `upload.js` PUT failure is caught and returned as `{ok:false, error}`.

### Test Strategy — Phase 5

Add Playwright e2e test:
1. Open contact's profile card.
2. Assert avatar image displays (not broken/placeholder).
3. Paste an image from clipboard in chat window.
4. Assert image appears in message log inline.

---

## Phase 6 — Electron Main Process Integration (electron/main.js + preload.js)

**Goal:** All xmpp/* modules are wired into the Electron app. The renderer can call `window.api.icq.*`.

### Steps

**6.1 — `electron/main.js` (modify)**

Following the exact pattern of lines 107–115 (bridge load block):

```js
let xmppBridge;
try {
  xmppBridge = require('./xmpp-bridge'); // thin façade — see 6.2
} catch (e) {
  console.warn('XMPP bridge load failed:', e.message);
  xmppBridge = { init: () => {}, shutdown: () => {} }; // stub
}
```

In `app.on('ready')`: call `xmppBridge.init(onAvatarCb, dataDir)`.

Add `icqMessageCache: new Map()` (same 8-entry LRU, 10-second TTL pattern as `waMessageCache`; separate map to prevent key collision with WA numeric IDs).

Import and call `registerAllHandlers(() => getAllWindows())` from `electron/ipc/handlers.js`.

**6.2 — `electron/xmpp-bridge.js` (new file)**

Thin façade that composes all xmpp/* modules:

```js
const connection = require('./xmpp/connection');
const roster = require('./xmpp/roster');
const presence = require('./xmpp/presence');
const messaging = require('./xmpp/messaging');
const vcard = require('./xmpp/vcard');
const history = require('./xmpp/history');
const carbons = require('./xmpp/carbons');
const mam = require('./xmpp/mam');
const upload = require('./xmpp/upload');
const blocking = require('./xmpp/blocking');
const disco = require('./xmpp/disco');
const ping = require('./xmpp/ping');
const typing = require('./xmpp/typing');
const { registerUin } = require('./xmpp/register');

function init(onAvatarCb, dataDir) {
  vcard.setDataDir(dataDir);
  history.setDataDir(dataDir);
  // modules self-wire to the entity via connection.js events
}

function shutdown() { connection.disconnect(); }

module.exports = { init, shutdown };
```

**6.3 — `electron/preload.js` (modify)**

After the `tg:` block (line 102), add:

```js
icq: {
  connect:        (uin, pw, insecure) => ipcRenderer.invoke(CH.XMPP_CONNECT, { service: 'xmpp://132.145.202.182:5222', domain: '132.145.202.182', resource: `ICQReborn-${os.hostname()}`, username: String(uin), password: pw, insecure }),
  register:       (u, pw)  => ipcRenderer.invoke(CH.XMPP_REGISTER, { username: u, password: pw }),
  disconnect:     ()       => ipcRenderer.invoke(CH.XMPP_DISCONNECT, {}),
  getStatus:      ()       => ipcRenderer.invoke(CH.XMPP_DISCO, { jid: '132.145.202.182' }),
  getContacts:    ()       => ipcRenderer.invoke(CH.XMPP_ROSTER_GET, {}),
  getMessages:    (jid,o)  => ipcRenderer.invoke(CH.XMPP_MAM_QUERY, { peer: jid, ...o }),
  sendMessage:    (jid,t)  => ipcRenderer.invoke(CH.XMPP_SEND_MESSAGE, { to: jid, body: t }),
  sendChatState:  (jid,s)  => ipcRenderer.invoke(CH.XMPP_SEND_CHAT_STATE, { to: jid, state: s }),
  sendFile:       (jid,p)  => ipcRenderer.invoke(CH.XMPP_UPLOAD_REQUEST, { filePath: p }),
  markRead:       (jid)    => ipcRenderer.invoke(CH.XMPP_SEND_RECEIPT, { to: jid }),
  getAvatar:      (jid)    => ipcRenderer.invoke(CH.XMPP_VCARD_GET, { jid }),
  setPresence:    (s,t)    => ipcRenderer.invoke(CH.XMPP_PRESENCE_SET, { show: s, status: t }),
  block:          (jid)    => ipcRenderer.invoke(CH.XMPP_BLOCK, { jid }),
  unblock:        (jid)    => ipcRenderer.invoke(CH.XMPP_UNBLOCK, { jid }),
  lastSeen:       (jid)    => ipcRenderer.invoke(CH.XMPP_LAST_ACTIVITY, { jid }),
  onMessage:      cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_MESSAGE, h); return () => ipcRenderer.removeListener(CH.PUSH_MESSAGE, h); },
  onPresence:     cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_PRESENCE, h); return () => ipcRenderer.removeListener(CH.PUSH_PRESENCE, h); },
  onReady:        cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_CONNECTED, h); return () => ipcRenderer.removeListener(CH.PUSH_CONNECTED, h); },
  onDisconnect:   cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_DISCONNECTED, h); return () => ipcRenderer.removeListener(CH.PUSH_DISCONNECTED, h); },
  onTyping:       cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_CHAT_STATE, h); return () => ipcRenderer.removeListener(CH.PUSH_CHAT_STATE, h); },
  onRoster:       cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_ROSTER_UPDATE, h); return () => ipcRenderer.removeListener(CH.PUSH_ROSTER_UPDATE, h); },
  onReceipt:      cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_RECEIPT, h); return () => ipcRenderer.removeListener(CH.PUSH_RECEIPT, h); },
  onVcard:        cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_VCARD, h); return () => ipcRenderer.removeListener(CH.PUSH_VCARD, h); },
  onAuthFailed:   cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_AUTH_FAILED, h); return () => ipcRenderer.removeListener(CH.PUSH_AUTH_FAILED, h); },
  onInsecureWarn: cb => { const h = (_,d) => cb(d); ipcRenderer.on(CH.PUSH_INSECURE_WARNING, h); return () => ipcRenderer.removeListener(CH.PUSH_INSECURE_WARNING, h); },
},
```

Import `os` at the top of preload.js (it is a Node built-in, available in the preload context with `contextIsolation:true` since preload runs in the node context).

**6.4 — Fix `src/components/ChatWindow.js` line 239 bare `api` reference**

Change `api.openChat(...)` → `window.api.openChat(...)`. This is a pre-existing bug that would throw `ReferenceError` on member click.

**6.5 — `electron/main.js` avatarStore key namespacing**

Prefix all avatarStore keys with the service name:

```js
// Before
avatarStore.set(id, dataUrl);
// After
avatarStore.set(`icq:${id}`, dataUrl);
avatarStore.set(`wa:${id}`, dataUrl);
avatarStore.set(`tg:${id}`, dataUrl);
```

Update all reads accordingly. Prevents UIN vs WA number collision.

**6.6 — WhatsApp bridge lazy-load mitigation**

Move `whatsappBridge.init()` call out of `app:ready` and into the first time the user clicks the WhatsApp tab (IPC channel `wa:lazy-init`). This prevents the Chrome/Puppeteer startup (30–180 s) from blocking the XMPP connection during cold start.

### Test Strategy — Phase 6

Add Playwright e2e test:
1. Launch app.
2. Navigate to ICQ tab in Sidebar.
3. ICQ login panel renders (UIN + password fields visible).
4. The WA bridge does **not** start Chrome (assert no Puppeteer process in `ps aux` equivalent).

---

## Phase 7 — ICQ 5 Authentic Shell (Reskin)

**Goal:** The application looks unmistakably like ICQ 5. All measurements from the UI spec are applied.

### Steps

**7.1 — `src/skins.js` (modify)**

Add the fourth skin object after the existing three:

```js
{
  id: 'icq5-authentic',
  name: 'ICQ 5',
  vars: {
    '--icq-bg':               '#E8F4E8',
    '--icq-header-bg':        '#4DA12B',
    '--icq-header-gradient':  'linear-gradient(180deg, #5EC13A 0%, #3A8F1A 100%)',
    '--icq-group-bg':         '#C8DEC8',
    '--icq-group-text':       '#000000',
    '--icq-group-text-bold':  '700',
    '--icq-contact-text':     '#000000',
    '--icq-contact-status':   '#808080',
    '--icq-accent':           '#4DAB27',
    '--icq-accent-light':     '#94C729',
    '--icq-selected':         '#316AC5',
    '--icq-selected-text':    '#FFFFFF',
    '--icq-bubble-me':        '#DCF8C6',
    '--icq-bubble-them':      '#FFFFFF',
    '--icq-font-family':      "'Tahoma', 'MS Sans Serif', sans-serif",
    '--icq-font-size':        '11px',       // 8pt at 96dpi
    '--icq-font-size-bold':   '11px',
    '--icq-list-avatar-display': 'none',   // ICQ 5 does not show avatars in list
    '--icq-list-item-height': '16px',
    '--icq-window-width':     '178px',
    '--icq-bottom-bar-height':'22px',
    '--icq-filter-tab-height':'22px',
    '--icq-scrollbar-width':  '16px',
    '--icq-titlebar-height':  '18px',
    '--icq-border-color':     '#A0A0A0',
    '--icq-link-color':       '#0D65BF',
  }
}
```

Set `icq5-authentic` as the default skin when no prior preference is stored (first run). The prior default `retro-teal` remains available in the picker.

**7.2 — `src/themes.css` (modify)**

Update fallback variable values to match `icq5-authentic` defaults. This ensures the app looks correct even before `skins.js` initialises.

**7.3 — `src/index.css` (modify)**

Add `font-family: var(--icq-font-family, 'Tahoma', sans-serif); font-size: var(--icq-font-size, 11px);` on `body`. The existing `win98-raised` / `win98-sunken` bevel classes remain unchanged — they are already appropriate for the ICQ 5 aesthetic.

**7.4 — `src/components/Sidebar.css` (modify)**

- `.contact-list` background → `var(--icq-bg)`.
- `.group-section > .group-header` background → `var(--icq-group-bg)`, font-weight → `var(--icq-group-text-bold)`, height → `var(--icq-list-item-height)`, left-padding `4px`.
- `.contact-item` height → `var(--icq-list-item-height)`, left-indent `20px`.
- `.contact-avatar` display → `var(--icq-list-avatar-display, none)` (hidden in ICQ 5 skin).
- `.contact-item.selected` background → `var(--icq-selected)`, color → `var(--icq-selected-text)`.
- `.bottom-bar` height → `var(--icq-bottom-bar-height)`.
- Add `.filter-tabs` row (All / Online buttons) height → `var(--icq-filter-tab-height)`.
- Add `.svc-tab.icq .svc-tab-dot` color mapping: `disconnected → #808080`, `ready → #4DAB27`, `loading → #E6B800`, `error → #FC021E`.

**7.5 — Status icon assets**

Place pixel-authentic 16×16 status GIFs at `public/status/`:

```
status_online.gif    — bright green circle
status_ffc.gif       — bright green with chat bubble
status_away.gif      — yellow crescent moon
status_na.gif        — amber clock
status_occupied.gif  — red-orange circle
status_dnd.gif       — red circle with X
status_offline.gif   — dark gray circle
status_invisible.gif — hollow gray circle
```

Map in a new `src/lib/status-icons.js`:

```js
export const STATUS_ICON = {
  chat:      '/status/status_ffc.gif',
  available: '/status/status_online.gif',
  away:      '/status/status_away.gif',
  xa:        '/status/status_na.gif',
  dnd:       '/status/status_dnd.gif',
  occupied:  '/status/status_occupied.gif',
  offline:   '/status/status_offline.gif',
  invisible: '/status/status_invisible.gif',
};
```

**7.6 — ICQ flower logo assets**

Place `public/icq-flower-16.png`, `public/icq-flower-32.png`, `public/icq-flower-64.png`. These are drawn as SVG first (7 green petals `#3A8F1A` + 1 red petal `#FC021E` + yellow center `#FFD700` + black outline) and exported to PNG at each size.

**7.7 — `electron/main.js` (modify)**

Change `contactListWindow` default size to `178 × 305` px (from current default). Set `minWidth: 130`.

**7.8 — `src/components/Sidebar.js` (modify)**

Add the ICQ service tab in the `service-tabs` div (lines 308–327). The tab renders:
- An `<img src='/icq-flower-16.png' alt='ICQ' />` logo.
- A status dot reading `icqStatus` prop.
- `onClick={() => setActiveService('icq')}`.

Pass `icqStatus` and `icqGroupSound` as new props from `App.js`.

Add `All / Online` filter tab row below the service tabs (ICQ 5 style). Initially a UI-only toggle — `Online` filter hides contacts where `presence === 'offline'`.

**7.9 — `src/lib/status-icons.js`**, **`src/components/ContactItem.js`**

`ContactItem` currently renders a colored dot. Extend it to render `<img src={STATUS_ICON[contact.show]} width='16' height='16' />` instead of the dot when `activeService === 'icq'` and the `icq5-authentic` skin is active.

**7.10 — Typography enforcement**

All ICQ contact name labels must render in Tahoma 11px (8pt). Status sub-text in italic `#808080`. Group headers in bold. These are achieved via the CSS variables already set in step 7.1 — no additional JSX changes needed if components use `font-family: var(--icq-font-family)`.

### Test Strategy — Phase 7

- Visual regression: Playwright screenshot of the contact list window with `icq5-authentic` skin active. Compare against a reference screenshot committed to `tests/screenshots/icq5-contact-list.png`.
- Unit test: `skins.js` exports exactly 4 skins; `icq5-authentic` is one of them and contains all required CSS variables.
- Unit test: `status-icons.js` maps every XMPP show value to a non-empty string.

---

## Phase 8 — ICQ Login & Registration UI

**Goal:** The login panel shows an authentic ICQ 5 login form. Users can log in with an existing UIN or register a new one. The plaintext-PLAIN warning is shown every session.

### Steps

**8.1 — `src/components/LoginPanel.js` (modify)**

Add `IcqPanel` component below the existing `TelegramPanel`:

```jsx
function IcqPanel({ onConnect, onRegister, status, error }) {
  const [uin, setUin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [autoLogin, setAutoLogin] = useState(false);
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [showWarning, setShowWarning] = useState(false);

  const handleSubmit = () => {
    // Always show the plaintext warning before connecting.
    // There is NO "do not show again" option for plain-TCP servers.
    setShowWarning(true);
  };

  const handleConfirmInsecure = () => {
    setShowWarning(false);
    if (mode === 'login') onConnect(uin, password, remember, autoLogin);
    else onRegister(uin, password);
  };

  return (
    <div className='icq-login-panel'>
      {showWarning && (
        <InsecureWarningModal
          server='132.145.202.182:5222'
          onConfirm={handleConfirmInsecure}
          onCancel={() => setShowWarning(false)}
        />
      )}
      <div className='icq-login-logo'>
        <img src='/icq-flower-64.png' alt='ICQ' width='64' height='64' />
      </div>
      <div className='icq-login-form'>
        <label>UIN</label>
        <input className='win98-input' type='text' inputMode='numeric'
               pattern='[0-9]*' value={uin} onChange={e => setUin(e.target.value)} />
        <label>Password</label>
        <input className='win98-input' type='password' value={password}
               onChange={e => setPassword(e.target.value)} />
        <label><input type='checkbox' checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember Password</label>
        <label><input type='checkbox' checked={autoLogin} onChange={e => setAutoLogin(e.target.checked)} /> Auto-Login</label>
        <button className='win98-btn icq-btn-primary' onClick={handleSubmit}>
          {mode === 'login' ? 'Login' : 'Register'}
        </button>
        <button className='win98-btn' onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'New User? Register' : '← Back to Login'}
        </button>
        {status === 'loading' && <span>Connecting…</span>}
        {status === 'error'   && <span className='icq-error'>{error}</span>}
      </div>
    </div>
  );
}
```

**8.2 — `InsecureWarningModal` (inside LoginPanel.js)**

```jsx
function InsecureWarningModal({ server, onConfirm, onCancel }) {
  return (
    <div className='icq-modal-overlay'>
      <div className='icq-modal win98-raised'>
        <div className='icq-modal-header'>Security Warning</div>
        <div className='icq-modal-body'>
          <p><strong>This server does not support encryption.</strong></p>
          <p>Server: <code>{server}</code></p>
          <p>Your UIN and password will be sent in plain text over the network.
             Anyone on the same network can intercept them.</p>
          <p>Only connect on a trusted private network.</p>
        </div>
        <div className='icq-modal-footer'>
          <button className='win98-btn icq-btn-danger' onClick={onConfirm}>Connect Anyway</button>
          <button className='win98-btn' onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

This modal has **no "do not show again" checkbox**. It appears on every session start for plain-TCP servers. The UIN and password fields are cleared if the user clicks Cancel.

**8.3 — `src/components/LoginPanel.js` (wiring)**

Add `'icq'` to the service switch in the main `LoginPanel` export. Render `<IcqPanel>` when `service === 'icq'`.

**8.4 — `src/App.js` (modify)**

Add state:

```js
const [icqStatus, setIcqStatus] = useState('disconnected');
const [icqError, setIcqError] = useState(null);
const icqCacheRef = React.useRef(null);
const icqProfileRef = React.useRef(null);
```

Add `'icq'` to `activeService` enum. Register event listeners in the main `useEffect`:

```js
const offReady   = window.api.icq.onReady(() => { setIcqStatus('ready'); loadIcqContacts(); });
const offAuth    = window.api.icq.onAuthFailed(({reason}) => { setIcqStatus('error'); setIcqError(reason); });
const offDisc    = window.api.icq.onDisconnect(({willReconnect}) => setIcqStatus(willReconnect ? 'loading' : 'disconnected'));
const offRoster  = window.api.icq.onRoster(items => { /* update icqCacheRef, setChats */ });
const offMsg     = window.api.icq.onMessage(msg => patchIcqChat(msg));
const offPresence = window.api.icq.onPresence(p => updateIcqPresence(p));
return () => { offReady(); offAuth(); offDisc(); offRoster(); offMsg(); offPresence(); };
```

Add `handleIcqConnect(uin, password, remember, autoLogin)`:

```js
async function handleIcqConnect(uin, password, remember, autoLogin) {
  setIcqStatus('loading');
  setIcqError(null);
  const result = await window.api.icq.connect(uin, password, true); // insecure:true — user already confirmed in modal
  if (!result.ok) { setIcqStatus('error'); setIcqError(result.error); }
}
```

Add `handleIcqRegister(username, password)`:

```js
async function handleIcqRegister(username, password) {
  setIcqStatus('loading');
  const result = await window.api.icq.register(username, password);
  if (result.ok) {
    // Show the assigned UIN in a success dialog; then attempt login
    setIcqStatus('disconnected');
  } else {
    setIcqStatus('error');
    setIcqError(result.error);
  }
}
```

Add `icq` branch in `openChat()`:

```js
if (activeService === 'icq') {
  const jid = `${chat.id}@132.145.202.182`;
  window.api.openChat({ service: 'icq', chatId: jid, chatName: chat.name });
}
```

**8.5 — `src/components/LoginPanel.css` (modify)**

Add `.icq-login-panel`, `.icq-login-logo`, `.icq-login-form`, `.icq-modal-overlay`, `.icq-modal`, `.icq-modal-header`, `.icq-modal-body`, `.icq-modal-footer`, `.icq-btn-primary`, `.icq-btn-danger` rules. Mirror the ICQ 5 login dialog sizing (320×240 px) and color scheme using CSS variables.

### Test Strategy — Phase 8

- Unit test: `IcqPanel` renders UIN + password inputs and the Register toggle.
- Unit test: Submitting the form without accepting the warning modal does **not** call `onConnect`.
- Unit test: `InsecureWarningModal` has no "do not show again" checkbox.
- Playwright e2e: Navigate to ICQ tab → login panel appears → fill form → Submit → warning modal appears → Cancel → fields still populated → Connect Anyway → `onConnect` called with `insecure:true`.

---

## Phase 9 — Chat Window ICQ Integration

**Goal:** ICQ messages can be sent and received in the chat window. Ack ticks, typing indicators, and inline images work.

### Steps

**9.1 — `src/ChatApp.js` (modify)**

In `sendMessage()` (line 234):

```js
} else if (service === 'icq') {
  await window.api.icq.sendMessage(chatId, text);
}
```

In `sendFile()` (line 265):

```js
} else if (service === 'icq') {
  const slot = await window.api.icq.sendFile(chatId, filePath);
  if (slot.ok) {
    await window.api.icq.sendMessage(chatId, slot.getUrl);
  }
}
```

In `useEffect` that registers listeners (line 181): add ICQ message, typing, receipt, and presence listeners:

```js
if (service === 'icq') {
  const offMsg  = window.api.icq.onMessage(msg => { if (msg.from === chatId || msg.fromMe) appendMessage(msg); });
  const offTyp  = window.api.icq.onTyping(({from, state}) => { if (from === chatId) setIsTyping(state === 'composing'); });
  const offRcpt = window.api.icq.onReceipt(({id}) => patchAck(id, 3));
  return () => { offMsg(); offTyp(); offRcpt(); };
}
```

Remove the WA/TG polling fallback for ICQ (`service === 'icq'` must not trigger the message-reconcile `setInterval` at line 134).

**9.2 — `src/components/ChatWindow.js` (modify)**

In `sendMessage()` and `sendFile()`: add `else if (service === 'icq')` arms calling `window.api.icq.sendMessage` and `window.api.icq.sendFile`.

In `sendVoice()` (line 461): ICQ has no native voice note format. Map to file upload via XEP-0363, same as `sendFile`. The voice note is a `.webm` blob; upload it as `audio/webm` and send the URL.

Sticker send: ICQ has no sticker concept. Map sticker sends to `sendMessage` with the sticker emoji string, or skip with a UI toast "Stickers not supported on ICQ".

In the `AckIcon` component (line 53): the existing mapping already works — ack 3 = read (XEP-0184 `displayed`), ack 2 = delivered, ack 1 = sent, ack 0 = pending. No change needed. Verify there is no ICQ-specific branch needed.

Typing indicator (line 667): the existing `isTyping` boolean is already generic. Wire it to the `onTyping` listener added in step 9.1.

`TitleBar` title (line 354): add `|| service === 'icq'` to the condition that shows the contact name so ICQ chats show the contact display name correctly.

**9.3 — `src/components/ChatWindow.js` bug fix — `api` bare reference (line 239)**

Already fixed in Phase 6, step 6.4. Confirm fix is still present.

**9.4 — Inline image rendering**

The chat window already renders inline images when `msg.type === 'image'` or the body is a URL ending in `.jpg/.png/.gif/.webp`. No ICQ-specific change needed — XEP-0363 returns HTTPS URLs; the renderer detects the extension.

**9.5 — `src/ChatApp.js` — XMPP message shape normalisation**

Map `PUSH_MESSAGE` payload to the canonical Message shape from the state design:

```js
function xmppMsgToCanonical(msg) {
  return {
    id:        msg.id,
    body:      msg.body,
    fromMe:    msg.fromMe,
    timestamp: msg.timestamp,
    author:    msg.from,
    type:      msg.body?.match(/\.(png|jpg|gif|webp)(\?.*)?$/i) ? 'image' : 'chat',
    isGif:     false,
    ack:       msg.fromMe ? 1 : 3,   // sent=1 initially; updated to 3 on receipt
    hasMedia:  false,
    mediaData: null,
    edited:    false,
  };
}
```

### Test Strategy — Phase 9

- Playwright e2e: open a chat with a second test UIN, send a message, observe ack tick progress from 1 → 3.
- Playwright e2e: second test client sends a message; typing indicator appears; message arrives.
- Playwright e2e: paste a PNG from clipboard; image appears inline in chat log.

---

## Phase 10 — User Info Card (Profile Dialog)

**Goal:** Right-clicking a contact shows their profile. Own profile is editable.

### Steps

**10.1 — `src/components/UserInfoCard.js` (new file)**

Tabbed dialog with 5 tabs matching the ICQ 5 spec:
- **General:** UIN (read-only), Nickname, First name, Last name, Email, Homepage.
- **More:** Age, Gender (dropdown), Language (dropdown), Country (dropdown).
- **Work:** Company, Department, Position, Phone.
- **About:** Free-text biography `<textarea>`.
- **Picture:** `<img>` at 64×64 rendering the contact's avatar. Own profile: `<input type='file'>` to upload a new photo.

Data source: `window.api.icq.getAvatar(jid)` → `PUSH_VCARD` event populates all fields. For own profile: `window.api.icq.getAvatar(ownJid)` then `window.api.icq.setVcard(fields)`.

Default size: `380 × 320 px`.

**10.2 — `src/components/UserInfoCard.css` (new file)**

Tabbed dialog styling using the ICQ 5 palette and `win98-raised` chrome. Tab strip uses `var(--icq-accent)` for the active tab underline.

**10.3 — `electron/main.js` (modify)**

Add `show-contact-context` IPC already registered but add `User Info...` item to the context menu that fires `open-user-info` channel with the JID.

**10.4 — `src/components/Sidebar.js` (modify)**

Right-click on an ICQ contact in the contact list → context menu includes `User Info...`, `Block`, `Alert When Online`. Wire all three to ICQ-specific handlers.

### Test Strategy — Phase 10

- Unit test: `UserInfoCard` renders all 5 tabs.
- Unit test: `UserInfoCard` in read-only mode does not show the save button.
- Playwright e2e: right-click a contact → `User Info...` → profile dialog opens → avatar image is visible.

---

## Phase 11 — Status System & Status Menu

**Goal:** The full ICQ status set (Online, FFC, Away, N/A, Occupied, DND, Offline) is selectable and reflected in the contact list.

### Steps

**11.1 — `src/components/StatusMenu.js` (new file)**

Floating popup anchored to the status button in the bottom bar. Items:

| Label | show value sent | Icon |
|---|---|---|
| Online | `(no show)` | `status_online.gif` |
| Free For Chat | `chat` | `status_ffc.gif` |
| Away | `away` | `status_away.gif` |
| N/A | `xa` | `status_na.gif` |
| Occupied | `occupied`* | `status_occupied.gif` |
| Do Not Disturb | `dnd` | `status_dnd.gif` |
| — separator — | | |
| Offline | `logout` | `status_offline.gif` |

*`occupied` is sent to `presence.js` which maps it to XMPP `dnd` + `<status>Occupied</status>`.

Each item fires `window.api.icq.setPresence(show, statusText)`. Clicking `Offline` fires `window.api.icq.disconnect()`.

**11.2 — Set Status Message dialog**

Below the status item list: `Set Status Message...` opens a small input dialog. Text is stored client-side and appended to every outgoing presence `<status>` element.

**11.3 — `src/components/Sidebar.js` (modify)**

Replace the current status dot in the user header with the `<img src={STATUS_ICON[icqShow]} />` icon. Add the status selector button at bottom-right. On click: toggle `<StatusMenu>`.

**11.4 — `src/App.js` (modify)**

Track `icqShow` (current XMPP show value) and `icqStatusText` in state. Update from `PUSH_CONNECTED` (default: `chat` = FFC) and from the StatusMenu selection.

**11.5 — Auto-away (idle detection, client-side)**

Add `electron/xmpp/idle.js` (new file). Uses `powerMonitor.on('lock-screen')` and `powerMonitor.on('user-did-become-active')` for macOS/Linux. On Windows, check idle time via `electron.powerMonitor.getSystemIdleTime()` on a 30 s interval:
- `idleSeconds > awayThreshold` (default 300 s) → send `<presence><show>away</show></presence>`.
- `idleSeconds > naThreshold` (default 1200 s) → send `<presence><show>xa</show></presence>`.
- On user activity after auto-away → restore previous manual status.

### Test Strategy — Phase 11

- Unit test: `StatusMenu` renders all 7 status options.
- Unit test: `presence.js` maps `occupied` show value to `dnd` + `<status>Occupied</status>`.
- Playwright e2e: click status button → StatusMenu opens → select `Away` → ICQ tab status dot changes to yellow.

---

## Phase 12 — Message Archive / History Browser

**Goal:** Users can browse and search local chat history in a dedicated window.

### Steps

**12.1 — `src/components/MessageArchive.js` (new file)**

Splitter layout (600×480 px). Left panel: contact list from current roster (click to load history). Right panel: chronological message log for selected contact. Bottom: text search input + date-from/to pickers. Toolbar: Export (save as `.txt`), Delete History buttons.

Data source:
1. Try `window.api.icq.getMessages(jid, {limit:100})` (MAM query).
2. Fall back to local TSV history via IPC `storage:get` → `history-tsv.readLast()`.

**12.2 — `electron/ipc/handlers.js` (modify)**

Add `ipcMain.handle('icq:get-history', async (e, {jid, query, dateFrom, dateTo}) => ...)` that calls `history-tsv.search()` filtered by date range and substring query.

**12.3 — History Search**

`history-tsv.search(dataDir, uin, domain, {query, dateFrom, dateTo, peerJid})`:
- Read the TSV file for `uin_domain`.
- Filter rows where `fullJid` matches `peerJid` (or all if null).
- Filter rows where timestamp is between `dateFrom` and `dateTo`.
- Filter rows where `body` contains `query` (case-insensitive).
- Return up to 500 matching rows.

**12.4 — Message Archive access**

Add `Message Archive` menu item to the ICQ main menu / right-click → open a new BrowserWindow at `mode=icq-archive` URL param. `src/index.js`: add `mode === 'icq-archive'` branch mounting `<MessageArchive>`.

### Test Strategy — Phase 12

- Unit test: `history-tsv.search` returns filtered results and correctly unescapes tab-in-body.
- Unit test: Date range filter excludes rows outside bounds.
- Playwright e2e: open Message Archive → select a contact that has history → messages appear in right panel.

---

## Phase 13 — Add/Find Contact Wizard

**Goal:** Users can add contacts by UIN and receive auth requests.

### Steps

**13.1 — `src/components/AddFindWizard.js` (new file)**

4-step wizard (420×380 px):
1. Search type selector: `By UIN` (primary, confirmed on icqr.net) | `By Username` | `Advanced`.
2. Input fields per type. UIN step: single numeric input.
3. Results list: columns `UIN | Nickname | Online`. Populated from XEP-0055 Jabber Search result.
4. Select contact → `Group` dropdown → `Add` button → sends `<presence type='subscribe'>`.

**13.2 — `electron/xmpp/search.js` (new file)**

`XMPP_SEARCH {type, query}`:
- Discover search service via `disco.getService('search')` or default `search.{domain}`.
- Send `<iq type='get'><query xmlns='jabber:iq:search'/></iq>` to get the search form.
- Submit form with the appropriate field (by UIN: `username` field = the UIN number).
- Parse `<item jid='...'><field var='username'><value>...</value></field>...</item>` results.
- Emit results as the IPC return value.

**13.3 — `electron/xmpp/roster.js` (modify)**

Add `XMPP_ROSTER_ADD {jid, name, group}`: send `<presence type='subscribe' to='{jid}'>`. Then send a roster set IQ to add the item with the given name and group.

**13.4 — Auth request handling**

When `roster.js` receives `<presence type='subscribe'>` from an unknown JID: emit `PUSH_PRESENCE {type:'subscribe', jid, from}`. Renderer shows a notification:

```
[UIN] wants to add you to their contact list.
[Add] [Decline] [Add & Authorize]
```

`Add & Authorize` → send `<presence type='subscribed'>` + roster add IQ.
`Decline` → send `<presence type='unsubscribed'>` with optional `<status>` reason text.

### Test Strategy — Phase 13

- Unit test: `search.js` handles empty results (zero `<item>` elements) without throwing.
- Playwright e2e: add second test UIN by UIN number → contact appears in roster → second client receives the subscription request → approves → first client's contact shows as online.

---

## Phase 14 — P0 Feature Completion Wave

**Goal:** All P0 features confirmed on icqr.net are implemented.

### Steps (each as a self-contained sub-task)

**14.1 — Offline Messages (XEP-0160)**

Already handled transparently via `PUSH_MESSAGE` with `isHistorical:true` set when `<delay>` stamp is present (from Phase 4). Add UI: on login, if historical messages arrive, show a brief "Receiving offline messages…" status in the contact list header. Clear it after 3 s.

**14.2 — Server-Driven Emoji Pack**

`electron/xmpp/emoji.js` (new file):
- On connect, fetch `https://icqr.net/emoji/manifest.json` (or equivalent endpoint; check `disco` for the server's emoji endpoint announcement).
- Compare `version` to locally cached version in `settings.get('global', 'emojiVersion')`.
- If newer: download all referenced PNG files to `{dataDir}/emoji/`. Write `manifest.json` locally.
- Emit `PUSH_EMOJI_MANIFEST {version, emoji:[]}` to renderer.
- Renderer `src/lib/emoji.js`: load the manifest and build a shortcode → PNG URL lookup table. Render emoji in message bodies by substituting shortcodes with `<img>` tags.

**14.3 — 'Uh-Oh' Sound**

`src/lib/sounds.js` (new file):

```js
const SOUNDS = {
  messageReceive: '/sounds/uh-oh.wav',
  contactOnline:  '/sounds/contact-online.wav',
  contactOffline: '/sounds/contact-offline.wav',
  messageSend:    '/sounds/message-send.wav',
};

export function playSound(key) {
  if (!soundEnabled) return;
  const audio = new Audio(SOUNDS[key]);
  audio.play().catch(() => {});
}
```

Place WAV files under `public/sounds/`. Hook `playSound('messageReceive')` on `icq:onMessage` in `App.js` (with `soundEnabled` prop check).

**14.4 — Tray Icon Flashing**

`electron/tray.js` (new file):
- Create `Tray` with `tray_icon_default.ico`.
- On `PUSH_MESSAGE` with `fromMe:false` and window not focused: alternate between `tray_icon_default.ico` and `tray_icon_message.ico` on a 500 ms interval.
- Stop flashing on `BrowserWindow` `focus` event.
- Tray right-click → context menu: `Open ICQ`, `Change Status →` (sub-menu), `Exit`.

**14.5 — Alert When Online (client-side)**

`presence.js` already emits `PUSH_PRESENCE {jid, alertFired:true}` when a watched JID comes online (Phase 4, step 4.2). Renderer in `App.js`:
- On `PUSH_PRESENCE {alertFired:true}`: play `contact-online.wav`, flash tray, show OS notification via `new Notification('Contact Online', {body: jid + ' is now online'})`.

Right-click a contact in the Sidebar → `Alert When Online` → calls `window.api.icq.watchPresence(jid)` → main process adds JID to `presence.js` watched set.

**14.6 — Auto-Reconnect**

Already handled by `@xmpp/reconnect` plugin baked into `@xmpp/client`. The `ping.js` module triggers manual disconnect on timeout, initiating the back-off cycle. Renderer shows `icqStatus = 'loading'` with a "Reconnecting…" sub-label during back-off.

**14.7 — Find by UIN**

Wire the `By UIN` search path in `AddFindWizard` (Phase 13, step 13.1). Confirmed on icqr.net. The JID lookup is: `<uin>@132.145.202.182`. A search result for a known UIN returns at minimum the JID; the display name comes from a subsequent vCard fetch.

### Test Strategy — Phase 14

- Unit test: `emoji.js` skips download if cached version ≥ server version.
- Unit test: `sounds.js` `playSound` does not throw when audio is unavailable (mock Audio constructor).
- Playwright e2e: receive an ICQ message while app is focused → "uh-oh" sound plays (check via Web Audio mock) → tray stops flashing when window is focused.

---

## Phase 15 — P1 Feature Wave

| Feature | Implementation Summary | File(s) |
|---|---|---|
| URL Messages (XEP-0066) | Detect `<x xmlns='jabber:x:oob'>` in incoming messages; render as hyperlink with description. Outgoing: add OOB `<x>` when body is a URL. | `messaging.js`, `ChatWindow.js` |
| Last Seen (XEP-0012) | On hover over offline contact → fetch via `window.api.icq.lastSeen(jid)` → show tooltip "Last seen: {date}". | `Sidebar.js`, `last-activity.js` |
| History Search UI | Wire the search input in `MessageArchive` to `icq:get-history` IPC. | `MessageArchive.js` |
| Block Contact (XEP-0191) | Right-click → Block → calls `blocking.js`. Show blocked contacts greyed-out with a lock icon. Sync blocklist on login. | `blocking.js`, `Sidebar.js` |
| Extended Away / NA | Already mapped in `presence.js` (`xa`). Add `N/A` option to `StatusMenu`. Completed in Phase 11. | — |
| Occupied status | Already mapped. Completed in Phase 11. | — |
| DND | Already mapped. Completed in Phase 11. | — |
| DPAPI / safeStorage credential storage | `credentials.js` already uses `safeStorage`. Wire `remember:true` from login panel to call `credentials.savePassword(uin, pw)`. On next launch, read with `credentials.loadPassword(uin)` and pre-fill or auto-login. | `credentials.js`, `settings.js`, `App.js` |
| Auth Denial with Reason | When declining a subscription: show a "Reason" text input before sending `<presence type='unsubscribed'><status>{reason}</status>`. | `AddFindWizard.js`, `roster.js` |
| 'You Were Added' Notification | Roster.js already emits `PUSH_PRESENCE {type:'subscribe'}`. Render a notification card in App.js above the contact list. | `App.js` |
| Admin Broadcasts (MOTD) | Messages arriving from the bare domain JID (`132.145.202.182`) are treated as system messages. Show in a dedicated "System Messages" group at the top of the contact list. | `messaging.js`, `Sidebar.js` |
| Sound Schemes | Add settings panel row: per-event sound file path pickers. Persist in `settings.ini`. Load custom WAV paths in `sounds.js`. | `Preferences.js`, `sounds.js` |
| Auto-Away idle detection | `idle.js` wired in Phase 11. Test thresholds in Preferences. | `Preferences.js` |
| Server-driven emoji | Completed in Phase 14.2. | — |

### Test Strategy — Phase 15

- Unit test: `messaging.js` parses XEP-0066 OOB `<x>` and sets `type:'url'` on the message.
- Unit test: `blocking.js` falls back to XEP-0016 when disco lacks `urn:xmpp:blocking`.
- Playwright e2e: block a contact → send message → main process confirms message was not sent (IQ block active).

---

## Phase 16 — P2 Feature Wave

| Feature | Implementation Summary |
|---|---|
| ICQ 5 Authentic skin polish | Pixel-compare contact list against reference screenshot. Tune group header indent (4px), contact indent (20px), status icon size (16×16), bottom bar height (22px), filter tab height (22px). |
| Quote / Reply | Right-click a message → `Quote` → insert `> {selectedText}\n` into compose area. XEP-0461 optional; classic `>` quoting works without it. |
| vCard Interests / Hobbies | Add `Interests` text area in `UserInfoCard` More tab. Store in `vCard <DESC>` if no XEP-0054 field is available. |
| vCard Affiliations / Work | `Work` tab in `UserInfoCard` maps to `<ORG>`, `<TITLE>`, `<TEL>`. Already parsed in `vcard.js`. |
| Birthday Reminders | On roster load, fetch vCards (rate-limited) for contacts with `<BDAY>`. On each app start, check if any contact's `BDAY` matches today (month/day). Show birthday cake icon in contact list. Play `birthday.wav`. |
| Send Contacts (vCard refs) | Right-click → `Send Contact` → compose a message body containing `vcard:{jid}:{name}` shortcode. Receiver client parses it and offers `Add to Contacts`. |
| Message Carbons (XEP-0280) | `carbons.js` already handles this (Phase 4). UI: carbon messages from own JID appear in the chat log with `fromMe:true`. |
| XEP-0313 MAM | `mam.js` already handles this (Phase 5). Wire `Load Earlier Messages` button in chat window that triggers `XMPP_MAM_QUERY`. |
| Spell Check | Rely on the browser/OS spell check via `contenteditable` `spellcheck='true'` attribute on the compose area. No dictionary bundle needed on Electron's Chromium engine. |
| Simple / Advanced Mode toggle | Add a `simpleMode` boolean to app settings. In simple mode: hide skin picker, archive, preferences tree. Toggle in Preferences or via a menu item. |
| Floating Contacts | Small always-on-top `BrowserWindow` (200×400, `alwaysOnTop:true`) with a pinned contact subset. Contacts pinned via right-click → `Pin to Float Bar`. |
| Multiple Accounts | Settings UI: `Add ICQ Account` saves a second credential entry in `settings.ini` under a different section. On switch: call `disconnect()` then `connect()` with the new credentials. |
| ICQ Lite mode | A build flag `ICQ_LITE=1` that omits WA/TG tabs, Xtraz panel, and advanced preferences from the webpack bundle. Not a runtime toggle — a separate production build target. |

### Test Strategy — Phase 16

- Unit test: Birthday check logic correctly identifies today's birthdays regardless of year in `BDAY` field.
- Unit test: Quote insertion prepends `>` to each line of selected text.
- Playwright e2e: enable Simple Mode → skin picker hidden → disable → skin picker visible.

---

## Phase 17 — WhatsApp & Telegram as Extra Accounts

**Goal:** WA and TG bridges are optional add-ons, not loaded at startup. ICQ is the primary account.

### Steps

**17.1 — `electron/main.js` (modify)**

Move WA and TG bridge `init()` calls out of `app:ready` and into lazy-load handlers:

```js
ipcMain.handle('wa:lazy-init', async () => {
  if (!whatsappBridge._initialized) {
    await whatsappBridge.init(onAvatarCb, dataDir);
    whatsappBridge._initialized = true;
  }
  return { ok: true };
});

ipcMain.handle('tg:lazy-init', async () => {
  if (!telegramBridge._initialized) {
    await telegramBridge.init(onAvatarCb, dataDir);
    telegramBridge._initialized = true;
  }
  return { ok: true };
});
```

**17.2 — `src/components/Sidebar.js` (modify)**

Service tab order: ICQ (first, selected by default) | WhatsApp | Telegram. When user clicks WA or TG tab for the first time: call `window.api.wa.lazyInit()` / `window.api.tg.lazyInit()` before showing the QR/login panel. Show a "Starting WhatsApp…" spinner during the 30–180 s Chromium startup.

**17.3 — `src/App.js` (modify)**

Extend `activeService` enum to `'icq' | 'whatsapp' | 'telegram'` (ICQ listed first). The default on first load is `'icq'`.

**17.4 — `electron/preload.js` (modify)**

Add `wa.lazyInit: () => ipcRenderer.invoke('wa:lazy-init')` and `tg.lazyInit: () => ipcRenderer.invoke('tg:lazy-init')`.

**17.5 — Credential security parity**

Add a security parity note: TG session string is stored as plaintext (`telegram-credentials.json`). This is a known risk (noted in codebase analysis). File a deferred task: migrate TG session to `safeStorage` in the same manner as ICQ password. Do not block Phase 17 delivery on this — it is a pre-existing issue in the fork baseline.

### Test Strategy — Phase 17

- Playwright e2e: launch app → ICQ tab selected by default → no Chrome process started → click WA tab → Chrome starts → WA QR code renders.
- Unit test: `wa:lazy-init` handler is idempotent (calling twice does not call `whatsappBridge.init` a second time).

---

## Phase 18 — Preferences Dialog

**Goal:** A functional ICQ-5-style preferences dialog covering all relevant settings.

### Steps

**18.1 — `src/components/Preferences.js` (new file)**

Two-panel layout (580×480 px). Left: settings category tree. Right: context-sensitive panel.

Categories and their settings:

| Category | Settings |
|---|---|
| General | Language (locale selector), Startup (auto-login checkbox, minimize to tray on close) |
| Connection | Server (read-only: 132.145.202.182:5222), Auto-reconnect toggle, Reconnect delay |
| Status | Custom status messages per status (Away, N/A, DND, FFC, Occupied); Auto-away threshold (minutes); Auto-NA threshold |
| Sounds | Enable/disable sounds; per-event sound file picker (file browser opening to `public/sounds/`); test button |
| Appearance | Skin picker (thumbnail grid from `SKINS[]`); Contact list font size slider (0.85–1.45 scale); Contact row density (compact/normal) |
| Privacy | Block list (read from `PUSH_BLOCKLIST`); Unblock button per entry |
| Contact List | Show offline contacts toggle; Show groups toggle; Show status text toggle |
| Chat | Enter key sends message toggle; Auto-emoji (convert `:)` to emoji images) |
| History | History location (read-only `dataDir` path); Clear history button per contact or all |

**18.2 — Settings persistence**

Each preference is stored via `storage:set {key, value}` IPC → `settings.js` → `settings.ini`. On launch: `storage:get {key}` restores all preferences.

**18.3 — `electron/ipc/handlers.js` (modify)**

```js
ipcMain.handle(CH.STORAGE_GET, async (e, {key}) => settings.get('preferences', key));
ipcMain.handle(CH.STORAGE_SET, async (e, {key, value}) => { settings.set('preferences', key, value); return {ok:true}; });
```

**18.4 — Access point**

Bottom bar `Preferences` button in `Sidebar.js` opens Preferences in a new modal `BrowserWindow` (`mode=preferences` URL param).

### Test Strategy — Phase 18

- Unit test: `Preferences` renders all category labels.
- Playwright e2e: open Preferences → change skin → contact list background color changes immediately.

---

## Phase 19 — System Tray Menu & Notifications

**Goal:** Full system tray menu matching the ICQ 5 SysTray spec.

### Steps

**19.1 — `electron/tray.js` (expand from Phase 14.4)**

Right-click context menu:

```
Open ICQ
Send Message…
Add Contact…
My Profile
Status ▶  [ submenu: Online / FFC / Away / N/A / Occupied / DND / Offline ]
Preferences
About ICQReborn
——————
Exit
```

`Send Message…` → open a simplified modal (not a full chat window) with a UIN input and a message textarea. Dispatches `XMPP_SEND_MESSAGE`. This is the classic ICQ "Send Message to Offline/Online Contact" dialog mapped to the Electron tray flow.

`Add Contact…` → fires `open-add-find-wizard` IPC.

`My Profile` → fires `open-user-info {jid: ownJid, editable: true}`.

`About ICQReborn` → small dialog showing app version, XMPP server, connected UIN.

`Exit` → `app.quit()`.

**19.2 — Double-click tray → restore/show contact list window.**

**19.3 — `electron/main.js` (modify)**

Import and initialize `tray.js` in `app.on('ready')`. Pass `emit` and `getMainWindow` references.

### Test Strategy — Phase 19

- Unit test: tray menu array contains exactly the 9 items listed in the spec.
- Playwright e2e: right-click tray icon → `Status` submenu → select `Away` → contact list status dot changes to yellow.

---

## Phase 20 — Final Polish & Release Hardening

### Steps

**20.1 — Log redaction**

Production logger (`electron/lib/logger.js`, new file): intercepts all `console.log` calls and stanza events. Replaces text content of any stanza with `name === 'auth'` or `name === 'response'` within `urn:ietf:params:xml:ns:xmpp-sasl` with `[REDACTED]`. Ensure no `password` key from any IPC payload appears in log output.

**20.2 — CSP header**

In `electron/main.js`, add to `BrowserWindow` `webPreferences`:

```js
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  preload: path.join(__dirname, 'preload.js'),
},
```

Add `session.defaultSession.webRequest.onHeadersReceived` to inject:

```
Content-Security-Policy: default-src 'self' https://132.145.202.182 data: blob:;
                         script-src 'self'; img-src 'self' data: blob: https:;
```

Allow `https:` for image sources (XEP-0363 CDN URLs), block all inline scripts.

**20.3 — `@xmpp/debug` gate**

In `electron/xmpp/client.js`:

```js
if (process.env.NODE_ENV !== 'production') {
  const { default: debug } = await import('@xmpp/debug');
  debug(entity, true);
}
```

Never enable `@xmpp/debug` in production builds. Add `NODE_ENV=production` to the electron-builder config.

**20.4 — Path traversal hardening audit**

Scan all file writes in `vcard.js`, `history-tsv.js`, `upload.js`. Every path component derived from external data (JID, sha1, filename) must be sanitized:
- sha1: `sha1.replace(/[^0-9a-f]/gi, '')` before use as filename.
- Uploaded filenames: `path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')`.
- JID in history filename: use `${uin}_${domain}` where both are validated (UIN = digits only, domain = known constant `132.145.202.182`).

**20.5 — KNOWN_INSECURE_SERVERS constant audit**

Ensure `KNOWN_INSECURE_SERVERS` in `client.js` is used consistently in both the main process guard and the renderer warning trigger. The constant must not be configurable by the user (it is a factual server capability, not a preference).

**20.6 — Electron builder config**

`electron-builder.yml` (new file): configure for Windows (NSIS installer + portable), asar-packed. `appId: net.icqr.iseeku`. Include `public/`, `electron/`, `src/`. Exclude `electron/__mocks__/`, `*.test.js`, `node_modules/@xmpp/debug` (only in prod build).

**20.7 — Coverage threshold enforcement**

In `jest.config.js`:

```js
coverageThreshold: {
  global: { lines: 80, functions: 80, branches: 75 }
}
```

Run `npm test -- --coverage` in CI. Fail the build if thresholds are not met.

**20.8 — End-to-end regression suite**

Final Playwright suite covering the critical path:
1. Register a new UIN (live icqr.net, skipped on CI).
2. Log in with an existing UIN.
3. Accept insecure-warning modal.
4. Roster loads within 10 s.
5. Send a message to a second test UIN.
6. Receive a message from the second test UIN.
7. Message archive shows the conversation.
8. Block and unblock the second test UIN.
9. Change status to Away; second client sees Away icon.
10. Log out; second client sees Offline icon.

---

## Plaintext-PLAIN / No-TLS Surfaces — Complete Inventory

Every location where the user must be informed of the unencrypted nature of the icqr.net connection:

| # | Where | What the user sees |
|---|---|---|
| 1 | `InsecureWarningModal` in `LoginPanel.js` | Blocking modal before every session: "This server does not support encryption. Your password will be sent in plain text." Two buttons: `Connect Anyway` / `Cancel`. No "do not show again". |
| 2 | Connection status label in `IcqPanel` during login | Small red label: "⚠ Unencrypted connection" displayed alongside "Connecting…" status. |
| 3 | Preferences → Connection panel | Read-only field "Encryption: None (server does not support TLS)". |
| 4 | `About ICQReborn` dialog | "Server: 132.145.202.182:5222 (plain TCP, no encryption)". |
| 5 | `electron/xmpp/client.js` code comment | "SASL PLAIN over plain TCP to 132.145.202.182 is equivalent to sending credentials in the clear. This is a server limitation, not a client choice. See InsecureServerError guard and the blocking modal in LoginPanel." |
| 6 | `electron/xmpp/auth.js` code comment | "The password reaches @xmpp/client as a plaintext string. It is passed to the SASL PLAIN mechanism which base64-encodes it (not encrypted). On an unmonitored trusted LAN this is acceptable; on any public network it is not." |
| 7 | `README.md` (update existing) | Add a Security section noting the plaintext-PLAIN reality, that credentials are stored encrypted via safeStorage, and that the wire transmission is unencrypted. |

---

## Dependency Version Pinning Summary

```
Production (Electron main process):
  @xmpp/client          0.14.0
  @xmpp/xml             0.14.0
  ini                   4.1.3
  node-fetch            3.3.2   (for emoji manifest + avatar fallback HTTP GET)

Development only:
  @xmpp/debug           0.14.0
  @testing-library/jest-dom    6.4.2
  @testing-library/react       15.0.7
  @testing-library/user-event  14.5.2

Explicitly excluded:
  stanza                (WebSocket/BOSH only, no raw TCP)
  node-xmpp-client      (unmaintained 8 years)
  @xmpp/sasl2           (SASL2 draft, server does not offer it)
  ltx                   (do not add as top-level dep; use via @xmpp/xml re-export)
```

All existing dependencies (`electron`, `react`, `whatsapp-web.js`, `telegram`, etc.) are unchanged.

---

## Phase Dependency Graph

```
Phase 0  (tooling)
  └─ Phase 1  (storage)
       └─ Phase 2  (xmpp client core)
            └─ Phase 3  (registration)
                 └─ Phase 4  (roster + messaging)
                      └─ Phase 5  (vcard + upload + mam)
                           └─ Phase 6  (Electron wiring)
                                ├─ Phase 7  (ICQ 5 shell)
                                │    └─ Phase 8  (login UI)
                                │         └─ Phase 9  (chat window)
                                │              └─ Phase 10 (user info card)
                                │                   └─ Phase 11 (status system)
                                │                        └─ Phase 12 (message archive)
                                │                             └─ Phase 13 (add/find wizard)
                                │                                  └─ Phase 14 (P0 features)
                                │                                       └─ Phase 15 (P1 features)
                                │                                            └─ Phase 16 (P2 features)
                                └─ Phase 17 (WA/TG lazy-load)
                                     └─ Phase 18 (Preferences)
                                          └─ Phase 19 (Tray menu)
                                               └─ Phase 20 (hardening + release)
```

Each phase ends with a runnable/testable artifact:

- **Phase 0:** `npm test` passes, tooling configured.
- **Phase 1:** `npm run test:main` covers credential round-trip.
- **Phase 2:** XMPP client rejects insecure connections in tests.
- **Phase 3:** Registration IQ flow tested against mocks; live smoke test available.
- **Phase 4:** Messages can be sent/received in a Node REPL against live icqr.net.
- **Phase 5:** vCard avatars appear in tests; upload slot IPC round-trips.
- **Phase 6:** Electron app launches; ICQ tab renders in Sidebar.
- **Phase 7:** Contact list matches ICQ 5 visual spec (Playwright screenshot).
- **Phase 8:** Login form accepts UIN + password; warning modal fires.
- **Phase 9:** Full chat flow testable end-to-end via Playwright.
- **Phase 10–19:** Individually testable features built on stable prior phases.
- **Phase 20:** Build passes all coverage gates; installer produced.