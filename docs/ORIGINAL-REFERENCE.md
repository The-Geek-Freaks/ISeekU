# What the original actually looked like

Reference notes for rebuilding ICQ's interface. Everything here is either
**measured** from an original asset, **verified** against a primary source, or
explicitly marked as **unverified**.

The rule this file exists to enforce: a confident guess is worse than an honest
gap. A wrong colour or a wrong German string that *looks* plausible will
survive into the release; a gap gets filled later.

---

## Colours measured from original assets

Method: the splash screens archived at
`guidebookgallery.org/pics/splashes/icq/` were fetched and read pixel by pixel.
Counts are of fully-opaque pixels.

### The flower — VERIFIED, ICQ 2001b splash

| Part | Colour | Evidence |
|---|---|---|
| Petals | `#00FF00` | 199 px, the dominant saturated colour |
| The one odd petal | `#FF0000` | 47 px |
| Centre | `#FFFF00` | 23 px |
| Shading under the odd petal | `#840000` | 19 px |

Pure 8-bit primaries — which is exactly right for a late-90s Windows
application, and quite unlike a modern brand palette.

**A mistake worth recording.** An earlier version of this project used
`#4DAB27` for the petals and `#FC021E` for the odd one, taken from the
`navbut_colors[]` array in archived icq.com JavaScript from 2006. Those are
real ICQ colours — but they are the *website's*, six years later. The muted
greens made the flower read as 2006 rather than 2001. A brand's website palette
is not its application's palette, and the two must not be mixed.

### Window chrome — VERIFIED

| Colour | Where | Evidence |
|---|---|---|
| `#C0C0C0` | 3D face grey | 9.5% of the ICQ 2000b splash — the Windows 98 system face colour |
| `#FFFFFF` | Highlight edge | dominant in every classic-era splash |

### Per-version splash palettes — measured

| Version | Size | Notable |
|---|---|---|
| 99a beta | 124×100 | `#940063`, `#CE0029`, `#FFFF00` — magenta/red, a different look entirely |
| 2000b beta | 123×123 | `#C0C0C0` grey field — the Win98 look |
| 2001b | 127×117 | Blue radial field `#7895BD`, flower in pure primaries |
| 2002a | 182×46 | Slim bar, grey `#8C8C8C`/`#9F9F9F`, green `#28FF28` |
| 2003a Pro | 182×47 | Light blue `#45B2E9`/`#A4D9F4` — the palette begins shifting |
| 5 Lite | 233×182 | Near-white `#F1F2F3`, blue `#01407F` — a different era already |

The break between 2002a and 2003a is visible in the numbers: the classic era
ends there.

---

## German strings

**The important finding: the early German ICQ was not fully translated.**

The tray menu of the 99b–2001b era stayed in English — "Open ICQ", "Check
Email", "Always on Top", "Auto Minimize". Full German localisation arrived with
ICQ 5, and properly with ICQ 6. So a German-language recreation of the classic
era should *not* translate everything: it would be less faithful, not more.

Primary source for the verified entries: Catweazle's German ICQ tutorial
(`an00716.hp.altmuehlnet.de/icq/i_taskls.htm`, c. 1999–2001), corroborated in
places by ETH Zürich course material from 2000–2001.

### Verified

| English | German | Source |
|---|---|---|
| Away | `abwesend` | "Schaltet Dich auf abwesend" |
| Occupied | `beschäftigt` | "für andere bist Du als 'beschäftigt' zu sehen" |
| Invisible | `unsichtbar` | "Macht Dich für alle anderen User 'unsichtbar'" |
| Online | `online` | "Schaltet Dich auf online" |
| DND | `DND` | kept as the abbreviation in German text |
| Privacy | `Privacy` | English term used inside German prose |
| Contact List | `Kontaktliste` | both sources |
| File transfer | `Dateiübertragung` | ETH Zürich |
| System menu | `System-Menü` | Catweazle |

### Verified as staying English (99b–2001b tray menu)

