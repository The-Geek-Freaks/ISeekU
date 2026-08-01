/**
 * The security logic and connection lifecycle are the two things this transport
 * adds on top of a plain WebSocket. Security is why the module exists at all —
 * a transport that quietly opened an unencrypted link, or let a downgrade
 * happen silently, would give the Owner no reason to trust it. The lifecycle
 * tests confirm the RFC 7395 framing, the event model, and the reconnection
 * behaviour so that the transport can be updated with confidence.
 */

import {
  isSecure,
  assertSecurityPolicy,
  backoffDelay,
  openFrame,
  closeFrame,
  WebSocketTransport,
  InsecureConnectionError,
  DowngradeError,
  FRAMING_NS,
} from './websocket';

// ── Fake WebSocket ────────────────────────────────────────────────────────────

/**
 * A minimal stand-in for the browser WebSocket. Tests call the simulate*
 * helpers to drive the events; the transport's callbacks do the rest.
 */
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.lastInstance = this;
  }

  send(data) { this.sent.push(data); }

  // Called by the transport to close the socket. Does NOT trigger onclose
  // automatically so tests can control when/whether that event fires.
  close() { this.readyState = FakeWebSocket.CLOSED; }

  // Test helpers ──────────────────────────────────────────────────────────────

  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  simulateMessage(data) {
    this.onmessage?.({ data });
  }

  // An unexpected network-level close (bridge crash, timeout, etc.)
  simulateDrop(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ wasClean: false, code });
  }

  // A clean WebSocket close, as follows an XMPP <close> exchange
  simulateCleanClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ wasClean: true, code: 1000 });
  }

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static lastInstance = null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A synchronous scheduler: calls the function immediately. */
function syncSchedule(fn) { fn(); }

/**
 * A deferred scheduler: stores the function for the test to call when ready.
 * Returns an object with a `flush()` method.
 */
function deferScheduler() {
  const pending = [];
  return {
    schedule: (fn) => pending.push(fn),
    flush: () => { const fns = pending.splice(0); fns.forEach((f) => f()); },
    pendingCount: () => pending.length,
  };
}

/** Builds a transport pointing at a fake wss:// bridge. */
function makeTransport(overrides = {}) {
  return new WebSocketTransport({
    url: 'wss://bridge.example.com',
    domain: '132.145.202.182',
    WebSocket: FakeWebSocket,
    schedule: syncSchedule,
    ...overrides,
  });
}

beforeEach(() => {
  FakeWebSocket.lastInstance = null;
});

// ── isSecure ──────────────────────────────────────────────────────────────────

describe('isSecure', () => {
  it('returns true for a wss:// URL', () => {
    expect(isSecure('wss://bridge.example.com')).toBe(true);
  });

  it('returns false for a ws:// URL', () => {
    expect(isSecure('ws://bridge.example.com')).toBe(false);
  });

  it('is not fooled by a ws:// URL that contains wss elsewhere', () => {
    expect(isSecure('ws://bridge.example.com/wss')).toBe(false);
  });
});

// ── isOpenFrame / isCloseFrame false-positive guard ───────────────────────────
//
// These tests exist because the element-name check is a substring match: without
// the boundary check, '<opening>' or '<opener>' would be treated as an RFC 7395
// open frame, causing a premature OPEN state transition.  Similarly '<closer>'
// would end the stream unexpectedly.

