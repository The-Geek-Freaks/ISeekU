'use strict';

/**
 * Tests for the WebSocket-to-TCP bridge.
 *
 * The stanza-framing tests exercise `FrameParser` directly, passing raw
 * Buffers and inspecting the returned stanza slices. The allowlist test
 * exercises `isAllowed`. The rate-limit test exercises `makeRateLimiter`.
 * The password test exercises the log output: it spins up a real server
 * against a mock TCP server that sends a fake SASL PLAIN `<auth>` stanza,
 * captures every log line via the optional logger parameter, and asserts none
 * of them contain the password.
 */

const net = require('net');
const { FrameParser } = require('./frame-parser');
const { createServer, isAllowed, makeRateLimiter } = require('./server');

// ── FrameParser ───────────────────────────────────────────────────────────────

// A minimal stream opener that is short enough to be well within any size
// limit used in the tests below, yet triggers the "stream opener forwarded
// immediately" logic.
const SHORT_OPENER = '<stream:stream>';

describe('FrameParser', () => {
  test('emits the stream:stream opener immediately without waiting for its close', () => {
    const parser = new FrameParser(64 * 1024);
    const input = Buffer.from(
      "<stream:stream xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' to='icqr.net'>",
    );
    const stanzas = parser.feed(input);
    expect(stanzas).toHaveLength(1);
    expect(stanzas[0].toString()).toContain('stream:stream');
  });

  test('emits a complete self-closing presence stanza', () => {
    const parser = new FrameParser(64 * 1024);
    parser.feed(Buffer.from(SHORT_OPENER));
    const stanzas = parser.feed(Buffer.from('<presence/>'));
    expect(stanzas).toHaveLength(1);
    expect(stanzas[0].toString()).toBe('<presence/>');
  });

  test('emits a complete multi-line stanza when all bytes arrive at once', () => {
    const parser = new FrameParser(64 * 1024);
    parser.feed(Buffer.from(SHORT_OPENER));
    const stanza = '<message to="12345678@icqr.net"><body>hello</body></message>';
    const stanzas = parser.feed(Buffer.from(stanza));
    expect(stanzas).toHaveLength(1);
    expect(stanzas[0].toString()).toBe(stanza);
  });

  test('reassembles a stanza that arrives split across two TCP reads', () => {
    const parser = new FrameParser(64 * 1024);
    parser.feed(Buffer.from(SHORT_OPENER));

    const full = '<message to="12345678@icqr.net"><body>split</body></message>';
    const half = Math.floor(full.length / 2);

    const first = parser.feed(Buffer.from(full.slice(0, half)));
    expect(first).toHaveLength(0); // incomplete — nothing emitted yet

    const second = parser.feed(Buffer.from(full.slice(half)));
    expect(second).toHaveLength(1);
    expect(second[0].toString()).toBe(full);
  });

  test('handles a > character inside a double-quoted attribute value without breaking framing', () => {
    const parser = new FrameParser(64 * 1024);
    parser.feed(Buffer.from(SHORT_OPENER));
    // The literal > inside the attribute value must not be mistaken for the
    // tag close, which would split the tag mid-attribute and miscount depth.
    const raw = '<iq type="result" id="a>b"/>';
    const stanzas = parser.feed(Buffer.from(raw));
    expect(stanzas).toHaveLength(1);
    expect(stanzas[0].toString()).toBe(raw);
  });

  test('handles a > character inside a single-quoted attribute value without breaking framing', () => {
    const parser = new FrameParser(64 * 1024);
    parser.feed(Buffer.from(SHORT_OPENER));
    // icqr.net uses single-quoted attributes in its stream opener. A > inside
    // a single-quoted value must be treated identically to one in a
    // double-quoted value: both must be invisible to the depth counter.
    // Without the S_QUOTE_SINGLE state the parser would close the tag at the
    // > inside the value, emit the truncated tag as an opening element, and
    // corrupt the depth counter for the rest of the session.
    const raw = "<iq type='result' id='a>b'/>";
    const stanzas = parser.feed(Buffer.from(raw));
    expect(stanzas).toHaveLength(1);
    expect(stanzas[0].toString()).toBe(raw);
  });

  test('emits multiple stanzas when they arrive in the same TCP read', () => {
    const parser = new FrameParser(64 * 1024);
    parser.feed(Buffer.from(SHORT_OPENER));
    const input =
      '<presence/>' +
      '<message to="a@b"><body>hi</body></message>';
    const stanzas = parser.feed(Buffer.from(input));
    expect(stanzas).toHaveLength(2);
    expect(stanzas[0].toString()).toBe('<presence/>');
    expect(stanzas[1].toString()).toBe('<message to="a@b"><body>hi</body></message>');
  });

  test('returns null when a stanza exceeds the configured size limit', () => {
    // Limit is 20 bytes. The opener is 15 bytes and fits. The test stanza is
    // 30 bytes and must trigger the limit.
    const parser = new FrameParser(20);
    const openerResult = parser.feed(Buffer.from(SHORT_OPENER)); // 15 bytes
    expect(openerResult).toHaveLength(1); // opener emits fine

    const bigStanza = '<presence type="unavailable"/>'; // 30 bytes
    const result = parser.feed(Buffer.from(bigStanza));
    expect(result).toBeNull();
  });

  test('handles a stanza with nested elements at depth two and beyond', () => {
    const parser = new FrameParser(64 * 1024);
    parser.feed(Buffer.from(SHORT_OPENER));
    const stanza =
      '<iq type="set"><query xmlns="jabber:iq:auth">' +
      '<username>bob</username><password>x</password></query></iq>';
    const stanzas = parser.feed(Buffer.from(stanza));
    expect(stanzas).toHaveLength(1);
    expect(stanzas[0].toString()).toBe(stanza);
  });

  test('feeds stream opener followed immediately by a features stanza without confusion', () => {
    const parser = new FrameParser(64 * 1024);
    const opener =
      "<stream:stream xmlns='jabber:client'>";
    const features =
      '<stream:features>' +
      '<mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">' +
      '<mechanism>PLAIN</mechanism>' +
      '</mechanisms></stream:features>';
    const stanzas = parser.feed(Buffer.from(opener + features));
    // Opener is emitted immediately; features stanza follows as a second emit.
    expect(stanzas).toHaveLength(2);
    expect(stanzas[0].toString()).toContain('stream:stream');
    expect(stanzas[1].toString()).toContain('stream:features');
  });
});

