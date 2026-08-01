/**
 * XMPP-over-WebSocket transport for the renderer and the mobile shell (RFC 7395).
 *
 * The desktop client speaks XMPP over a raw TCP socket that the Electron main
 * process owns. A mobile app has no main process, and iOS and Android do not
 * expose raw TCP sockets to JavaScript at all. WebSocket is the only transport
 * that reaches both. RFC 7395 specifies how XMPP maps onto WebSocket frames:
 * instead of a streaming XML document, each stanza is one self-contained
 * WebSocket message, and the stream opening and closing are handled by dedicated
 * `<open>` and `<close>` elements in a separate namespace.
 *
 * ── Security posture ────────────────────────────────────────────────────────
 *
 * The desktop client has a careful policy — documented in
 * electron/lib/icq-auth-policy.js — about when sending the password over an
 * unencrypted link is acceptable, and when a server that previously offered
 * encryption and stops offering it must be refused outright. WebSocket carries
 * the same risks: `ws://` sends everything in the clear, exactly as a raw TCP
 * socket without STARTTLS does, and a server dropping from `wss://` to `ws://`
 * is indistinguishable from an interception attack. The same rules therefore
 * apply: an unencrypted connection is refused unless the Owner confirms it
 * explicitly this session, and a server that has gone from `wss://` to `ws://`
 * is refused regardless of any prior opt-in.
 *
 * ── The bridge problem ──────────────────────────────────────────────────────
 *
 * The icqr.net server speaks only raw TCP; it has no WebSocket endpoint. A
 * bridge is required between this transport and the server — something that
 * accepts WebSocket connections and forwards the bytes as XMPP TCP stanzas.
 * The bridge sees every byte of the session, including the SASL PLAIN password,
 * in the clear. See docs/adr/0004-mobile-is-capacitor-over-a-bridge.md for
 * why ISeekU ships no public bridge.
 *
 * ── Testability ─────────────────────────────────────────────────────────────
 *
 * The WebSocket constructor and the scheduler (setTimeout) are injected as
 * options rather than taken from globals. This keeps the module free of browser
 * globals so the security logic and the connection lifecycle can be exercised
 * with a plain fake object, without a running server or fake timers.
 */

export const FRAMING_NS = 'urn:ietf:params:xml:ns:xmpp-framing';

const MAX_RECONNECT_ATTEMPTS = 8;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_CAP_DELAY_MS = 30_000;

// ── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when the connection would send the password in the clear. */
export class InsecureConnectionError extends Error {
  constructor(message, { url }) {
    super(message);
    this.name = 'InsecureConnectionError';
    this.code = 'INSECURE_CONNECTION';
    this.url = url;
  }
}

/**
 * Thrown when a server that previously offered encryption no longer does.
 * Refusing rather than accepting is the correct response to what a
 * downgrade attack looks like from the client side.
 */
export class DowngradeError extends Error {
  constructor(message, { url }) {
    super(message);
    this.name = 'DowngradeError';
    this.code = 'DOWNGRADE_DETECTED';
    this.url = url;
  }
}

// ── Pure security logic ───────────────────────────────────────────────────────

/** Whether the URL scheme guarantees an encrypted channel. */
export function isSecure(url) {
  return String(url).startsWith('wss://');
}

/**
 * Enforce the security policy before a connection is opened.
 *
 * Throws if the connection would put the Owner's credentials at risk without
 * an explicit opt-in, or if the server appears to have lost encryption since
 * the last session — which is what an interception attempt looks like.
 *
 * @param {object}  opts
 * @param {string}  opts.url                 the WebSocket URL to connect to
 * @param {boolean} opts.allowInsecure        the Owner accepted this unencrypted
 *                                           connection explicitly, this session
 * @param {boolean} opts.wasSecurePreviously  whether this server previously
 *                                           offered a wss:// connection
 */
export function assertSecurityPolicy({ url, allowInsecure = false, wasSecurePreviously = false }) {
  const secure = isSecure(url);

  // A server that used to offer wss:// and now offers only ws:// is refused
  // outright — even if the Owner previously ticked "connect anyway". That
  // opt-in was for the server they knew; this is a different server.
  if (wasSecurePreviously && !secure) {
    throw new DowngradeError(
      `${url} previously offered an encrypted connection and no longer does. ` +
      'Refusing to connect: this is what an interception attempt looks like.',
      { url },
    );
  }

  // An unencrypted connection is only acceptable when the Owner has explicitly
  // confirmed it this session. The flag is not stored; it must be passed in
  // fresh each time, because the risk is present every time.
  if (!secure && !allowInsecure) {
    throw new InsecureConnectionError(
      `${url} is unencrypted (ws://). Your password and every message would ` +
      'be sent in readable form over the network. Connect only if you accept ' +
      'that, on a network you trust.',
      { url },
    );
  }
}

