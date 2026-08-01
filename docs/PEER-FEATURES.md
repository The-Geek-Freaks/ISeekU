# ISeekU — ISeekU-to-ISeekU Feature Architecture

## Do we need a second protocol?

No. You do not need a separate protocol stack for ISeekU-to-ISeekU communication.

The framing of "a different protocol when the other side is also ISeekU" is intuitive but solves the wrong problem. The actual requirement is: detect that the peer is running ISeekU, then unlock a richer set of behaviours for that specific conversation. XMPP was designed for exactly this pattern — it has a built-in capability advertisement and feature negotiation layer (XEP-0115 + XEP-0030) that every XMPP client already handles. You attach your extensions as additional namespaces on top of the same XMPP session, not alongside it.

Running a second protocol means: a second connection, a second authentication system, a second reconnect and error path, NAT traversal for the control channel as well as the data channel, and no fallback when the second stack fails. You get none of those costs with the extension approach.

**Recommendation: one XMPP stack, extended.** The icqr.net server acts as a dumb stanza router and requires zero cooperation with any of this. Every feature described below is purely client-to-client.

---

## 1. How Two ISeekU Clients Find Each Other

### The mechanism

XEP-0115 (Entity Capabilities) is the right tool. Every presence stanza ISeekU sends already exists in `setStatus()`. You add one child element:

```xml
<c xmlns="http://jabber.org/protocol/caps"
   hash="sha-1"
   node="https://github.com/The-Geek-Freaks/ISeekU"
   ver="BASE64_HASH_OF_FEATURE_LIST"/>
```

The `ver` hash is computed once at startup from the sorted feature list (identity + feature namespaces, concatenated with `<` separators including a trailing `<`, SHA-1, base64). It is a constant for a given release.

When a peer receives your presence and sees an unknown `ver`, they send one disco#info IQ to your full JID, cache the result keyed by `(hash-algo, ver)`, and never ask again. In the common case — a contact who already saw you last session — the feature check costs zero round-trips.

You also need to handle the incoming disco#info query. Currently `onStanza()` processes `message` and `presence`. Add an IQ handler: when a `get` arrives containing `<query xmlns="http://jabber.org/protocol/disco#info">`, reply with your identity and the complete feature list. The hash computed at startup and the feature list returned here must be identical — any divergence causes peers to discard your caps silently.

### The namespace scheme

```
urn:iseeku:core:1         — mandatory marker; this JID runs ISeekU
urn:iseeku:p2p-file:1     — WebRTC data channel file transfer
urn:iseeku:secret-chat:1  — X25519+ChaCha20 encrypted message session
urn:iseeku:avatar-sync:1  — avatar exchange between ISeekU clients
```

Standard XEP namespaces that must also appear in the feature list (and therefore in the hash):

```
http://jabber.org/protocol/caps
http://jabber.org/protocol/disco#info
http://jabber.org/protocol/disco#items
http://jabber.org/protocol/chatstates
urn:xmpp:receipts
jabber:iq:version
jabber:iq:last
```

### The peer-caps store

In `onPresence()`, when a contact comes online:

1. Parse the `<c>` element. Look up `sha-1:VER` in an in-memory `Map<string, Set<string>>`.
2. **Cache hit:** immediately call `checkPeerCaps(bareJid, resource, featureSet)`.
3. **Cache miss:** send a disco#info IQ to the full JID with the caps node appended. On result, recompute the hash over what was returned. If it matches `ver`, cache and proceed. If it does not match, log it and treat the peer as featureless — do not cache a bad entry.

`checkPeerCaps` writes into a `Map<fullJid, CapabilityRecord>` and emits a `peer-caps` event. The UI reads from this map to decide which buttons to show.

### Version degradation

A contact running ICQ Reborn or any other XMPP client will never advertise `urn:iseeku:core:1`. Nothing changes for that conversation. The p2p-file button does not appear. No error, no prompt. They get plain XMPP exactly as today.

An older ISeekU that predates `urn:iseeku:p2p-file:1` simply will not have that feature in the negotiated set. The newer client offers it; the older client does not have it; the button does not appear. You never remove or rename existing namespaces — only add new ones.

### The hash computation pitfall

Get this wrong and ISeekU-to-ISeekU features silently never activate. The XEP-0115 §5 algorithm is exact: sort identities by `category/type/xml:lang/name` in binary order (not locale-sensitive), sort features by `var` in binary order, concatenate with `<` between each item and a trailing `<`, SHA-1 the UTF-8 bytes, base64-encode. Test against the XEP-0115 published test vectors before shipping. Keep one authoritative `ISEEKU_FEATURES` array constant used by both the hash computation and the IQ reply handler.