describe('frame detection does not match elements whose names merely begin with the keyword', () => {
  it('does not treat an <opening> element as the stream-open frame', () => {
    const t = makeTransport();
    const events = [];
    t.on('open', () => events.push('open'));
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    // An extension element whose name starts with "open" must not trigger the
    // XMPP stream-open transition.
    FakeWebSocket.lastInstance.simulateMessage('<opening xmlns="urn:other"/>');
    expect(events).toHaveLength(0);
    expect(t.state).toBe('CONNECTING');
  });

  it('does not treat a wrong-namespace <open> element as the stream-open frame', () => {
    const t = makeTransport();
    const events = [];
    t.on('open', () => events.push('open'));
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    FakeWebSocket.lastInstance.simulateMessage('<open xmlns="urn:wrong-ns"/>');
    expect(events).toHaveLength(0);
    expect(t.state).toBe('CONNECTING');
  });

  it('does not treat a <closer> element as the stream-close frame', () => {
    // Get to OPEN state first.
    const t = makeTransport();
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    FakeWebSocket.lastInstance.simulateMessage(`<open xmlns='${FRAMING_NS}'/>`);
    expect(t.state).toBe('OPEN');
    const events = [];
    t.on('close', () => events.push('close'));
    // An element whose name starts with "close" must not terminate the stream.
    FakeWebSocket.lastInstance.simulateMessage('<closer xmlns="urn:other"/>');
    expect(events).toHaveLength(0);
    expect(t.state).toBe('OPEN');
  });
});

// ── assertSecurityPolicy ──────────────────────────────────────────────────────

describe('assertSecurityPolicy', () => {
  it('allows a wss:// URL without any opt-in', () => {
    expect(() => assertSecurityPolicy({ url: 'wss://bridge.example.com' })).not.toThrow();
  });

  it('allows a ws:// URL when the Owner has explicitly opted in this session', () => {
    expect(() => assertSecurityPolicy({
      url: 'ws://bridge.example.com',
      allowInsecure: true,
    })).not.toThrow();
  });

  it('refuses a ws:// URL without an explicit opt-in', () => {
    expect(() => assertSecurityPolicy({ url: 'ws://bridge.example.com' }))
      .toThrow(InsecureConnectionError);
  });

  it('names the URL in the error so the warning dialogue can show it', () => {
    try {
      assertSecurityPolicy({ url: 'ws://my-bridge.local' });
    } catch (err) {
      expect(err.code).toBe('INSECURE_CONNECTION');
      expect(err.url).toBe('ws://my-bridge.local');
      expect(err.message).toMatch(/readable form/);
    }
    expect.assertions(3);
  });

  it('refuses a downgrade even when the Owner has opted in to insecure connections', () => {
    // allowInsecure being true was permission for the server the Owner knew.
    // A server that has lost wss:// is a different server, and the opt-in
    // does not transfer.
    expect(() => assertSecurityPolicy({
      url: 'ws://bridge.example.com',
      allowInsecure: true,
      wasSecurePreviously: true,
    })).toThrow(DowngradeError);
  });

  it('names the URL in the downgrade error', () => {
    try {
      assertSecurityPolicy({ url: 'ws://bridge.example.com', wasSecurePreviously: true });
    } catch (err) {
      expect(err.code).toBe('DOWNGRADE_DETECTED');
      expect(err.message).toMatch(/interception/);
    }
    expect.assertions(2);
  });

  it('allows a server that was always ws:// to remain ws:// with an opt-in', () => {
    // This is the icqr.net case translated to WebSocket: it has always been
    // unencrypted, so there is no downgrade.
    expect(() => assertSecurityPolicy({
      url: 'ws://bridge.example.com',
      allowInsecure: true,
      wasSecurePreviously: false,
    })).not.toThrow();
  });
});

// ── backoffDelay ──────────────────────────────────────────────────────────────

describe('backoffDelay', () => {
  it('returns the base delay on the first attempt', () => {
    expect(backoffDelay(0, { base: 1000, jitter: false })).toBe(1000);
  });

  it('doubles on each attempt', () => {
    expect(backoffDelay(1, { base: 1000, jitter: false })).toBe(2000);
    expect(backoffDelay(2, { base: 1000, jitter: false })).toBe(4000);
  });

  it('does not exceed the cap', () => {
    expect(backoffDelay(100, { base: 1000, cap: 5000, jitter: false })).toBe(5000);
  });

  it('with jitter, the result is at most the uncapped exponential value', () => {
    const without = backoffDelay(3, { base: 1000, jitter: false });
    const with_ = backoffDelay(3, { base: 1000, jitter: true });
    expect(with_).toBeLessThanOrEqual(without);
    expect(with_).toBeGreaterThanOrEqual(without * 0.5);
  });
});