// ── Allowlist ─────────────────────────────────────────────────────────────────

describe('isAllowed', () => {
  const allowlist = [{ host: '132.145.202.182', port: 5222 }];

  test('permits the configured icqr.net address', () => {
    expect(isAllowed('132.145.202.182', 5222, allowlist)).toBe(true);
  });

  test('refuses a host not on the allowlist', () => {
    expect(isAllowed('evil.example.com', 5222, allowlist)).toBe(false);
  });

  test('refuses the right host but wrong port', () => {
    expect(isAllowed('132.145.202.182', 25, allowlist)).toBe(false);
  });

  test('refuses an empty string host', () => {
    expect(isAllowed('', 5222, allowlist)).toBe(false);
  });

  test('allows a second entry when the allowlist has two entries', () => {
    const two = [
      { host: '132.145.202.182', port: 5222 },
      { host: '10.0.0.1', port: 5222 },
    ];
    expect(isAllowed('10.0.0.1', 5222, two)).toBe(true);
    expect(isAllowed('10.0.0.2', 5222, two)).toBe(false);
  });
});

// ── Rate limiter ──────────────────────────────────────────────────────────────

describe('makeRateLimiter', () => {
  test('allows consumption within the per-second budget', () => {
    const limiter = makeRateLimiter(1000, 1000);
    expect(limiter.consume(500)).toBe(true);
    expect(limiter.consume(499)).toBe(true);
  });

  test('refuses consumption that would exceed the budget', () => {
    const limiter = makeRateLimiter(1000, 1000);
    expect(limiter.consume(1000)).toBe(true);
    expect(limiter.consume(1)).toBe(false);
  });

  test('replenishes the budget after the window elapses', () => {
    // Use a very long window so the budget does not replenish mid-test, and
    // verify the exhausted state directly.
    const limiter = makeRateLimiter(100, 60_000);
    expect(limiter.consume(100)).toBe(true);
    expect(limiter.consume(1)).toBe(false); // exhausted

    // A fresh limiter with a 1ms window will have refilled by the time the
    // second consume() call executes — Node event-loop overhead alone takes
    // longer than 1ms, so this consistently passes without any explicit sleep.
    const fast = makeRateLimiter(100, 1);
    expect(fast.consume(100)).toBe(true);
    // After 1ms the window expires. Spin until it refills to avoid a sleep.
    const start = Date.now();
    while (Date.now() - start < 50) { /* busy wait — short, test-only */ }
    expect(fast.consume(100)).toBe(true);
  });
});

