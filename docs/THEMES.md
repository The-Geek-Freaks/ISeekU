# Making a theme

A theme is one JSON file. Drop it in the themes folder and it appears in the
skin list next to the built-in ones — no rebuild, no restart of anything but
the app.

Open the folder from **ICQ → Preferences**, or find it yourself:

| | |
|---|---|
| Windows | `%APPDATA%\ISeekU\themes\` |
| Linux | `~/.config/ISeekU/themes/` |
| macOS | `~/Library/Application Support/ISeekU/themes/` |
| Portable build | `ICQ-Data\themes\` next to the executable |

## The file

```json
{
  "id": "midnight",
  "name": "Midnight",
  "swatch": "#5A7EA8",
  "vars": {
    "--icq-bg": "#101820",
    "--icq-bg-mid": "#18222C",
    "--icq-text": "#E0E6EC",
    "--icq-text-dim": "#7A8894",
    "--icq-teal": "#5A7EA8",
    "--icq-online": "#4CAF50",
    "--icq-list-avatar-display": "none"
  }
}
```

- **`id`** — lowercase letters, digits and hyphens. It cannot be the id of a
  built-in skin; a theme is not allowed to quietly replace one.
- **`name`** — what the menu shows, up to 60 characters.
- **`swatch`** — the colour dot beside the name. Optional.
- **`vars`** — the properties below. Anything you leave out is filled in from
  your background colour, so a theme cannot end up half-wearing the skin that
  was applied before it.

## The properties

| Property | What it colours |
|---|---|
| `--icq-bg` | Window chrome, panels, toolbars |
| `--icq-bg-mid` | The contact list and message areas |
| `--icq-bg-light` | Hovered rows |
| `--icq-text` | Contact names, message text |
| `--icq-text-dim` | Status lines, timestamps, counts |
| `--icq-teal` | The main accent |
| `--icq-teal-dark` / `--icq-teal-light` | Its darker and lighter forms |
| `--icq-header-grad1` / `--icq-header-grad2` | The owner strip gradient |
| `--icq-header-bg` | The whole gradient, if you want to write it yourself |
| `--icq-border` / `--icq-border-light` | Dark and light edges |
| `--icq-online` `--icq-away` `--icq-offline` `--icq-dnd` | Status colours |
| `--icq-btn-bg` `--icq-btn-hover` `--icq-btn-active` | Buttons |
| `--icq-input-bg` | Text fields |
| `--icq-bubble-me` / `--icq-bubble-me-border` | Your own messages |
| `--icq-avatar-bg` | Behind an avatar with no picture |
| `--icq-yellow` `--icq-white` | Odd accents |
| `--icq-list-avatar-display` | `none` or `flex` — whether the contact list shows photographs |

## What a value may be

Colours (`#fff`, `#ffffff`, `rgb(…)`, `rgba(…)`, `hsl(…)`, `hsla(…)`),
gradients (`linear-gradient(…)`, `radial-gradient(…)`), and the keywords
`none`, `flex`, `block`, `inline`, `inline-block`, `transparent`,
`currentColor`, `inherit`, `initial`, `unset`.

**Not images, and not `url(...)`.** This is a deliberate restriction rather
than an oversight. A CSS value is not inert: `url(https://example/pixel.png)`
fetches when the property is used, so a theme containing one would report
every launch to whoever wrote it — and `--icq-avatar-bg` is exactly the kind of
property someone would expect to hold an image. Values are therefore allowed by
shape, not blocked by pattern, because the set of things CSS can be talked into
is not something anyone can enumerate.

A value that is not allowed is dropped and the rest of the theme still loads.
The reason goes into the startup log:

| | |
|---|---|
| Windows | `%TEMP%\icq-startup.log` |
| Linux / macOS | `/tmp/icq-startup.log` |

## Beyond colours

Row heights, fonts, borders and bevels are not variables — the two built-in
eras differ by far more than colour, and a 16-pixel Windows 98 row cannot be
turned into a 31-pixel ICQ 7 row by recolouring it. Those live in
`src/skins/icq99.css` and `src/skins/icq78.css`.

A JSON theme therefore recolours whichever of those two shapes is active. If
you want a different shape as well, copy one of those stylesheets and open a
pull request — that is a skin, not a theme, and it is welcome.

## Importing a skin made for ICQ Lite 5

People made thousands of skins for ICQ 5, and the archives are still up —
[skinbase.org](https://skinbase.org/skins/internet/icq) and
[murb.com](https://www.murb.com/index.php?page_id=550) between them hold most
of what survived. Drop a `.skn` file into the same `themes/` folder as a JSON
theme and it appears in the skin list alongside the built-in ones.

### What a `.skn` file actually is

An OLE Compound File — Microsoft Structured Storage, the same container format
as a `.doc` — holding one stream called `SkinData`. That stream is the
serialised widget tree ICQ 5 drew its window from: every panel, button and
label, each with its rectangle, its anchors, its bitmaps and its colours.
Records are `<u32 tag><u32 length><payload>`, where tag 10 is a length-prefixed
UTF-16 string and tag 7 with length 3 is a raw RGB triple. A colour record
follows the name of the property that owns it, which is what makes the palette
recoverable without modelling the whole tree.

### What comes across, and what does not

| | |
|---|---|
| Colours | Yes — `m_PanelColor` becomes the window chrome, `m_BackColor` the content surface, `m_ForeColor` and `m_PanelTextColor` the text. The most saturated remaining colour becomes the accent, so a skin's signature colour survives instead of everything arriving grey. |
| Name and author | Yes. Where the embedded name is an editor default (`Form`, `Default Skin`), the filename is used instead — it is what the author actually chose. |
| Bitmaps | **No.** ICQ 5 stored them per widget, positioned absolutely against a fixed window layout that this client does not have. Carrying them across would mean recreating ICQ 5's exact geometry. |
| Fonts | Only when the skin set them. Most inherited the system font and leave the `LOGFONT` structure zeroed. |

So an imported skin is recognisably that skin's *colour scheme*, not a pixel
copy. The interface says as much when importing, rather than implying
otherwise.

### Security

A `.skn` is untrusted input downloaded from a twenty-year-old archive, so the
parser refuses rather than guesses: every offset is bounds-checked, every
length capped, sector chains that loop are rejected instead of followed, and a
malformed file returns an error rather than throwing.

The converted skin then goes through exactly the same `toSkin()` validation as
a hand-written JSON theme. The import is not a way around the CSS rules above —
it produces plain hex colours and nothing else.