---

## 2. File Transfer

### Primary: WebRTC data channels

**Library:** `node-datachannel@0.32.3` in the Electron main process. It binds to `libdatachannel` (C++) and targets N-API version 8, which is ABI-stable across Node 12.22+ and Electron 10+. This means routine Electron upgrades do not require rebuilding or a new prebuilt — the N-API stability guarantee was invented specifically to avoid this problem. The `.node` file must be unpacked from the ASAR (already configured in `package.json` for `**/*.node`).

**Signalling:** custom IQ stanzas over the existing `@xmpp/client` session. No second connection, no second server.

**Flow:**
1. Alice clicks "Send File." Her client sends an `<iq type="set">` to Bob's full JID with a `<file-offer xmlns="urn:iseeku:p2p-file:1">` stanza containing: filename, byte size, MIME type, SHA-256 of the complete file.
2. Bob's client shows an accept/decline prompt. On accept, an `<iq type="result">` goes back.
3. Both sides create an `RTCPeerConnection`-equivalent via `node-datachannel`. Alice creates an offer (SDP), sends it in an IQ stanza. Bob answers. ICE candidates are exchanged as IQ stanzas as they are gathered.
4. Once the data channel opens, Alice reads the file in 64 KB chunks and sends them. Backpressure: when `bufferedAmount` exceeds a configured threshold, pause reads until the channel drains. Verify the specific event name and polling behaviour in `node-datachannel`'s API before writing this loop — the library targets browser API compatibility but is a C++ binding; per-property fidelity should be confirmed against its actual documentation, not assumed.
5. Bob streams received chunks to disk. On completion, compute SHA-256 over the written file and compare to the hash in the offer stanza. Surface the save dialog only after the hash validates.

**The SHA-256 hash of the complete file must not be computed as a blocking pass in the Node.js main process after reception.** Hashing a 4 GB file synchronously blocks all IPC to renderer windows for approximately 20 seconds on a mid-range machine. Use a streaming hash computed alongside the receive loop (`crypto.createHash('sha256')` updated per chunk) so hashing costs nothing at completion time.

### What "no size limit" actually means

There is no protocol-imposed size limit. Whether the transfer is genuinely peer-to-peer depends on the network path:

| Scenario | What happens |
|---|---|
| Both clients on same LAN | Direct TCP via ICE. Genuinely peer-to-peer. Speed is LAN speed. |
| Different home ISPs, neither behind symmetric NAT | STUN finds a direct path. ~70% of such pairs succeed this way, though this figure is an estimate — real deployment data for 2024+ residential networks varies, and mobile tethering users have near-zero direct STUN success due to carrier-grade NAT. |
| Symmetric NAT (carrier NAT, many ISPs, mobile, corporate) | STUN fails. TURN relay is required. The bytes go through the relay server but are DTLS-encrypted end-to-end — the relay cannot read the content. |
| No TURN configured | ICE fails after a configurable timeout (~30 seconds). Offer fallback to IBB. |

**If no TURN server is available, a meaningful fraction of user pairs will fail.** "No size limit, peer-to-peer file transfer" is accurate for the majority path. For users behind symmetric NAT without TURN it is "no file transfer." This needs a visible fallback, not a silent timeout.

### TURN: cost and ownership (this is an open question — see §7)

A self-hosted `coturn` instance on any €5/month VPS handles TURN relay with DTLS-encrypted data. The relay sees ciphertext only. The Google free STUN server (`stun.l.google.com:19302`) covers the non-TURN path but has no SLA and has had outages; a self-hosted STUN endpoint or at least a secondary public STUN server should also be configured.

Cloudflare Calls offers TURN as a service. Before relying on any published pricing figure for cost estimates, verify the current pricing structure at cloudflare.com/products/calls — the unit of billing (per-minute of relayed session vs per-GB transferred) matters significantly for file transfer workloads.

STUN servers to configure as a baseline (free, no auth, no SLA):

```
stun.l.google.com:19302
stun1.l.google.com:19302
stun.nextcloud.com:443
```

### Fallback chain

```
1. WebRTC direct (STUN only)      — truly peer-to-peer, no size limit
2. WebRTC relayed (TURN)          — DTLS-encrypted through relay, no size limit
3. XEP-0047 In-Band Bytestreams   — everything through the XMPP server,
                                     unencrypted, usable only for small files
```

