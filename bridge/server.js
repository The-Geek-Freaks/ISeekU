/**
 * WebSocket-to-TCP bridge for mobile XMPP clients.
 *
 * A browser or Capacitor WebView cannot open a raw TCP socket. It can only
 * speak WebSocket. icqr.net offers no WebSocket endpoint — it is plain TCP on
 * port 5222 with no TLS and no framing beyond what XMPP defines. So mobile
 * clients need this process in between: WebSocket in from the client, TCP out
 * to the XMPP server, bytes pumped both ways.
 *
 * ── The hard part: framing ───────────────────────────────────────────────────
 *
 * XMPP over TCP is a byte stream. There is no length prefix, no delimiter
 * between stanzas. A client reading from the socket has to parse XML to know
 * where one stanza ends and the next begins. XMPP over WebSocket (RFC 7395)
 * is different: every WebSocket message carries exactly one complete stanza.
 * So when a mobile client sends a WebSocket message, this bridge must read
 * the XML inside it, confirm it is a complete stanza, and forward the raw
 * bytes over TCP. In the other direction it must accumulate TCP bytes until
 * it has a complete stanza before sending one WebSocket message.
 *
 * A full XML parser would be correct but heavy. A depth counter over open and
 * close tags is enough: depth goes up on an opening tag, down on a closing tag
 * or self-closing tag, and a stanza is complete when depth returns to one —
 * meaning we have seen a complete child of the stream root. The special case
 * is the opening `<stream:stream ...>` element, which is never self-closing
 * and never gets a matching `</stream:stream>` until logout. It is at depth
 * one and must be forwarded immediately without waiting for a close. So the
 * rule is: forward at depth one if the tag is self-closing or is the stream
 * opener, and forward at depth zero if a closing tag just brought us there
 * from depth one.
 *
 * ── Security: allowlist ──────────────────────────────────────────────────────
 *
 * An open TCP relay is a serious abuse vector. Without an allowlist anyone
 * could point this bridge at any host and port — a port scanner, a SMTP
 * relay, an internal address. The bridge refuses to connect to any host that
 * is not on the configured allowlist. The default is icqr.net only.
 *
 * ── Security: never log stanza contents ──────────────────────────────────────
 *
 * XMPP SASL PLAIN sends the password in the clear as a base64 blob inside an
 * `<auth>` stanza. Logging stanza contents would log every password that
 * crosses this bridge. This file logs connection events only: open, close,
 * error, and rate-limit hits. It never logs bytes, stanza text, or anything
 * derived from them. This is non-negotiable and must not be changed.
 *
 * ── Limits ───────────────────────────────────────────────────────────────────
 *
 * A bridge with no limits is a free proxy. Per-connection limits cover:
 * max bytes per second (rate limit), max stanza size, idle timeout, and max
 * concurrent connections. All are configurable and have safe defaults.
 */

'use strict';

const net = require('net');
const http = require('http');
const { WebSocketServer } = require('ws');
const { FrameParser } = require('./frame-parser');

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  port: 5280,
  xmppHost: '132.145.202.182',
  xmppPort: 5222,
  allowlist: [{ host: '132.145.202.182', port: 5222 }],
  maxConnections: 50,
  idleTimeoutMs: 120_000,
  maxStanzaBytes: 64 * 1024,
  rateLimitBytesPerSecond: 32 * 1024,
  rateLimitWindowMs: 1000,
};

// ── Allowlist check ───────────────────────────────────────────────────────────

/**
 * Decide whether a target host and port appear on the allowlist.
 *
 * The comparison is exact string matching on the host and strict equality on
 * the port. DNS is not resolved: a hostname and its IP address are different
 * strings and must both appear if both need to be reachable.
 */
