# ISeekU WebSocket-to-TCP Bridge

## What it is

A small standalone Node.js service that sits between a mobile XMPP client and
the icqr.net server. A browser or Capacitor WebView cannot open a raw TCP
socket — the platform only allows WebSocket. icqr.net speaks raw XMPP over TCP
on port 5222 and offers no WebSocket endpoint. This bridge closes that gap:
WebSocket connections come in from the mobile client, TCP connections go out to
the XMPP server, and XMPP stanzas are forwarded both ways.

## Why it is separate

The bridge is a standalone service, not part of the Electron app. Electron runs
on the desktop and has full TCP access; it does not need the bridge. The bridge
exists only for the mobile path. It has its own `package.json` and must not be
bundled into the Electron build.

## Security warning — passwords pass through in the clear

XMPP SASL PLAIN sends the user's password as a base64 string inside an
`<auth>` stanza. icqr.net uses raw TCP with no TLS. This means every password
that crosses this bridge travels in the clear between the mobile client, the
bridge, and the XMPP server.

**If you run this bridge for other people, their passwords pass through your
machine. You are responsible for what happens to them.** Run the bridge only
for yourself, on hardware you control, on a network you trust. Do not expose it
to the internet without understanding what you are agreeing to.

The bridge logs connection events only. It never logs stanza contents,
usernames, or passwords. That is enforced in the code — but it does not protect
the wire between the client and the bridge, or between the bridge and the server.

## Configuration

All configuration is via environment variables. Defaults are the icqr.net
server.

| Variable | Default | Meaning |
|---|---|---|
| `BRIDGE_PORT` | `5280` | Port the bridge listens on |
| `XMPP_HOST` | `132.145.202.182` | XMPP server IP or hostname |
| `XMPP_PORT` | `5222` | XMPP server port |

The allowlist is set to the configured `XMPP_HOST:XMPP_PORT` only. The bridge
refuses to forward to any other address. This is intentional — an open TCP
relay is an abuse vector.

## Running with Docker

Build the image:

```sh
docker build -t iseeku-bridge .
```

Run it:

```sh
docker run -p 5280:5280 iseeku-bridge
```

Override the target server:

```sh
docker run -p 5280:5280 \
  -e XMPP_HOST=132.145.202.182 \
  -e XMPP_PORT=5222 \
  iseeku-bridge
```

The container exposes a health endpoint at `GET /health` that returns
`{"status":"ok","connections":<n>}`. A container orchestrator can poll this.

## Running the tests

```sh
npm install
npm test
```

## Per-connection limits

The bridge enforces limits per connection to prevent abuse:

- **Max concurrent connections**: 50
- **Idle timeout**: 120 seconds with no data
- **Max stanza size**: 64 KB
- **Rate limit**: 32 KB/s per connection

These are compiled-in defaults. To change them, pass a config object to
`createServer()` when embedding the module programmatically.