IBB (XEP-0047) is implemented directly on `@xmpp/client` (~150 lines). The block size is configurable up to 65535 bytes; the practical ceiling is the server's configured max stanza size minus XML framing, not a fixed 4 KB. Use 32768-byte blocks as a conservative default. At that block size, a 10 MB file takes ~300 stanzas. IBB is acceptable for profile pictures and small attachments. It is not acceptable for anything the user calls a "file transfer" — cap the IBB offer at 5 MB with a visible warning that the file will route through the server in cleartext.

**When IBB is active, the UI must say so.** Something like: "This file is being sent through the server. The server can see it. For peer-to-peer transfer, both users need a working internet connection without strict NAT." This is not optional fine print; it is the difference between a misleading and an honest product.

---

## 3. Encryption

### What is achievable on this server

The fundamental constraint: every XMPP session to `132.145.202.182:5222` uses SASL PLAIN over cleartext TCP. The password is base64(`\0username\0password`) which anyone with a packet capture at login time can decode in two seconds. This is upstream of any message encryption scheme. **No message encryption of any kind makes the account secure.** Anyone who captured a login can authenticate as the user. The server operator sees every login and every stanza.

OMEMO is blocked. It requires PEP (XEP-0163 PubSub), which this server does not advertise. This is not a client-side engineering problem — it requires the server operator to enable a server component. It is not buildable without that.

### The buildable option: custom X25519 + ChaCha20-Poly1305

**Libraries:** `@stablelib/x25519`, `@stablelib/chacha20poly1305`, `@stablelib/ed25519`, `@stablelib/random` — all pure TypeScript/JS, MIT licensed, no native modules, confirmed on npm. The 2.0.x series versions and their changelogs should be reviewed before use; the 1.x-to-2.x migration notes are relevant.

**Wire protocol:**

1. Alice opens a Secret Chat with Bob. She generates an ephemeral X25519 keypair and sends the public key in a custom message extension: `<key-offer xmlns="urn:iseeku:secret-chat:1">`.
2. Bob generates his ephemeral keypair, sends his public key back.
3. Both derive the shared secret: `X25519(myPrivate, peerPublic)`. Run it through HKDF to produce the initial message key.
4. Each message uses ChaCha20-Poly1305 with a fresh key derived via one HKDF step from the previous key (simple symmetric ratchet). The ciphertext is carried inside the `<body>` element with a standard plaintext fallback for non-ISeekU clients.
5. Long-term identity key: each device generates one `ed25519` keypair, stored via `safeStorage`. The public key is exchanged alongside the ephemeral key and pinned on first contact (TOFU).

**The TOFU MitM problem — this must be stated in the UI, not just in documentation.**

TOFU (trust on first use) on a cleartext server has a specific failure mode that is worse than "the first exchange might be intercepted." If a server-side attacker intercepts the first key exchange and substitutes their own keys, **the attacker's keys become the pinned identity on both sides.** From that point, TOFU defends the attacker's position: any subsequent honest key exchange from either real party will trigger a "key changed" warning that looks like an attack. The attacker's compromise is self-perpetuating.

The only remedy is out-of-band fingerprint comparison before or at the moment of first contact. The UI must make this visible and easy, not buried in settings.

**What the interface may say:**

> "Secret Chat is active. Message content is encrypted between your device and [contact's name]'s device. A passive observer on the network who was not watching when you signed in cannot read these messages."

**What the interface must not say:**

- "Your account is secure"
- "Your connection is protected"
- "ISeekU encrypts your conversations" (without immediate qualification)
- Anything that implies the server, the credentials, or the metadata are safe

**What must appear alongside any encryption claim:**

> "Your sign-in password is sent unencrypted every time you connect. Anyone who observed your sign-in can access your account. The server can see who you are talking to and when. Secret Chat protects only message content, and only against someone who did not see your sign-in."

This wording is not optional. Claiming encryption on a SASL PLAIN cleartext server without this context is actively misleading.

### WebRTC for file transfer: the SDP integrity problem

DTLS is mandatory in WebRTC and provides automatic encryption — but only if the SDP fingerprint attribute is integrity-protected. RFC 8827 §5 explicitly requires this. Over cleartext XMPP, the SDP is not integrity-protected. An active attacker on the network path can substitute their own DTLS fingerprint in the signalling stanzas and perform a full DTLS-level MitM, terminating both sessions transparently. DTLS is then bypassed entirely despite being "mandatory."