`Open ICQ` · `Check Email` · `Play Sounds` · `Contact List Popup` ·
`Response Dialog Popup` · `Auto Minimize` · `Always on Top` ·
`Status "Floating" On` · `Preferences`

### Not verified — do not invent

Free For Chat, N/A, the flower-button menu labels, the Add/Find dialog title,
and every Preferences tab label in either era. Where a German string is not in
the verified table above, use English and mark it for later verification. A
plausible-looking wrong translation is worse than an untranslated label,
because nobody will ever go back and check it.

---

## The ProSieben edition — what to leave out

Verified: launched 5 December 2005, built on **ICQ 5**, in partnership with
SevenOne Intermedia GmbH. A Sat.1 edition followed on ICQ 6.

It changed only two things, and both are the things to avoid:

- a ProSieben-branded skin
- the ICQ Welcome Screen, filled with ProSieben.de content — Kino, TV, Games,
  Musik, Wetter, Horoskope — on every start

Functionally it was identical to the ordinary German-patched ICQ 5. Contemporary
German forum posts put it plainly: the ProSieben version had no functional
changes over the patched German release.

**Not the same thing:** "ICQ Pro 2003b" is a version name, released before the
ProSieben deal and English-only. The "Pro" is unrelated to ProSieben.

---

## Sources that did not deliver

Recorded so the same ground is not covered twice:

- GUIdebook has ICQ **splash screens only**. Its `/apps/icq`, `/guis/…/icq/`
  and `/screens/icq/` pages are all 404.
- No German-locale screenshot of a contact list or preferences dialog could be
  confirmed at winfuture.de, chip.de, computerbild.de, netzwelt.de, giga.de,
  heise.de, pcwelt.de, dr-windows.de, WinWorld or oldversion.com.
- The German Wikipedia article on ICQ carries no screenshots.
- icq.de in the Wayback Machine was a thin marketing landing page with no
  interface content.

---

## Evidence from screenshots supplied by the project owner

Thirteen screenshots covering ICQ 2001b, 5, 6, 7, 8, the Mac and mobile
clients, and the skin scene. These close several gaps the research passes could
not — in particular the German strings and the games, neither of which was
retrievable from archives.

### German UI strings — VERIFIED from an ICQ 6 German message window

The earlier research could not find a single German-locale screenshot. One of
these is a German ICQ 6 message window, and it settles several terms:

| German | English | Where |
|---|---|---|
| `Nachrichtensitzung` | Message Session | The window title |
| `Senden per:` | Send via: | Above the send button, with radio buttons |
| `Senden` | Send | The send button |

The window title form is `<contact> - Nachrichtensitzung`, matching the English
`<contact> - Message Session`.

This also confirms the earlier finding that German localisation was thorough by
ICQ 6, unlike the 99b–2001b era where the tray menu stayed English.

### The games — VERIFIED from a contact context menu

The context menu on a contact had a **Launch** section listing:

- **RPS Online** — a board game, not rock-paper-scissors as the name suggests.
  A separate screenshot shows an 8x8 grid of sumo pieces, played against a
  contact.
- **Slide-a-lama**
- **Sumo Volleyball**
- **More…**

Above it, a **Send** section: Send Message, Send SMS, Send File, Push2Talk,
Multi User Chat. Below it, a **User** section: Open Saved Files, User's
Details, Move To Group, Rename, Delete.

This is the authoritative list of what a right-click on a contact offered, and
it is worth rebuilding as the contact context menu.

### ICQ 2001b Services menu — VERIFIED, the full feature surface

The Services button opened a menu with four groups:

**Communication:** My Communication Center · Answering Service · SMS Message ·
ICQphone · Email · Phone "Follow Me" (with Current Location, Set Current
Location, Phone Status, ICQ Phone Center, Phone Directories)

**Directories:** ICQ White Pages · Search The Web

**Communities:** ICQ Topics Directory Bar · Shared Files

**Others:** ICQ Free Info · Newsletter · Translation · ICQMail

**More Features:** Add More Features