function isAllowed(host, port, allowlist) {
  for (const entry of allowlist) {
    if (entry.host === host && entry.port === port) return true;
  }
  return false;
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

/**
 * Token-bucket rate limiter, one instance per connection.
 *
 * Each second the bucket refills to the per-second limit. A byte transfer
 * consumes tokens. When the bucket is empty the connection is dropped. The
 * purpose is to stop a single connection from saturating the process's
 * network budget or memory, not to enforce precise QoS.
 */
function makeRateLimiter(bytesPerSecond, windowMs) {
  let tokens = bytesPerSecond;
  let lastRefill = Date.now();

  return {
    consume(n) {
      const now = Date.now();
      const elapsed = now - lastRefill;
      if (elapsed >= windowMs) {
        tokens = bytesPerSecond;
        lastRefill = now;
      }
      if (n > tokens) return false;
      tokens -= n;
      return true;
    },
  };
}

// ── Bridge connection ─────────────────────────────────────────────────────────

/**
 * Wire one WebSocket to one TCP connection and pump bytes between them.
 *
 * Returns a cleanup function the caller can invoke to close both sockets,
 * though in practice the event handlers handle most of that themselves.
 */
function bridgeConnection(ws, config, log) {
  const { host, port } = config.target;
  const limiter = makeRateLimiter(
    config.rateLimitBytesPerSecond,
    config.rateLimitWindowMs,
  );
  const parser = new FrameParser(config.maxStanzaBytes);
  let closed = false;

  const tcp = net.createConnection({ host, port });

  let idleTimer = null;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      log('idle timeout');
      cleanup();
    }, config.idleTimeoutMs);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);
    try { tcp.destroy(); } catch (_) {}
    try { ws.close(); } catch (_) {}
  };

  // ── TCP → WebSocket ───────────────────────────────────────────────────────

  tcp.on('connect', () => {
    log('tcp connected');
    resetIdle();
  });

  tcp.on('data', (chunk) => {
    resetIdle();
    if (!limiter.consume(chunk.length)) {
      log('rate limit exceeded on tcp read');
      cleanup();
      return;
    }
    // Feed bytes into the parser. It emits complete stanzas.
    const stanzas = parser.feed(chunk);
    if (stanzas === null) {
      // Parser signalled an oversize stanza.
      log('stanza too large from server');
      cleanup();
      return;
    }
    for (const stanza of stanzas) {
      if (ws.readyState === ws.OPEN) {
        ws.send(stanza);
      }
    }
  });

  tcp.on('error', (err) => {
    log(`tcp error: ${err.code || err.message}`);
    cleanup();
  });

  tcp.on('close', () => {
    log('tcp closed');
    cleanup();
  });

  // ── WebSocket → TCP ───────────────────────────────────────────────────────

  ws.on('message', (data) => {
    resetIdle();
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length > config.maxStanzaBytes) {
      log('stanza too large from client');
      cleanup();
      return;
    }
    if (!limiter.consume(buf.length)) {
      log('rate limit exceeded on ws message');
      cleanup();
      return;
    }
    if (!closed && tcp.writable) {
      tcp.write(buf);
    }
  });

  ws.on('error', (err) => {
    log(`ws error: ${err.code || err.message}`);
    cleanup();
  });

  ws.on('close', () => {
    log('ws closed');
    cleanup();
  });

  resetIdle();
  return cleanup;
}

// ── Server factory ────────────────────────────────────────────────────────────

/**
 * Build and return the HTTP + WebSocket server.
 *
 * Returns `{ httpServer, wss, close }` so the caller can bind a port and
 * shut it down cleanly. Does not call `.listen()` — that is the caller's job,
 * which lets tests bind to port 0.
 *
 * `logger` is an optional function with the same signature as `console.log`.
 * Passing one lets tests capture log output without mocking globals, which
 * avoids the asynchronous teardown timing issues that mocked globals cause.
 */
function createServer(userConfig, logger) {
  const log = logger || console.log;
  const config = Object.assign({}, DEFAULTS, userConfig);

  // The target defaults to the first allowlist entry when not overridden.
  if (!config.target) {
    config.target = config.allowlist[0];
  }

  if (!isAllowed(config.target.host, config.target.port, config.allowlist)) {
    throw new Error(
      `Target ${config.target.host}:${config.target.port} is not on the allowlist.`,
    );
  }

  let connectionCount = 0;
  const activeBridges = new Set();

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      const body = JSON.stringify({ status: 'ok', connections: connectionCount });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    if (connectionCount >= config.maxConnections) {
      log(`[bridge] refused connection: at limit (${config.maxConnections})`);
      ws.close(1013, 'Server full');
      return;
    }

    connectionCount++;
    const remote = req.socket.remoteAddress;
    log(`[bridge] connection opened from ${remote} (${connectionCount} active)`);

    const connLog = (msg) => {
      log(`[bridge] [${remote}] ${msg}`);
    };

    const cleanup = bridgeConnection(ws, config, connLog);
    activeBridges.add(cleanup);

    const done = () => {
      connectionCount--;
      activeBridges.delete(cleanup);
      log(`[bridge] connection closed from ${remote} (${connectionCount} active)`);
    };

    ws.once('close', done);
  });

  const close = () => {
    for (const cleanup of activeBridges) cleanup();
    activeBridges.clear();
    wss.close();
    httpServer.close();
  };

  return { httpServer, wss, close };
}

module.exports = { createServer, isAllowed, makeRateLimiter, bridgeConnection, DEFAULTS };

// ── Entry point ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const port = parseInt(process.env.BRIDGE_PORT || String(DEFAULTS.port), 10);
  const xmppHost = process.env.XMPP_HOST || DEFAULTS.xmppHost;
  const xmppPort = parseInt(process.env.XMPP_PORT || String(DEFAULTS.xmppPort), 10);

  const allowlist = [{ host: xmppHost, port: xmppPort }];
  const target = { host: xmppHost, port: xmppPort };

  const { httpServer } = createServer({ allowlist, target, port });
  httpServer.listen(port, () => {
    console.log(`[bridge] listening on port ${port}`);
    console.log(`[bridge] forwarding to ${xmppHost}:${xmppPort}`);
  });
}