For file transfer, this attack requires an active network attacker who can modify in-flight XMPP stanzas in real time — more capable than a passive eavesdropper. For most users under most conditions, DTLS provides meaningful protection. But it is not end-to-end encrypted in the cryptographic sense against an active attacker, and the UI should not claim it is.

---

## 4. Other "Everything the Original Could Do" Features — Ranked

### Worth building

**Voice messages** — record a short audio clip, send it as a file via the p2p-file channel. Receiver plays it inline. Requires the p2p-file layer to exist. Add a record button per conversation when `urn:iseeku:p2p-file:1` is present. Low additional effort once file transfer works.

**Avatar sync** — full-resolution avatar exchange between ISeekU clients, not the 96x96 limit imposed by the server. Send a small JPEG/PNG via the p2p-file channel on avatar change. Display it locally only for ISeekU peers; use the roster avatar for everyone else. Requires the file channel. Low effort.

**Read receipts with timestamp** — XEP-0184 delivery receipts are already implemented. Between two ISeekU clients, extend this with a second receipt stanza carrying the actual read timestamp (when the user focused the conversation window), not just delivery. This is a small extension on top of existing work.

**Online-only group chats** — a basic ephemeral room where two or more ISeekU clients connect via the existing MUC support but with a custom namespace indicating ISeekU features are available. Real-time, no history. The p2p mesh for group file transfer is complex; defer that.

**Invisible status that actually works** — ICQ's "invisible to specific contacts" was per-contact presence filtering. In XMPP this requires the server to support privacy lists (XEP-0016) or blocking (XEP-0191). Measure whether `132.145.202.182` supports either before committing to it. If the server does not support it, invisible is server-wide and already implemented.

### Low priority — builds nostalgia but limited use

**"User is typing a message" sounds** — already covered by XEP-0085 which is implemented. The retro ICQ "uh-oh" sound on message receive is a one-line audio play call. Worth doing as a theme option, not as an engineering item.

**Animated emoticons and custom emoji packs** — the theme system is already JSON-based. Adding an emoji pack format is straightforward. Medium effort, medium user value.

**Contact notes / "about me" text** — XMPP vCard (XEP-0054 / XEP-0292) is the standard mechanism. The server may or may not support vCard storage. If it does, this is two IQ queries. If it does not, store locally only for ISeekU contacts using the p2p-file channel for exchange.

### Skip — nostalgia that nobody will use

**ICQ games (Tic-Tac-Toe, Reversi)** — these required the server to support a game protocol module. Re-implementing them client-side for two ISeekU clients is possible but the user population for text-based IM games in 2026 is negligible. The engineering effort is not zero.

**ICQ Greetings / e-cards** — an image-send via the file channel covers this. A distinct "greetings" flow is wrapper UX around something already built.

**SMS forwarding** — was server-side infrastructure in ICQ's case. Would require a separate gateway service. Out of scope.

---

## 5. Build Order and Effort

All estimates assume one developer who already knows the codebase. They exclude testing time unless stated. "Lines" are rough — the adversarial review of earlier estimates noted that happy-path line counts reliably undercount production-quality work by 2-3x once state management, error recovery, and UI are included.

| Step | What | Effort |
|---|---|---|
| 1 | Capability discovery infrastructure: caps hash computation, `<c>` element in `setStatus()`, disco#info IQ handler, caps cache and `peer-caps` event | 2–3 days |
| 2 | XEP-0092 version query responder (makes ISeekU visible to other XMPP clients as a named client, not "unknown") | 0.5 days |
| 3 | p2p-file signalling protocol: offer/answer IQ stanzas, ICE candidate exchange, accept/decline UI | 3–4 days |
| 4 | WebRTC data channel file transfer: `node-datachannel` integration, chunked sender with streaming backpressure, disk-streaming receiver, streaming SHA-256, progress IPC | 5–7 days |
| 5 | XEP-0047 IBB fallback: stanza handler, block-size configuration, 5 MB cap, cleartext disclosure UI | 2 days |
| 6 | ICE timeout and fallback offer UI: 30-second hard timeout, visible "connection failed, retry via server?" prompt | 1 day |
| 7 | Secret Chat: key generation, X25519 handshake stanzas, ChaCha20-Poly1305 encrypt/decrypt, HKDF ratchet, `safeStorage` identity key store | 4–5 days |
| 8 | Secret Chat UI: session indicator, fingerprint display, out-of-band comparison flow, key-change warning | 2–3 days |
| 9 | Voice messages: record button (MediaRecorder in renderer, IPC to main), send via file channel, inline player | 2 days |
| 10 | Avatar sync: send on change via file channel, display full-resolution for ISeekU peers | 1–2 days |
| 11 | Read receipts with timestamp: extension on XEP-0184, timestamp in second stanza | 1 day |