The same screenshot shows the main window carried a **Topics** sidebar —
Welcome, Careers, Games, Life&Love, Mobile, Movies&TV, Music, Shopping, Sports,
Tech&Net, Travel — and a translation box at the bottom ("Enter word to
translate"). The buttons under the contact list read *How to Start*, *Add
Features*, *Chat With A Friend*, and the bottom row is *Add/Invite Users*,
*Services*, *My ICQ*, with *Main* and *Online* tabs.

Most of this needed ICQ's server infrastructure and is gone. It is recorded
because it shows how much of the client was a portal rather than a messenger —
which is a design fact worth knowing even where it cannot be rebuilt.

### ICQ 5 layout — VERIFIED

Confirms the classic reconstruction and adds detail: an icon toolbar across the
top, a status dropdown showing the flower and the word "Online", contact rows
with the flower on the left and per-contact capability icons on the RIGHT
(mobile phone, forward arrow, document), a plain "Online" divider line rather
than a filled group band, a "System" row at the bottom, an advertising banner,
and a "Search Google" box at the very bottom.

The message window is the classic split log: sender name in colour with a
timestamp on its own line, then the text. Two different colours for the two
participants — blue and red in the sample.

### ICQ 6 and 7 — VERIFIED additions

- ICQ 6 chat windows were **tabbed**, one tab per conversation.
- A dial pad was docked under the contact list — ICQphone.
- The message window had a left icon rail, avatars for BOTH participants on the
  right, a "tZers" button, and a "Send via:" radio group.
- ICQ 7's contact list showed Facebook contacts as their own group, and
  per-contact network badges.
- Advertising banners were present in both, at the bottom of the chat window.

### Skins were a scene, not a footnote

A German skin site (icq-tools.de) lists dozens of ICQ 7 skins — Hello Kitty,
SpongeBob, Windows Seven, Sheepworld, and so on — with star ratings, alongside
separate sections for ICQ 6 skins, ICQ flower icons, and sound packs.

This is worth recording because it justifies the theme system: skinning was not
a niche feature, it was most of what people did with the client. It also shows
skins changed background imagery, not only colours — which is the gap the
current JSON theme format deliberately does not fill, and the reason a
separate, safe mechanism for user-chosen local images is worth building.

---

## Preferences — VERIFIED from screenshots of the real dialogs

This was the largest remaining gap: no archive search turned up a preferences
dialog in either era, so the settings dialog was built from what the client
could actually do rather than from the original's structure. These screenshots
settle it.

### The eight Statuses — the exact labels

The status menu, verified from two separate screenshots:

| Label as ICQ wrote it | What this project currently calls it |
|---|---|
| `Available/Connect` | Online |
| `Free For Chat` | Free For Chat ✓ |
| `Away` | Away ✓ |
| `N/A (Extended Away)` | N/A |
| `Occupied (Urgent Msgs)` | Occupied |
| `DND (Do not Disturb)` | DND |
| `Privacy (Invisible)` | Invisible |
| `Offline/Disconnect` | Offline |

The parenthetical halves are not decoration — they are the explanation. "Urgent
Msgs" tells you Occupied still lets urgent messages through, which is exactly
the distinction from DND that the bare word loses.

### The idle rules — one of them is not what it looks like

From the classic Owner Prefs, Status tab:

- Automatically set **Away** when the screen saver is activated
- Automatically set **Away** after `N` minutes of *not using the computer*
- Automatically set **N/A** after `N` minutes **of Away**
- Show messages in tray in all status modes
- Disable "Online Alert" messages in Away, DND, N/A and Occupied

**The N/A threshold counts from when Away began, not from the last activity.**
Defaults seen: Away after 2 minutes, N/A after 5 minutes *of Away*. This
project currently treats both as absolute idle time, which is wrong.

The same tab held the per-status default away message, with a **Presets**
dropdown and a *Rename Presets* button — one canned message per status,
editable and named. One German screenshot shows a DND preset reading
"Ich will jetzt nicht gestört werden".

### Classic-era Owner Preferences — the page list

Down the left, with icons:

Contact List · Miscellaneous · Status Mode · Connections · Alerts and
Notifications · Shortcut Bar · Edit Launch List · Voice Message · File
Transfer · URL Messages · Old Friends Invitation · SMS Messages · Email
Preferences · ICQ Email Import

An earlier variant also shows *Invite Old Friends / Associations*.

Buttons along the bottom: **Web Information**, **Restore ICQ Defaults**, then
**OK / Cancel / Apply**.

The Connections page carried four tabs — General, **Server**, Firewall, User —
with the ICQ server host and port (`login.icq.com`, `5190`), *Auto Configure*
and *Reset* buttons, proxy settings (Not using Firewall / Using Firewall, with
SOCKS 4, SOCKS 5 or HTTPS), and a **Keep connection alive** checkbox.

An older tabbed layout put everything across the top instead: Internet
Phone/Games/Chat · Servers · Connection · Random Chat · Telephone, and below
that Contact List · Events · Status · Accept · E-Mail · Check E-Mail.

### ICQ 6/7 Options — the page list

Grouped, down the left:

- **Customization:** General · Tweak my ICQ · Notifications · Messages & Files
- **Privacy & Security:** Privacy · Privacy Lists · History
- **Advanced:** Connection · SMS & Phone · Advanced

The General page:

- Open ICQ on startup · ICQ always on top · Show "Welcome Screen" when ICQ starts
- Contact List: remember web search history; what a double-click does —
  *Open a message* or *Start a call*
- Status Options: show me as Away after `N` minutes · show me as N/A after `N`
  minutes · **show me as Occupied when running full-screen applications** ·
  block notifications and auto-reply invitations when Occupied · forward
  messages to my mobile when N/A or offline

The full-screen rule is a good idea that predates every "do not disturb while
presenting" feature by a decade.

### ICQ 8 Settings — the page list

- **Customization:** Tweak my ICQ · Status · Contact list · My Networks
- **Messaging:** Messages · SMS · File transfer · History · Audio & Video
- **Advanced:** Sign in · Privacy · Connection

Audio & Video listed camera, microphone and speaker pickers each with a
*Check* link, plus: play a ringtone on incoming call · notify about incoming
calls · receive calls from contacts not in the contact list · save call
history.

### ICQ 7 Preferences — tabs across the top

Connection · Messages · Contact list · Privacy · General · Notifications ·
Voice and video · Language · **Accounts**

The Accounts page is the interesting one: it connected Facebook, Google Talk,
Google Mail, Yahoo, Odnoklassniki and VKontakte into one contact list. That is
the same idea this project inherited as the WhatsApp and Telegram tabs — ICQ
got there first.

### Per-contact Alert/Accept Modes — VERIFIED from an ICQ 99 context menu

A submenu on each contact, which is a finer-grained privacy model than most
modern messengers have:

- **User Alerts:** Sound Events · Online Alert · Contact List Popup
- **Auto:** Auto Accept Chat · Auto Add URL · Auto Receive File
- **Accept:** Accept In DND · Accept In Occupied · Accept In N/A · Accept In Away
- **Online Status:** Away To User · Invisible To User · Visible To User ·
  Access To File Server

"Accept In DND" per contact means specific people could reach you through Do
Not Disturb. That is worth rebuilding — it is the thing every modern messenger
fails to offer.

### German strings — more, from a Kopete screenshot

Kopete is not ICQ, so these are a third-party translation rather than ICQ's
own, and are marked accordingly. They are still useful as evidence of the
vocabulary German users had for these concepts:

`Autorisierung erforderlich, bevor jemand Sie zu seiner Kontaktliste
hinzufügen kann` · `IP-Adresse ausblenden` · `Verbindungseinstellungen` ·
`Einstellungen zur Privatsphäre` · `Direktverbindungs-Einstellungen` ·
`Zeitüberschreitung nach (Sekunden)` · `Standardkodierung für Nachrichten`

The last one is a reminder that this era predated universal UTF-8 — the default
was `Windows-1252 Westeuropäisch`.