// ── RFC 7395 framing ──────────────────────────────────────────────────────────

describe('openFrame', () => {
  it('includes the RFC 7395 framing namespace', () => {
    expect(openFrame('132.145.202.182')).toContain(FRAMING_NS);
  });

  it('includes the target domain', () => {
    expect(openFrame('132.145.202.182')).toContain('132.145.202.182');
  });

  it('declares XMPP version 1.0', () => {
    expect(openFrame('example.org')).toContain('version=\'1.0\'');
  });
});

describe('closeFrame', () => {
  it('includes the RFC 7395 framing namespace', () => {
    expect(closeFrame()).toContain(FRAMING_NS);
  });
});

// ── Transport construction ────────────────────────────────────────────────────

describe('WebSocketTransport construction', () => {
  it('requires a url', () => {
    expect(() => new WebSocketTransport({
      domain: '132.145.202.182',
      WebSocket: FakeWebSocket,
    })).toThrow(TypeError);
  });

  it('requires a domain', () => {
    expect(() => new WebSocketTransport({
      url: 'wss://bridge.example.com',
      WebSocket: FakeWebSocket,
    })).toThrow(TypeError);
  });

  it('starts in IDLE state', () => {
    const t = makeTransport();
    expect(t.state).toBe('IDLE');
  });
});

// ── connect() security gate ───────────────────────────────────────────────────

describe('connect() security gate', () => {
  it('refuses to connect to a ws:// URL without an opt-in', () => {
    const t = makeTransport({ url: 'ws://bridge.example.com' });
    expect(() => t.connect()).toThrow(InsecureConnectionError);
  });

  it('does not create a WebSocket when security is refused', () => {
    const t = makeTransport({ url: 'ws://bridge.example.com' });
    try { t.connect(); } catch (_) {}
    expect(FakeWebSocket.lastInstance).toBeNull();
  });

  it('refuses a downgrade at connect() time', () => {
    const t = makeTransport({
      url: 'ws://bridge.example.com',
      allowInsecure: true,
      wasSecurePreviously: true,
    });
    expect(() => t.connect()).toThrow(DowngradeError);
  });

  it('allows a secure wss:// connection without any opt-in', () => {
    const t = makeTransport({ url: 'wss://bridge.example.com' });
    expect(() => t.connect()).not.toThrow();
  });
});

// ── connect() in non-idle state ───────────────────────────────────────────────

describe('connect() in a non-idle state', () => {
  it('throws if called when already connecting', () => {
    const t = makeTransport();
    t.connect();
    expect(() => t.connect()).toThrow(/Cannot connect in state CONNECTING/);
  });
});

// ── close() before the socket opens ──────────────────────────────────────────

describe('close() called before the socket opens', () => {
  it('moves to CLOSED and prevents any reconnect', () => {
    // On a slow network the Owner may cancel before the TCP handshake
    // completes.  close() in CONNECTING must mark the closure as intentional
    // and never schedule a reconnect, even if the socket later fires onclose.
    const deferred = deferScheduler();
    const t = makeTransport({ schedule: deferred.schedule, backoffBase: 100 });
    t.connect();
    // Socket is open at the WebSocket level but onopen has not fired yet.
    expect(t.state).toBe('CONNECTING');
    t.close();
    expect(t.state).toBe('CLOSED');
    // Simulate the socket eventually closing after our close() call.
    FakeWebSocket.lastInstance.simulateCleanClose();
    // The onclose handler must not schedule a reconnect.
    expect(deferred.pendingCount()).toBe(0);
  });
});

// ── connection lifecycle ──────────────────────────────────────────────────────

