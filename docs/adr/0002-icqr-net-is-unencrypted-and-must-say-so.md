# The icqr.net server is unencrypted, and the interface must say so

Measured live against `132.145.202.182:5222` on 2026-07-31: the server
advertises no STARTTLS and exactly one SASL mechanism, `PLAIN`. Signing in
therefore puts the password, and every Message afterwards, on the wire in
cleartext. We support this server anyway — it is the network our users are on —
but the insecure connection is an explicit, informed choice the Owner makes,
never a silent fallback.

## Consequences

- The connection layer negotiates STARTTLS and SCRAM whenever a server offers
  them, and only degrades to cleartext `PLAIN` for a server the Owner has
  explicitly marked as insecure. A server that *stops* offering TLS between two
  sign-ons is a downgrade attack, and is refused rather than accepted quietly.
- The sign-in screen and the connection status show the transport security
  plainly. An unencrypted Account is visibly marked as such for as long as it
  is signed in — not just once at setup.
- The stored password is encrypted at rest via Electron `safeStorage`, which is
  worth doing even though the wire is cleartext: it protects against file-level
  theft, which is a different attacker than the one on the network path.
- Credentials never reach a log, an error message, a crash report, or the
  renderer process.

## The domain is an IP address

The XMPP domain served by icqr.net is the literal string `132.145.202.182`, so
JIDs take the form `<UIN>@132.145.202.182`. This is worth recording because it
looks like a bug and is not: TLS certificate validation against this name can
never succeed, contact addresses are pinned to one machine, and any future
server migration invalidates every stored JID. The Account record therefore
stores the UIN and the server address as separate fields and composes the JID,
rather than storing the JID as an opaque identity — so a migration is a config
change and not a rewrite of every Contact.