// ── Password safety ───────────────────────────────────────────────────────────

/**
 * Confirm that the bridge never writes a password to the log.
 *
 * A SASL PLAIN credential is base64(NUL + username + NUL + password).
 * The server sends `<auth mechanism="PLAIN">` followed by that blob.
 * We spin up a mock TCP server that replies with a well-formed XMPP exchange
 * including a PLAIN auth request, capture every log line via the optional
 * logger parameter (no console.log mocking needed, which avoids teardown
 * timing issues), and assert none of them contain the test password or its
 * base64 encoding.
 */
describe('password safety', () => {
  const password = 's3cr3tpass';
  const saslBlob = Buffer.from('\x00testuser\x00' + password).toString('base64');
  const authStanza =
    `<auth xmlns="urn:ietf:params:xml:ns:xmpp-sasl" mechanism="PLAIN">${saslBlob}</auth>`;

  let mockTcpServer;
  let bridgeServer;
  const logLines = [];

  const captureLogger = (...args) => {
    logLines.push(args.join(' '));
  };

  beforeAll((done) => {
    // Mock TCP server: sends a minimal XMPP handshake and echoes a success.
    mockTcpServer = net.createServer((socket) => {
      socket.write(
        "<stream:stream xmlns='jabber:client'" +
        " xmlns:stream='http://etherx.jabber.org/streams'>" +
        '<stream:features>' +
        '<mechanisms xmlns="urn:ietf:params:xml:ns:xmpp-sasl">' +
        '<mechanism>PLAIN</mechanism></mechanisms>' +
        '</stream:features>',
      );
      socket.on('data', () => {
        socket.write(
          '<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>',
        );
      });
    });

    mockTcpServer.listen(0, '127.0.0.1', () => {
      const tcpPort = mockTcpServer.address().port;
      const target = { host: '127.0.0.1', port: tcpPort };
      bridgeServer = createServer(
        {
          target,
          allowlist: [target],
          idleTimeoutMs: 500,
          maxConnections: 5,
          maxStanzaBytes: 64 * 1024,
          rateLimitBytesPerSecond: 1024 * 1024,
          rateLimitWindowMs: 1000,
        },
        captureLogger,
      );
      bridgeServer.httpServer.listen(0, '127.0.0.1', done);
    });
  });

  afterAll((done) => {
    bridgeServer.close();
    mockTcpServer.close(done);
  });

  test('no log line contains the password or its base64 encoding', (done) => {
    const wsPort = bridgeServer.httpServer.address().port;
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);

    ws.on('open', () => {
      ws.send(SHORT_OPENER);
      ws.send(authStanza);
    });

    // `once` rather than `on`: the server sends three messages (stream opener,
    // features, success) and `on` would call done() three times. Jest 29
    // swallows the extra calls silently, but the structural intent is to fire
    // once. The first message confirms TCP is connected and data is flowing;
    // the auth stanza was already queued in `on('open')`, so a 100 ms pause is
    // sufficient for it to traverse the bridge and be processed before we
    // inspect the log.
    ws.once('message', () => {
      setTimeout(() => {
        ws.close();
        // The connection-open and TCP-connect events guarantee at least one
        // log line exists. An empty log would mean the logger was never wired
        // in, which is itself a bug.
        expect(logLines.length).toBeGreaterThan(0);
        for (const line of logLines) {
          expect(line).not.toContain(password);
          expect(line).not.toContain(saslBlob);
        }
        done();
      }, 100);
    });

    ws.on('error', done);
  });
});
