# WhatsApp and Telegram stay, as extra Transports

The project this is forked from is a WhatsApp/Telegram client wearing an ICQ
skin. ISeekU inverts that: the ICQ Transport is the native one, and the
existing WhatsApp and Telegram bridges are kept as *additional* Transports the
Owner may sign in to, appearing as extra Groups in one Contact List. Deleting
them would have been the tidier fork, but they are working code that gives the
ICQ shell a reason to be someone's only messenger — which is the thing that
made ICQ worth using in the first place.

## Consequences

- Nothing in the interface may assume one Account. Contact identity is
  `(Transport, Account, address)`, never a bare UIN, even though the ICQ
  Transport renders it as a bare UIN.
- The Transports have genuinely unequal capabilities. The interface asks a
  Transport what it supports rather than assuming: WhatsApp has no Status set,
  Telegram has no Authorization, neither has an Away Message. Unsupported
  controls are absent, not present-and-broken.
- The WhatsApp bridge drives a headless browser and is heavy. It stays lazy: no
  WhatsApp Account configured means the browser is never downloaded or started,
  and an ICQ-only install carries none of that weight at runtime.
- ICQ features are built against the ICQ Transport first and generalised only
  when a second Transport actually needs them. No abstraction is introduced for
  a Transport that does not yet exist.
