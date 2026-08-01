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
