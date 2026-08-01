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
