# Mobile is Capacitor over a self-hosted bridge, and ISeekU ships no bridge

Electron cannot run on Android or iOS. The Electron main process is a Node.js
runtime; neither mobile operating system will start one. The only way to run the
ISeekU React interface on a phone is to embed it in a native wrapper that
provides a WebView — which is what Capacitor does. Capacitor takes the compiled
`build/` directory, drops it into a thin Android or iOS project, and exposes a
small plugin bridge for device APIs. The web code runs unchanged; only the
transport layer must adapt.

## The transport problem

The desktop client opens a raw TCP socket to `132.145.202.182:5222`. Mobile
JavaScript has no raw socket API. WebSocket is the only network transport
available inside a mobile WebView, and the icqr.net server offers no WebSocket
endpoint — it is a plain XMPP server that speaks only the TCP stream protocol.

A bridge is therefore required: a process outside the app that accepts WebSocket
connections and forwards the bytes to port 5222 as TCP. From the server's point
of view the connection is indistinguishable from any other XMPP client. The
bridge is a WebSocket-to-TCP proxy. `websockify` is a working example; any
equivalent tool does the job.

## The security problem

The icqr.net server offers no STARTTLS and only PLAIN authentication — this is
recorded in `docs/adr/0002-icqr-net-is-unencrypted-and-must-say-so.md`. The
bridge sits on the path between the app and the server and therefore sees every
byte of the session: the SASL PLAIN password, every Message, every Presence
update, in cleartext. This is the same exposure as the desktop TCP connection
— the network path is unencrypted either way — but the bridge adds a new party
to that path.

Running a shared public bridge for strangers is a bad idea. The operator of
such a bridge would hold the SASL PLAIN passwords of every person who used it.
There is no cryptographic way to operate a TCP-proxy bridge while remaining
blind to the cleartext passing through it. The risk to users would be real and
would be invisible to them.

**ISeekU therefore ships no bridge.** The Owner who wants to use ISeekU on
mobile runs their own bridge on a machine they control — their home server,
their own VPS — for their own use. The instructions are in `mobile/README.md`.

## Considered options

**Capacitor with a self-hosted bridge.** Accepted. Capacitor is the only
production-grade WebView wrapper that works for both Android and iOS from a
JavaScript build. The bridge requirement is real and unavoidable given the
server's capabilities; making the Owner responsible for running it is the honest
answer to the trust problem.

**A WebSocket endpoint on icqr.net.** Rejected: we do not operate the server
and have no evidence that the operators plan to add one. Building the client
around a feature that does not exist and that we cannot add would mean the
mobile path works for nobody.

**React Native.** Rejected: the application is written in React for a DOM.
Rewriting it for React Native's non-DOM component model would discard a large
body of working code and require maintaining two diverging UIs. The benefit
does not justify the cost when Capacitor can embed the existing build as-is.

**A WebRTC data channel.** Rejected: WebRTC peers must first find each other
through a signalling server, and the signalling server would itself be a bridge.
The problem is not solved, only hidden one layer deeper.

## Consequences

- The `src/transport/websocket.js` module implements RFC 7395 XMPP-over-WebSocket
  with the same security posture as `icq-auth-policy.js`: a `ws://` connection
  is refused unless the Owner accepts it explicitly, every session, and a server
  that previously offered `wss://` and drops to `ws://` is refused outright.
- The `mobile/` directory holds `capacitor.config.json` and `package.json` for
  the Capacitor shell. The generated `android/` and `ios/` native projects are
  excluded from the repository; they are derived artefacts.
- Nothing about the React application changes for mobile. Capacitor's WebView
  runs the same build that is already tested on desktop.
- The Owner who wants to use ISeekU on mobile must run a bridge they control.
  The README is honest about this and about what the bridge can see.
