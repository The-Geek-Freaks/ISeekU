# ISeekU

A desktop instant messenger that recreates the ICQ 5/6 experience — the numeric
identity, the contact list, the status set, the event model — on top of modern
transports. The classic ICQ vocabulary is the domain language; the wire protocol
underneath it is an implementation detail.

## Language

### Identity

**UIN**:
The numeric identifier that names a person on the ICQ network. Permanent, owned
by the person, and the primary way contacts are found and added.
_Avoid_: user ID, username, JID, handle, account number

**Owner**:
The person using this installation, viewed as the subject of their own contact
list. The Owner has a UIN, a status, User Details, and privacy lists.
_Avoid_: me, self, current user, local user

**Account**:
A single set of credentials the Owner is signed in with, bound to one Transport.
An installation may hold several Accounts at once.
_Avoid_: profile, login, session, connection

**Transport**:
A network the Owner can hold an Account on. ISeekU speaks the ICQ Transport as
its native one and treats WhatsApp and Telegram as additional Transports.
_Avoid_: protocol, backend, provider, bridge, service

### Contacts

**Contact**:
Another person, identified by UIN, that the Owner has placed on their Contact
List. A Contact carries a Nickname, a Group, a Presence, and User Details.
_Avoid_: buddy, friend, peer, roster item

**Contact List**:
The Owner's ordered set of Contacts, grouped and stored on the server so it
follows the Owner between installations.
_Avoid_: roster, buddy list, friends list

**Group**:
A named, collapsible partition of the Contact List. Every Contact belongs to
exactly one Group; the default is "General".
_Avoid_: folder, category, label, tag

**Not In List**:
The holding area for someone who has messaged the Owner without being on the
Contact List. They are visible for the duration of the conversation and are
either added or discarded.
_Avoid_: unknown sender, stranger, temporary contact

**Nickname**:
The short display name the Owner assigns a Contact locally. It overrides
whatever name the Contact publishes about themselves.
_Avoid_: alias, display name, label

**Authorization**:
A Contact's permission for the Owner to see their Presence. Requesting it,
granting it, and refusing it are distinct acts, each of which is an Event.
_Avoid_: subscription, friend request, follow, approval

### Presence

**Presence**:
What the Contact List shows about a person's availability right now: their
Status, their Status Text, and — when they are Offline — their Last Seen.
_Avoid_: online state, availability, activity

**Status**:
One of the fixed ICQ availability values: Online, Free For Chat, Away,
N/A, Occupied, DND, Invisible, Offline. The set is closed; it is not
extended with new values.
_Avoid_: state, mode, presence type

**Status Text**:
The free-text line the Owner attaches to their Status ("in a meeting", "Just
Vibing"). Visible to anyone who can see the Owner's Presence.
_Avoid_: status message, custom status, mood, tagline

**Away Message**:
The canned reply automatically returned to anyone who messages the Owner while
they are Away, N/A, Occupied, or DND. Distinct from Status Text: Status Text is
displayed, an Away Message is sent.
_Avoid_: auto-reply, autoresponder, vacation message

**Last Seen**:
How long ago an Offline Contact was last connected.
_Avoid_: last activity, idle time, last online

**Idle**:
The Owner having gone untouched at the keyboard long enough that ISeekU changes
their Status on their behalf.
_Avoid_: inactive, AFK, auto-away

### Privacy

**Privacy List**:
One of the three lists that override normal Presence and delivery rules for
specific Contacts: the Visible List, the Invisible List, and the Ignore List.
_Avoid_: blocklist, allowlist, filters, privacy rules

**Visible List**:
The Contacts who continue to see the Owner as Online even while the Owner's
Status is Invisible.
_Avoid_: whitelist, always-visible, exceptions

**Invisible List**:
The Contacts to whom the Owner always appears Offline, whatever the Owner's
actual Status.
_Avoid_: blacklist, hidden-from, blocked

**Ignore List**:
The Contacts whose Events are silently discarded on arrival — never shown,
never sounded, never counted as unread.
_Avoid_: muted, blocked, banned, spam list

### Events

**Event**:
Anything that arrives from another person and demands the Owner's attention: a
Message, an Authorization request, a File Transfer offer, a Contacts Event, a
URL Event. Events queue against a Contact and drive the blinking icon.
_Avoid_: notification, incoming item, activity, alert

**Message**:
A single delivered line of conversation, from one person to another, at one
moment. The unit the History is made of.
_Avoid_: chat, text, DM, IM

**Offline Message**:
A Message accepted by the server while its recipient was Offline and delivered
in full, with its original timestamp, when they next sign on.
_Avoid_: queued message, stored message, pending message

**Delivery Receipt**:
The sender-side confirmation that a Message reached the recipient's client.
_Avoid_: read receipt, ack, checkmark, seen

**Typing Notification**:
The live signal that the person on the other end is composing a Message.
_Avoid_: is-typing, composing indicator, presence of activity

**URL Event**:
A web address sent as an Event in its own right, carrying an optional
description, rather than as text inside a Message.
_Avoid_: link message, shared link

**Contacts Event**:
One or more Contacts sent to another person as a transferable list, so they can
add them without typing UINs.
_Avoid_: contact share, vcard send, referral

**Multi-Send**:
Composing one Message once and delivering it to several Contacts as separate
private conversations — not as a group chat.
_Avoid_: broadcast, mass message, group send

**Broadcast**:
An announcement pushed by the server operator to every Account on the network,
shown once at sign-on.
_Avoid_: system message, announcement, MOTD, admin message

**Alert**:
A standing request to be told, distinctly, the moment a specific Contact stops
being Offline.
_Avoid_: online notification, watch, subscribe, ping me

### Conversation

**Chat Window**:
The per-Contact window where the conversation is read and written. Its classic
layout puts received text above and the compose area below, split.
_Avoid_: conversation view, thread, chat pane

**History**:
The Owner's local, permanent, searchable record of every Message exchanged with
a Contact, kept independently of whatever the server retains.
_Avoid_: archive, log, transcript, backlog

**Unread**:
Events that have arrived for a Contact and not yet been opened. Drives the
blinking Contact List icon and the flashing tray icon.
_Avoid_: badge, pending, new count

**Emoticon**:
A pictured face substituted for a text code (`:)`, `;-)`) as a Message is
rendered. The set is delivered by the server, so it changes without a new
release.
_Avoid_: emoji, smiley, sticker, reaction

### Files and details

**User Details**:
The self-published profile behind a UIN — name, email, homepage, birthday,
location, interests, about — that any Contact may look up.
_Avoid_: profile, vCard, bio, user info, card

**Avatar**:
The small picture a person publishes as part of their User Details, shown in
the Chat Window and on their card.
_Avoid_: profile picture, photo, icon, display picture

**File Transfer**:
Sending a file to a Contact: offered, then accepted or refused, then
transferred, with progress the Owner can watch and cancel.
_Avoid_: upload, attachment, file share, send file

### Finding people

**Search**:
Looking up people who are not on the Contact List — by UIN directly, or by
detail such as name or email.
_Avoid_: directory lookup, discovery, find user, people search

**Random Chat**:
Being paired with a stranger who has opted into the same interest group.
_Avoid_: random match, roulette, stranger chat