describe('connection lifecycle', () => {
  it('creates a WebSocket with the given URL on connect()', () => {
    const t = makeTransport();
    t.connect();
    expect(FakeWebSocket.lastInstance.url).toBe('wss://bridge.example.com');
  });

  it('sends the RFC 7395 <open> frame once the socket opens', () => {
    const t = makeTransport();
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    const sent = FakeWebSocket.lastInstance.sent;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('<open');
    expect(sent[0]).toContain('132.145.202.182');
  });

  it('is in CONNECTING state after connect() and before the server <open>', () => {
    const t = makeTransport();
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    expect(t.state).toBe('CONNECTING');
  });

  it('emits open and moves to OPEN state when the server sends <open>', () => {
    const t = makeTransport();
    const events = [];
    t.on('open', () => events.push('open'));
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    FakeWebSocket.lastInstance.simulateMessage(`<open xmlns='${FRAMING_NS}' from='132.145.202.182'/>`);
    expect(events).toEqual(['open']);
    expect(t.state).toBe('OPEN');
  });

  it('forwards stanzas received in OPEN state as stanza events', () => {
    const t = makeTransport();
    const stanzas = [];
    t.on('stanza', (s) => stanzas.push(s));
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    FakeWebSocket.lastInstance.simulateMessage(`<open xmlns='${FRAMING_NS}'/>`);
    FakeWebSocket.lastInstance.simulateMessage('<presence from="12345@132.145.202.182"/>');
    expect(stanzas).toEqual(['<presence from="12345@132.145.202.182"/>']);
  });

  it('does not forward stanzas before the stream is confirmed open', () => {
    const t = makeTransport();
    const stanzas = [];
    t.on('stanza', (s) => stanzas.push(s));
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    // Server sends a stanza before the <open> frame — should be ignored
    FakeWebSocket.lastInstance.simulateMessage('<message/>');
    expect(stanzas).toHaveLength(0);
  });

  it('allows send() in OPEN state', () => {
    const t = makeTransport();
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    FakeWebSocket.lastInstance.simulateMessage(`<open xmlns='${FRAMING_NS}'/>`);
    expect(() => t.send('<iq/>')).not.toThrow();
    expect(FakeWebSocket.lastInstance.sent).toContain('<iq/>');
  });

  it('refuses send() when not in OPEN state', () => {
    const t = makeTransport();
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    // No server <open> yet, so still CONNECTING
    expect(() => t.send('<iq/>')).toThrow(/Cannot send/);
  });
});

// ── clean close ──────────────────────────────────────────────────────────────

describe('clean close sequence', () => {
  function openedTransport() {
    const t = makeTransport();
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    FakeWebSocket.lastInstance.simulateMessage(`<open xmlns='${FRAMING_NS}'/>`);
    return t;
  }

  it('sends the <close> frame when close() is called in OPEN state', () => {
    const t = openedTransport();
    const ws = FakeWebSocket.lastInstance;
    const sentBefore = ws.sent.length;
    t.close();
    const closeSent = ws.sent.slice(sentBefore);
    expect(closeSent).toHaveLength(1);
    expect(closeSent[0]).toContain('<close');
  });

  it('transitions to CLOSING after close()', () => {
    const t = openedTransport();
    t.close();
    expect(t.state).toBe('CLOSING');
  });

  it('emits close and moves to CLOSED when the server mirrors the <close> frame', () => {
    const t = openedTransport();
    const events = [];
    t.on('close', () => events.push('close'));
    t.close();
    FakeWebSocket.lastInstance.simulateMessage(`<close xmlns='${FRAMING_NS}'/>`);
    expect(events).toEqual(['close']);
    expect(t.state).toBe('CLOSED');
  });

  it('handles a server-initiated close by mirroring the frame', () => {
    const t = openedTransport();
    const ws = FakeWebSocket.lastInstance;
    const events = [];
    t.on('close', () => events.push('close'));
    ws.simulateMessage(`<close xmlns='${FRAMING_NS}'/>`);
    // The transport should have sent a <close> in reply
    const lastSent = ws.sent[ws.sent.length - 1];
    expect(lastSent).toContain('<close');
    expect(events).toEqual(['close']);
    expect(t.state).toBe('CLOSED');
  });

  it('a WebSocket close event that arrives after the XMPP close is ignored', () => {
    const t = openedTransport();
    const events = [];
    t.on('close', () => events.push('close'));
    t.on('error', () => events.push('error'));
    t.close();
    FakeWebSocket.lastInstance.simulateMessage(`<close xmlns='${FRAMING_NS}'/>`);
    // Now the WebSocket closes (after the XMPP handshake is already done)
    FakeWebSocket.lastInstance.simulateCleanClose();
    // Should have emitted exactly one close, nothing else
    expect(events).toEqual(['close']);
  });
});

