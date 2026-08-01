/**
 * The direct connection between two ISeekU clients.
 *
 * `electron/lib/icq-p2p.js` and `electron/lib/icq-call.js` decide what a
 * transfer or a call should do; `electron/lib/icq-signal.js` carries those
 * decisions over XMPP. This is the piece that actually opens a socket between
 * the two machines, so a file or a voice stream never touches icqr.net.
 *
 * ── Why this lives in the renderer ──────────────────────────────────────────
 *
 * A renderer process *is* Chromium, so `RTCPeerConnection` is already here:
 * complete, maintained by the browser vendor, and identical on all three
 * platforms. The alternative was a native module in the main process, which
 * would mean a build toolchain, per-platform binaries in every release, and an
 * ABI that has to be watched across Node versions. Using what the platform
 * already provides is the smaller thing to own.
 *
 * The cost is that signalling has to cross the process boundary — the socket
 * to the server lives in main — which is what `window.api.icq.sendSignal` and
 * `onSignal` are for.
 *
 * ── Why a connection needs a server at all ──────────────────────────────────
 *
 * Two machines behind home routers cannot address each other directly: each
 * knows only its private address. STUN is one packet to a public host that
 * replies with what your public address looks like from outside, which is
 * enough for most pairs.
 *
 * It is not enough for everyone. Behind symmetric NAT — common on mobile
 * networks and some corporate firewalls — the address STUN reports is not the
 * one the peer can reach, and the only remedy is TURN: a relay that both sides
 * connect out to. A relay is a server somebody has to run and pay for, so
 * ISeekU ships none and the Owner can name their own. Where neither works the
 * connection fails, and it says so rather than hanging on `connecting` — which
 * is the honest version of "peer to peer, no relay".
 */

/**
 * A public STUN server, used only to learn this machine's public address.
 *
 * No message, file or call audio passes through it — it answers one question
 * and is not contacted again. It is Google's because it is the one that is
 * reliably up; an Owner who would rather not can replace it in Preferences.
 */
export const DEFAULT_ICE_SERVERS = Object.freeze([
  { urls: 'stun:stun.l.google.com:19302' },
]);

/** Data channels above this are refused; see icq-p2p.js on the 16 KiB chunk. */
const MAX_MESSAGE_BYTES = 256 * 1024;

/**
 * How long to wait for a connection before calling it failed.
 *
 * ICE gathers candidates and tries them in order, and a pair that cannot reach
 * each other simply stops producing results rather than reporting an error, so
 * without a deadline the interface would sit on "connecting" indefinitely.
 */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * Build the RTCConfiguration from what the Owner has set.
 *
 * A TURN entry needs credentials, and a half-filled one is worse than none: it
 * makes ICE spend its budget on a server that will refuse it. So an incomplete
 * TURN entry is dropped rather than passed through.
 */
export function iceConfiguration({ stunUrl, turnUrl, turnUsername, turnPassword } = {}) {
  const servers = [];

  const stun = typeof stunUrl === 'string' ? stunUrl.trim() : '';
  if (stun) servers.push({ urls: stun });
  else servers.push(...DEFAULT_ICE_SERVERS);

  const turn = typeof turnUrl === 'string' ? turnUrl.trim() : '';
  if (turn) {
    if (turnUsername && turnPassword) {
      servers.push({ urls: turn, username: turnUsername, credential: turnPassword });
    }
    // An incomplete TURN entry is silently useless in the browser, so it is
    // dropped here where the caller can be told why.
  }

  return { iceServers: servers };
}

/** True when a TURN server was asked for but cannot be used as given. */
export function turnIsIncomplete({ turnUrl, turnUsername, turnPassword } = {}) {
  return Boolean(turnUrl && turnUrl.trim()) && !(turnUsername && turnPassword);
}

/**
 * Open a direct connection to a Contact.
 *
 * `caller` decides who creates the offer. Both ends run the same code, so
 * something has to break the symmetry, and the call state machine already
 * resolves that (including the case where both dial at once) — this just does
 * what it is told.
 *
 * Returns an object with `send`, `close`, and the lifecycle callbacks set by
 * the caller. Everything that can fail reports through `onFailed` rather than
 * throwing, because the state machines treat a failure as one more transition.
 */
