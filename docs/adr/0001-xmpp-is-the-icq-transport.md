# XMPP is the ICQ Transport, not OSCAR

ISeekU presents itself as an ICQ client, so the obvious assumption is that it
speaks OSCAR (FLAP/SNAC), the protocol the original ICQ ran on. It does not.
The network we target — icqr.net / "ICQ Reborn" — is a plain XMPP server, and
the classic ICQ concepts are mapped onto XMPP primitives: UIN to JID localpart,
Contact List to roster, Status to `<presence><show>`, Event to stanza.

## Considered Options

**OSCAR against a revival server.** Rejected: icqr.net does not serve OSCAR.
Building an OSCAR stack would produce a client that can talk to nobody, since
the original ICQ network was shut down in 2024 and the surviving OSCAR revivals
are AIM-oriented and would not give us the UIN population we want.

**XMPP.** Accepted: it is what the target server actually speaks, verified live
against `132.145.202.182:5222`. It also means every ICQ feature we build is
reusable against any XMPP server, and the standard XEPs already cover most of
the classic ICQ feature set.

## Consequences

The mapping is lossy in both directions and must be maintained deliberately.
Some ICQ concepts have no XEP (Away Message auto-reply, the Visible/Invisible
list split, Alert-when-online) and are implemented client-side; some XMPP
concepts have no ICQ equivalent (resources, priorities, carbons) and are hidden
from the interface rather than exposed. See `CONTEXT.md` for the vocabulary
this project uses — the interface says "Contact List", never "roster".