// ── reconnection ──────────────────────────────────────────────────────────────

describe('reconnection on unexpected drop', () => {
  function openedTransportDeferred() {
    const deferred = deferScheduler();
    const t = makeTransport({ schedule: deferred.schedule, backoffBase: 100 });
    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    FakeWebSocket.lastInstance.simulateMessage(`<open xmlns='${FRAMING_NS}'/>`);
    return { t, deferred };
  }

  it('schedules a reconnect on an unexpected socket close', () => {
    const { t, deferred } = openedTransportDeferred();
    FakeWebSocket.lastInstance.simulateDrop();
    expect(deferred.pendingCount()).toBe(1);
  });

  it('creates a new WebSocket when the scheduled reconnect fires', () => {
    const { t, deferred } = openedTransportDeferred();
    const first = FakeWebSocket.lastInstance;
    FakeWebSocket.lastInstance.simulateDrop();
    deferred.flush();
    const second = FakeWebSocket.lastInstance;
    expect(second).not.toBe(first);
  });

  it('does not reconnect after an intentional close()', () => {
    const { t, deferred } = openedTransportDeferred();
    t.close();
    // Now drop the socket as if the server closed it
    FakeWebSocket.lastInstance.simulateDrop();
    expect(deferred.pendingCount()).toBe(0);
  });

  it('emits a fatal event after exhausting all reconnect attempts', () => {
    const deferred = deferScheduler();
    const t = makeTransport({
      schedule: deferred.schedule,
      maxReconnectAttempts: 2,
      backoffBase: 100,
    });
    const fatalEvents = [];
    t.on('fatal', (e) => fatalEvents.push(e));

    t.connect();
    // First attempt: drop immediately
    FakeWebSocket.lastInstance.simulateDrop();
    // Second attempt
    deferred.flush();
    FakeWebSocket.lastInstance.simulateDrop();
    // Third attempt (exceeds maxReconnectAttempts=2)
    deferred.flush();
    FakeWebSocket.lastInstance.simulateDrop();
    // Should have given up
    expect(fatalEvents).toHaveLength(1);
    expect(fatalEvents[0].message).toMatch(/Gave up after 2/);
    expect(t.state).toBe('CLOSED');
  });

  it('resets the reconnect counter after a successful open', () => {
    // maxReconnectAttempts: 1 makes this test meaningful.  Without a counter
    // reset, the second drop following a successful reconnect would exhaust the
    // budget and emit 'fatal'.  With a reset it schedules another attempt.
    const deferred = deferScheduler();
    const t = makeTransport({ schedule: deferred.schedule, backoffBase: 100, maxReconnectAttempts: 1 });
    const fatalEvents = [];
    t.on('fatal', (e) => fatalEvents.push(e));

    t.connect();
    FakeWebSocket.lastInstance.simulateOpen();
    FakeWebSocket.lastInstance.simulateMessage(`<open xmlns='${FRAMING_NS}'/>`);

    // First drop: one reconnect attempt used
    FakeWebSocket.lastInstance.simulateDrop();
    deferred.flush();
    // Reconnect succeeds — this is the moment the counter must be reset to 0
    FakeWebSocket.lastInstance.simulateOpen();
    FakeWebSocket.lastInstance.simulateMessage(`<open xmlns='${FRAMING_NS}'/>`);
    // Second drop: if counter was NOT reset, 1 >= 1 → fatal; if reset, a new
    // attempt is scheduled instead
    FakeWebSocket.lastInstance.simulateDrop();

    expect(fatalEvents).toHaveLength(0);
    expect(deferred.pendingCount()).toBe(1);
  });
});