// ── Backoff ──────────────────────────────────────────────────────────────────

/**
 * Exponential backoff with optional jitter, capped at `cap`.
 *
 * @param {number}  attempt  how many reconnection attempts have been made so far
 * @param {object}  opts
 * @param {number}  opts.base   base delay in milliseconds
 * @param {number}  opts.cap    maximum delay in milliseconds
 * @param {boolean} opts.jitter whether to multiply by a random factor in [0.5, 1)
 * @returns {number} milliseconds to wait before the next attempt
 */
export function backoffDelay(attempt, {
  base = DEFAULT_BASE_DELAY_MS,
  cap = DEFAULT_CAP_DELAY_MS,
  jitter = true,
} = {}) {
  const exp = Math.min(base * Math.pow(2, attempt), cap);
  return jitter ? exp * (0.5 + Math.random() * 0.5) : exp;
}

// ── RFC 7395 framing ─────────────────────────────────────────────────────────

/**
 * The opening frame sent by the client. One frame per WebSocket connection;
 * it replaces the `<?xml ...><stream:stream ...>` of TCP XMPP.
 */
export function openFrame(domain) {
  return `<open xmlns='${FRAMING_NS}' to='${domain}' version='1.0'/>`;
}

/** The closing frame. The server mirrors it before closing the socket. */
export function closeFrame() {
  return `<close xmlns='${FRAMING_NS}'/>`;
}

function isOpenFrame(text) {
  // Require the element name to end at a space or self-close so that an element
  // such as <opening> or <opener> is not mistaken for the RFC 7395 stream open.
  // Also require the framing namespace: a plain <open/> from a wrong-namespace
  // extension must not trigger the stream-open transition.
  const t = text.trimStart();
  return (t.startsWith('<open ') || t.startsWith('<open/>')) && t.includes(FRAMING_NS);
}

function isCloseFrame(text) {
  // Same reasoning: <closer> or <closeable> must not terminate the stream.
  const t = text.trimStart();
  return (t.startsWith('<close ') || t.startsWith('<close/>')) && t.includes(FRAMING_NS);
}

// ── State machine ─────────────────────────────────────────────────────────────

const STATE = Object.freeze({
  IDLE:       'IDLE',
  CONNECTING: 'CONNECTING',
  OPEN:       'OPEN',
  CLOSING:    'CLOSING',
  CLOSED:     'CLOSED',
});

// ── Transport ─────────────────────────────────────────────────────────────────

/**
 * Manages one XMPP-over-WebSocket connection, including reconnection.
 *
 * Events:
 *   'open'          — the XMPP stream is ready; stanzas may now be sent
 *   'stanza'        — a stanza arrived (data: string XML)
 *   'close'         — the XMPP stream closed cleanly
 *   'error'         — a non-fatal problem; the transport will attempt to reconnect
 *   'fatal'         — a problem from which recovery is not possible
 */
export class WebSocketTransport {
  constructor({
    url,
    domain,
    allowInsecure = false,
    wasSecurePreviously = false,
    /* inject */ WebSocket: WSClass = globalThis.WebSocket,
    /* inject */ schedule = (fn, ms) => setTimeout(fn, ms),
    maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS,
    backoffBase = DEFAULT_BASE_DELAY_MS,
    backoffCap = DEFAULT_CAP_DELAY_MS,
  }) {
    if (!url) throw new TypeError('url is required');
    if (!domain) throw new TypeError('domain is required');
    if (!WSClass) throw new TypeError('WebSocket constructor is required');

    this._url = url;
    this._domain = domain;
    this._allowInsecure = allowInsecure;
    this._wasSecurePreviously = wasSecurePreviously;
    this._WSClass = WSClass;
    this._schedule = schedule;
    this._maxReconnectAttempts = maxReconnectAttempts;
    this._backoffBase = backoffBase;
    this._backoffCap = backoffCap;

    this._state = STATE.IDLE;
    this._ws = null;
    this._reconnectAttempt = 0;
    this._intentionallyClosed = false;
    this._listeners = new Map();
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  /**
   * Subscribe to a named event. Returns an unsubscribe function.
   * @param {string} event
   * @param {Function} fn
   * @returns {Function} unsubscribe
   */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this._listeners.get(event).delete(fn);
  }