**Total:** approximately 8–10 weeks for steps 1–8. Steps 9–11 are straightforward once file transfer and discovery work.

---

## 6. What We Deliberately Do Not Build

**OMEMO.** The server does not support PEP. This is not a client-side fix. Any implementation would be a dead implementation.

**Jingle file transfer (XEP-0234).** No maintained Node.js library integrates with `@xmpp/client`. The existing Jingle npm packages (`jingle@3.0.3`, `jingle-filetransfer-session@2.0.2`) last published in 2017 and break on Node 18+. Migrating to `stanza` to get Jingle support breaks the entire existing connection stack. WebRTC gives better NAT traversal and DTLS encryption; Jingle SOCKS5 gives neither.

**libp2p.** A complete parallel networking stack for one feature is disproportionate. The existing XMPP session handles signalling adequately.

**A second signalling server or relay protocol.** Everything runs over the existing XMPP session. Adding a second control channel doubles the reconnect, authentication, and error surface.

**OpenPGP (XEP-0373 OX).** Requires PubSub (same blocker as OMEMO). XEP-0027 inline PGP avoids the server requirement but has no forward secrecy — a single key compromise decrypts the entire conversation history. For ISeekU-to-ISeekU only, the custom ECDH scheme is strictly better on every dimension.

Note on `openpgp` npm package specifically: it is licensed LGPL-3.0+, not Apache-2.0 or MIT. Bundling an LGPL library into an ASAR archive that users cannot replace is a grey-area LGPL compliance issue for an MIT-licensed app. Avoid it regardless of the PGP decision.

**ICQ games.** User population for this is negligible. Engineering effort is not zero. Skip.

---

## 7. Open Questions That Need Your Decision

These are not code decisions. They are commitments with ongoing cost and responsibility.

**1. Who runs the TURN server, and how is it funded?**

Without TURN, approximately 20–30% of file transfers between users on different ISPs will silently fail at ICE (this estimate is directionally correct but empirically uncertain for 2024+ residential networks; mobile users and corporate users will have higher failure rates). Options:

- **Self-hosted `coturn`** on a VPS (~€5/month). You control the data. DTLS-encrypted bytes in, DTLS-encrypted bytes out — you cannot read the content. Bandwidth cost depends on transfer volume.
- **Cloudflare Calls TURN** or similar commercial service. Verify the current pricing structure (per-minute vs per-GB) before estimating cost.
- **Require users to supply their own TURN credentials.** Zero ongoing cost for you. Non-trivial setup for users; will reduce adoption of the feature.
- **No TURN.** Fall back to IBB when ICE fails. Disclose this honestly to users. Limits "no size limit P2P" to the subset of users with favourable NAT.

This decision cannot be deferred past the point of shipping file transfer — the fallback behaviour when ICE fails must be defined before the feature ships.

**2. What STUN servers do you rely on, and is the Google public STUN acceptable?**

`stun.l.google.com:19302` is free, widely used, and has no SLA. It has had outages. For a small project this is acceptable, but a self-hosted STUN endpoint on the same VPS as coturn costs nothing additional and eliminates a third-party dependency.

**3. Who verifies the SHA-256 of transferred files in the initial release?**

The receiver hashes the completed file. The sender must also hash before sending and include the hash in the offer stanza. Both must use the streaming approach (hash updated per chunk, not a blocking post-receive pass). Confirm this is the implementation plan before the file transfer module is written.

**4. What is the release strategy for the `urn:iseeku:*` namespace list?**

The namespace list is frozen per release — changing it changes the caps hash, which causes one extra disco#info round-trip from every contact. This is harmless but means the node URI and feature list must be treated as a versioned contract. The question: do you maintain a public changelog of namespace additions, or treat the GitHub repository as the canonical reference? Either is fine; pick one and commit to it so future contributors know the convention.

**5. How do you want to handle the cleartext warning UX?**

The existing flow already requires the user to explicitly accept cleartext before the password is sent. The Secret Chat feature adds a second tier: messages can be additionally encrypted between ISeekU clients, but the account is still not secure. The question is whether the cleartext-accept flow needs updating to explain this distinction, or whether it stays as-is and the Secret Chat UI carries its own disclaimer. Mixing the two in the login flow may confuse users; keeping them separate is cleaner.