export function createPeerConnection({
  contactJid,
  caller,
  iceConfig,
  sendSignal,
  label = 'iseeku',
  timeoutMs = CONNECT_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  const handlers = {
    onOpen: () => {},
    onMessage: () => {},
    onClosed: () => {},
    onFailed: () => {},
    onTrack: () => {},
    onStateChange: () => {},
  };

  const pc = new RTCPeerConnection(iceConfig || iceConfiguration());
  let channel = null;
  let settled = false;
  let failed = false;
  let timer = null;
  const startedAt = now();

  // `settled` ends the connect timeout; it must not also silence failures.
  // A connection that opens and then breaks -- the far end sending something
  // oversized, the channel erroring, the route dropping mid-transfer -- still
  // has to reach the caller, or a broken transfer sits at "connected" forever.
  const fail = (reason) => {
    if (failed) return;
    failed = true;
    settled = true;
    clearTimeout(timer);
    handlers.onFailed({ reason, afterMs: now() - startedAt });
    try { pc.close(); } catch { /* already gone */ }
  };

  const succeed = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    handlers.onOpen();
  };

  timer = setTimeout(() => {
    fail('No route to this Contact. If either of you is on a mobile or office '
      + 'network, a direct connection may not be possible without a TURN relay.');
  }, timeoutMs);

  function attachChannel(dc) {
    channel = dc;
    channel.binaryType = 'arraybuffer';
    channel.onopen = succeed;
    channel.onclose = () => handlers.onClosed();
    channel.onerror = (e) => fail(e && e.error ? e.error.message : 'The connection broke.');
    channel.onmessage = (event) => {
      // Anything arriving here was sent by the Contact's client, which is not
      // this one and is not trusted. Size is checked before it is handled;
      // the protocol modules check the contents.
      const size = typeof event.data === 'string' ? event.data.length : event.data.byteLength;
      if (size > MAX_MESSAGE_BYTES) {
        fail('The Contact sent more data than a chunk can be.');
        return;
      }
      handlers.onMessage(event.data);
    };
  }

  if (caller) {
    // The caller creates the channel; the answerer receives it via ondatachannel.
    attachChannel(pc.createDataChannel(label, { ordered: true }));
  } else {
    pc.ondatachannel = (event) => attachChannel(event.channel);
  }

  pc.onicecandidate = (event) => {
    if (!event.candidate) return; // gathering finished
    sendSignal({ type: 'call-ice', candidate: event.candidate.toJSON() });
  };

  pc.onconnectionstatechange = () => {
    handlers.onStateChange(pc.connectionState);
    if (pc.connectionState === 'failed') {
      fail('The direct connection could not be established.');
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      handlers.onClosed();
    }
  };

  pc.ontrack = (event) => handlers.onTrack(event);

  return {
    /** The underlying connection, for adding media tracks to a call. */
    raw: pc,

    /** Create and send the offer. Caller only. */
    async start() {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        return { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : offer };
      } catch (err) {
        fail(err.message);
        return { error: err.message };
      }
    },

    /** Take the far end's offer and produce an answer. Answerer only. */
    async accept(remoteSdp) {
      try {
        await pc.setRemoteDescription(remoteSdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        return { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : answer };
      } catch (err) {
        fail(err.message);
        return { error: err.message };
      }
    },

    /** Take the answer to an offer this side made. */
    async complete(remoteSdp) {
      try {
        await pc.setRemoteDescription(remoteSdp);
        return { ok: true };
      } catch (err) {
        fail(err.message);
        return { error: err.message };
      }
    },

    /**
     * Add a candidate the far end gathered.
     *
     * Candidates routinely arrive before the remote description is set, and
     * the browser rejects those. It is not a failure worth ending a call over,
     * so it is reported and ignored.
     */
    async addCandidate(candidate) {
      try {
        await pc.addIceCandidate(candidate);
        return { ok: true };
      } catch (err) {
        return { error: err.message };
      }
    },

    /** Send bytes to the far end. Refuses rather than throws when not open. */
    send(data) {
      if (!channel || channel.readyState !== 'open') {
        return { error: 'The connection to this Contact is not open.' };
      }
      const size = typeof data === 'string' ? data.length : data.byteLength;
      if (size > MAX_MESSAGE_BYTES) return { error: 'That is too large for one message.' };
      try {
        channel.send(data);
        return { ok: true };
      } catch (err) {
        return { error: err.message };
      }
    },

    /** How much is queued but not yet on the wire; icq-p2p gates on this. */
    bufferedAmount() {
      return channel ? channel.bufferedAmount : 0;
    },

    isOpen() {
      return Boolean(channel && channel.readyState === 'open');
    },

    close() {
      clearTimeout(timer);
      settled = true;
      try { if (channel) channel.close(); } catch { /* already gone */ }
      try { pc.close(); } catch { /* already gone */ }
    },

    on(name, fn) {
      if (name in handlers && typeof fn === 'function') handlers[name] = fn;
      return this;
    },

    contactJid,
  };
}