  _emit(event, data) {
    for (const fn of (this._listeners.get(event) ?? [])) {
      try { fn(data); } catch (_) { /* listener errors must not crash the transport */ }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Open the WebSocket connection.
   *
   * Security policy is checked here, before the socket is created. If the
   * policy refuses the connection (insecure URL, or a detected downgrade), the
   * error propagates synchronously so the caller can surface it to the Owner
   * before anything is sent over the network.
   *
   * @throws {InsecureConnectionError}
   * @throws {DowngradeError}
   */
  connect() {
    if (this._state !== STATE.IDLE && this._state !== STATE.CLOSED) {
      throw new Error(`Cannot connect in state ${this._state}`);
    }

    // Security check runs at connect() time, every session.
    assertSecurityPolicy({
      url: this._url,
      allowInsecure: this._allowInsecure,
      wasSecurePreviously: this._wasSecurePreviously,
    });

    this._intentionallyClosed = false;
    this._reconnectAttempt = 0;
    this._openSocket();
  }

  /**
   * Send an XMPP stanza.
   *
   * @param {string} xml  a complete XML stanza string
   * @throws if not in OPEN state
   */
  send(xml) {
    if (this._state !== STATE.OPEN) {
      throw new Error(`Cannot send in state ${this._state}`);
    }
    this._ws.send(xml);
  }

  /**
   * Initiate a clean XMPP stream close.
   *
   * Sends the `<close>` frame and waits for the server to mirror it. If the
   * transport is still in CONNECTING state (the socket is open but the XMPP
   * stream has not been confirmed yet), the socket is closed immediately.
   */
  close() {
    if (this._state === STATE.OPEN) {
      this._intentionallyClosed = true;
      this._state = STATE.CLOSING;
      this._ws.send(closeFrame());
      // We now wait for the server's <close> frame in onmessage, which
      // transitions state to CLOSED and emits the 'close' event.
    } else if (this._state === STATE.CONNECTING) {
      this._intentionallyClosed = true;
      this._state = STATE.CLOSED;
      this._ws?.close();
    }
    // CLOSING, CLOSED, IDLE: nothing to do.
  }

  /** @returns {string} one of the STATE values */
  get state() { return this._state; }

  // ── Internal socket management ───────────────────────────────────────────────

  _openSocket() {
    this._state = STATE.CONNECTING;
    const ws = new this._WSClass(this._url);
    this._ws = ws;

    ws.onopen = () => {
      // The XMPP handshake begins immediately after the socket opens.
      // The stream is not usable for stanzas until the server's <open> arrives.
      ws.send(openFrame(this._domain));
    };

    ws.onmessage = ({ data }) => {
      const text = String(data);

      if (isOpenFrame(text)) {
        this._reconnectAttempt = 0;
        this._state = STATE.OPEN;
        this._emit('open', undefined);
        return;
      }

      if (isCloseFrame(text)) {
        if (this._state === STATE.CLOSING) {
          // We asked for this; the server confirmed.
          this._state = STATE.CLOSED;
          this._ws = null;
          this._emit('close', undefined);
        } else {
          // Server initiated the close. RFC 7395 §3.6: mirror the frame,
          // then wait for the socket to close.
          ws.send(closeFrame());
          this._state = STATE.CLOSED;
          this._ws = null;
          this._emit('close', undefined);
        }
        return;
      }

      // Regular stanza — only forwarded once the stream is confirmed open.
      if (this._state === STATE.OPEN) {
        this._emit('stanza', text);
      }
    };

    ws.onerror = (evt) => {
      // onerror fires before onclose; the reconnect decision is made in onclose.
      this._emit('error', evt instanceof Error ? evt : new Error('WebSocket error'));
    };

    ws.onclose = ({ wasClean, code } = {}) => {
      // If the state is already CLOSED the close was handled cleanly via the
      // <close> frame exchange; this event is just the socket catching up.
      if (this._state === STATE.CLOSED) return;

      if (this._intentionallyClosed) {
        // The Owner closed the connection; the <close> frame exchange may or
        // may not have completed, but no reconnect should happen.
        this._state = STATE.CLOSED;
        this._ws = null;
        return;
      }

      // Unexpected close: network drop, server restart, bridge failure.
      this._emit('error', new Error(
        `Connection closed unexpectedly (code ${code ?? 'unknown'}, ` +
        `clean=${Boolean(wasClean)}). Reconnecting…`,
      ));
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this._reconnectAttempt >= this._maxReconnectAttempts) {
      this._state = STATE.CLOSED;
      this._ws = null;
      this._emit('fatal', new Error(
        `Gave up after ${this._maxReconnectAttempts} reconnection attempts.`,
      ));
      return;
    }

    const delay = backoffDelay(this._reconnectAttempt, {
      base: this._backoffBase,
      cap: this._backoffCap,
    });
    this._reconnectAttempt += 1;
    this._state = STATE.CONNECTING;

    this._schedule(() => {
      if (!this._intentionallyClosed) this._openSocket();
    }, delay);
  }
}
