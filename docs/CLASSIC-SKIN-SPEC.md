Grep confirms: `.icq-titlebar` is defined only in CSS, never rendered in JSX. `window:minimize/maximize/close` not present in src/. Native frame is already active — no renderer surgery needed.

Now the spec:

---

# ISeekU — Classic ICQ Skin Specification

## 1. Visual Reference Decision

**Canonical target:** ICQ 2001b, v5.18 Build #3659, released November 28 2001.

Rationale: 2001b is the peak of the classic era — OSCAR TCP stable, modular installer shipped, sound scheme finalized. It predates the 2002a redesign that introduced the bottom search bar and the 2003+ gradient overhaul. The 2001b splash screen (guidebookgallery.org) provides primary-source pixel measurements that override all web-era secondary sources.

**Version scope:** The skin must be visually indistinguishable from ICQ running on Windows 98 SE or Windows 2000 with default Win32 system colors. ICQ 99a through 2001a are acceptable prior art for features missing from 2001b documentation.

**What is not the target:** ICQ 5.1 (released 2004 on Windows XP Luna). All XP-era colors (`#ECE9D8`, `#0A246A` gradient, Tahoma-only, rounded menus) must be removed.

---

## 2. Native Frame

### Current state (verified by reading `electron/main.js`)

Both windows already have `frame: true`:

```
// Contact list — line 185
frame: true,
width: 270,
height: 580,

// Chat window — line 220
frame: true,
```

No `titleBarStyle`, no `titleBarOverlay`. The OS Win32 frame is already active.

### What to remove

**`src/skins/icq5.css`** — lines 218–235: `.icq-titlebar` and `.icq-titlebar[data-inactive='true']` CSS rules. These are dead definitions (Grep confirms no JSX renders `.icq-titlebar`). Delete them when migrating to `icq99.css` — do not port them forward.

**`src/themes.css`** — line 36: `--icq-titlebar-bg` custom property. Delete this line; the OS paints the title bar, React does not.

**IPC endpoints in `electron/main.js`** — lines 589–594: `window:minimize`, `window:maximize`, `window:close` handlers are unused (no renderer calls found). Leave them — they are harmless and may be needed by future settings dialogs. Do not delete.

**No React component changes needed for frame.** There is no custom title bar component in JSX.

### Window title

`main.js` line 195 sets `title: 'ISeekU'`. Classic ICQ displayed `ICQ — <UIN>` in the OS title bar. Update to `title: `ICQ — ${uin}`` once UIN is available at window-create time, or keep `'ISeekU'` if UIN is not available at that point. This is cosmetic only.

---

## 3. Design Tokens

New skin id: **`icq99`**. New CSS file: **`src/skins/icq99.css`**.

### 3.1 Win98 system color palette

All values are Windows 98 SE `GetSysColor()` return values at default theme. These are the authoritative source — not GIF pixel measurements, which are dithering artifacts of these same values.

```
COLOR_3DFACE / BTNFACE:        #C0C0C0   ← window chrome, button faces, group headers
COLOR_3DHIGHLIGHT / BTNHIGHLIGHT: #FFFFFF ← bevel light edge
COLOR_3DSHADOW / BTNSHADOW:    #808080   ← bevel dark edge
COLOR_3DDKSHADOW:              #000000   ← outermost bevel dark edge
COLOR_3DLIGHT:                 #DFDFDF   ← inner bevel light (interpolated; not standard Win98)
COLOR_WINDOW:                  #FFFFFF   ← listbox, edit control backgrounds
COLOR_WINDOWTEXT:              #000000   ← text on WINDOW backgrounds
COLOR_BTNTEXT:                 #000000   ← text on BTNFACE backgrounds
COLOR_HIGHLIGHT:               #000080   ← selected item background
COLOR_HIGHLIGHTTEXT:           #FFFFFF   ← selected item text
COLOR_GRAYTEXT:                #808080   ← disabled text
COLOR_CAPTIONTEXT:             #FFFFFF   ← title bar text (OS-drawn, not relevant to React)
```

### 3.2 ICQ flower palette (verified from 2001b splash screen and GIF pixel analysis)

```
--icq-flower-green:        #00FF00   VERIFIED — 2001b splash, 79px in client.gif index 10
--icq-flower-red:          #FF0000   VERIFIED — 2001b splash, 249px in client.gif index 6
--icq-flower-yellow:       #FFFF00   VERIFIED — 2001b splash, 254px in client.gif index 8
--icq-flower-yellow-dark:  #848400   VERIFIED — client.gif index 7, 71px (shadow under centre)
--icq-flower-purple:       #840084   VERIFIED — client.gif index 14, 784px (icon outline/shadow)
```

Note: `#C6BDBD` (42.8% of client.gif) and `#C6C6C6` (30.6%) are both GIF dithering artifacts of `#C0C0C0`. Neither is a skin token — use `#C0C0C0` directly.

Note: `contact_list.gif` from tripod.com has dominant color `#E7E7E7` and title bar `#183173` — this is Windows XP, not Win98/2000. All measurements derived from that source are SUSPECT. Do not use.

### 3.3 Complete CSS custom property set for `icq99` skin entry in `skins.js`

```javascript
{
  id: 'icq99',
  name: 'ICQ Classic (99–2002)',
  swatch: '#00FF00',
  vars: {
    // ── Chrome ──────────────────────────────────────────────────────
    '--icq-bg':           '#C0C0C0',  // win98 BTNFACE — panel/chrome background
    '--icq-bg-mid':       '#FFFFFF',  // WINDOW — contact list area, edit controls
    '--icq-bg-light':     '#DFDFDF',  // inner bevel light (approximated)
    '--icq-teal':         '#00FF00',  // ICQ green — primary accent
    '--icq-teal-dark':    '#008400',  // VERIFIED from client.gif index 9 (3px, shadow)
    '--icq-teal-light':   '#84FF00',  // ESTIMATED — lighter green for hover states
    // ── Title bar (OS-drawn — these vars used only for chat header band) ──
    '--icq-header-grad1': '#000080',  // Win98 active caption start — solid navy
    '--icq-header-grad2': '#1084D0',  // Win98 active caption end — lighter blue
    '--icq-header-bg':    '#000080',  // single solid color for non-gradient contexts
    // ── Text ────────────────────────────────────────────────────────
    '--icq-yellow':       '#FFFF00',  // VERIFIED flower centre
    '--icq-white':        '#FFFFFF',
    '--icq-text':         '#000000',  // COLOR_BTNTEXT / WINDOWTEXT
    '--icq-text-dim':     '#808080',  // COLOR_GRAYTEXT
    // ── Borders / bevels ────────────────────────────────────────────
    '--icq-border':       '#808080',  // COLOR_3DSHADOW — sunken control edge
    '--icq-border-light': '#FFFFFF',  // COLOR_3DHIGHLIGHT — raised control edge
    // ── Status accent colours ────────────────────────────────────────
    '--icq-online':       '#00FF00',  // VERIFIED
    '--icq-away':         '#FFD700',  // ESTIMATED — golden yellow
    '--icq-offline':      '#808080',  // ESTIMATED — grey dimmed flower
    '--icq-dnd':          '#FF0000',  // VERIFIED
    // ── Interactive controls ─────────────────────────────────────────
    '--icq-btn-bg':       '#C0C0C0',  // BTNFACE
    '--icq-btn-hover':    '#D4D0C8',  // ESTIMATED — slight lighten on hover
    '--icq-btn-active':   '#A0A0A0',  // ESTIMATED — slight darken on press
    '--icq-input-bg':     '#FFFFFF',  // COLOR_WINDOW
    // ── Chat window (log, not bubbles) ───────────────────────────────
    '--icq-bubble-me':        '#FFFFFF',
    '--icq-bubble-me-border': '#808080',
    // ── Contact list avatars ─────────────────────────────────────────
    '--icq-avatar-bg':             '#C0C0C0',
    '--icq-list-avatar-display':   'none',  // authentic — no avatars in contact list
  },
}
```

### 3.4 Additional tokens defined only in `icq99.css` (not in skins.js vars)

These are structural; skins.js handles colors only.

```css
/* Typography */
--icq-font:        'MS Sans Serif', Tahoma, Geneva, sans-serif;
--icq-font-size:   11px;   /* 8pt at 96dpi — VERIFIED via MSDN Win98 HIG */
--icq-line-height: 13px;

/* Metrics */
--icq-row-h:           16px;   /* contact row height */
--icq-group-h:         16px;   /* group header height */
--icq-icon:            16px;   /* status flower — VERIFIED from ICQ Plus skin spec (16x16) */
--icq-scrollbar:       16px;   /* Win98 SM_CXVSCROLL default */
--icq-contact-indent:  20px;   /* left edge to icon start */
--icq-bottombar-h:     22px;   /* bottom button bar */

/* Bevel helpers */
--icq-raised-border:   #FFFFFF #808080 #808080 #FFFFFF;  /* top right bottom left */
--icq-sunken-border:   #808080 #FFFFFF #FFFFFF #808080;
```

---

## 4. Component-by-Component Respec

### 4.1 `src/skins.js`

Two changes:

1. Add the `icq99` skin object (vars in section 3.3 above) as the **first** entry in the `SKINS` array.
2. Change `DEFAULT_SKIN_ID` from `'icq5'` to `'icq99'`.

The `icq5` skin entry stays in the array — do not delete it. Users who have `localStorage.setItem('icq-skin', 'icq5')` will continue to get XP Luna. Users with no saved preference get `icq99`.

### 4.2 `src/skins/icq99.css` (new file — replaces `icq5.css` as active skin)

Full structural spec for the CSS file. Key rules:

**Root scope** — everything inside `:root[data-skin='icq99']`.

**Global reset for this skin:**
```css
:root[data-skin='icq99'] * {
  box-sizing: border-box;
  font-family: var(--icq-font);
  font-size: var(--icq-font-size);
  line-height: var(--icq-line-height);
}
```

**Bevel system (reusable helpers via `@layer` or plain classes):**

```css
/* Raised panel — win98 button/panel surface */
:root[data-skin='icq99'] .icq-raised {
  background: var(--icq-bg);
  border: 1px solid;
  border-color: #FFFFFF #808080 #808080 #FFFFFF;
  box-shadow: inset -1px -1px 0 #000000;
}

/* Sunken inset — edit controls, listboxes */
:root[data-skin='icq99'] .icq-sunken {
  background: var(--icq-bg-mid);
  border: 1px solid;
  border-color: #808080 #FFFFFF #FFFFFF #808080;
  box-shadow: inset 1px 1px 0 #000000;
}
```

Note: `box-shadow: inset -1px -1px 0 #000000` adds the outer dark edge (COLOR_3DDKSHADOW) that Win98 draws as a second pixel outside the shadow edge. The 1px border handles the primary bevel; box-shadow handles the outermost hard edge.

**Contact list container** (`.icq-contactlist`):
```css
:root[data-skin='icq99'] .icq-contactlist {
  background: var(--icq-bg-mid);   /* WINDOW white */
  border: 1px solid;
  border-color: #808080 #FFFFFF #FFFFFF #808080;  /* sunken */
  box-shadow: inset 1px 1px 0 #000000;
  overflow-y: scroll;              /* always-visible Win98 scrollbar */
  overflow-x: hidden;
  scrollbar-width: 16px;           /* non-standard; actual scrollbar is OS-painted */
}
```

**Group headers** (`.icq-group`):
```css
:root[data-skin='icq99'] .icq-group-header {
  height: var(--icq-group-h);          /* 16px */
  display: flex;
  align-items: center;
  padding: 0 2px;
  background: var(--icq-bg);           /* #C0C0C0 — same as chrome */
  color: var(--icq-text);
  font-weight: bold;
  user-select: none;
  cursor: default;
}

:root[data-skin='icq99'] .icq-group-arrow {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 3px;
  border: 1px solid #808080;
  background: #FFFFFF;
  font-size: 9px;
  line-height: 7px;
  text-align: center;
  color: #000000;
  flex-shrink: 0;
}
/* Group count: .icq-group-count — no special treatment, same font */
```

The collapse arrow is a Win32-style tree control button: white fill, 1px grey border, `+` or `−` glyph in system font. This matches ICQ 2001b's group expand widget exactly.

**Contact rows** (`.icq-contact`):
```css
:root[data-skin='icq99'] .icq-contact {
  height: var(--icq-row-h);          /* 16px */
  display: flex;
  align-items: center;
  padding: 0 2px 0 var(--icq-contact-indent);  /* 20px left */
  background: var(--icq-bg-mid);
  color: var(--icq-text);
  cursor: default;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
}

:root[data-skin='icq99'] .icq-contact:hover {
  background: var(--icq-selected-bg, #000080);
  color: var(--icq-selected-fg, #FFFFFF);
}
/* Note: add --icq-selected-bg and --icq-selected-fg to skins.js vars */

:root[data-skin='icq99'] .icq-contact-name {
  flex: 1;
  overflow: hidden;
  text-overflow: clip;   /* Win98 had no ellipsis — it just clipped */
}

:root[data-skin='icq99'] .icq-status-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-right: 3px;
  margin-left: -18px;    /* pull icon before name — adjust based on layout */
  position: relative;
}

/* Offline contacts: dimmed name */
:root[data-skin='icq99'] .icq-contact[data-status='offline'] .icq-contact-name,
:root[data-skin='icq99'] .icq-contact[data-status='invisible'] .icq-contact-name {
  color: var(--icq-text-dim);
}

/* Unread message indicator */
:root[data-skin='icq99'] .icq-contact-unread {
  font-weight: bold;
  /* Classic ICQ flashed the contact name — use the blink animation from icq5.css */
}
```

**Buttons** (`.icq-btn`):
```css
:root[data-skin='icq99'] .icq-btn {
  height: 22px;
  min-width: 72px;
  padding: 0 8px;
  background: var(--icq-btn-bg);
  color: var(--icq-btn-text, #000000);
  border: 1px solid;
  border-color: #FFFFFF #808080 #808080 #FFFFFF;
  box-shadow: inset -1px -1px 0 #000000;
  cursor: default;
  text-align: center;
  font-family: var(--icq-font);
  font-size: var(--icq-font-size);
  outline: none;
}

:root[data-skin='icq99'] .icq-btn:active {
  border-color: #808080 #FFFFFF #FFFFFF #808080;
  box-shadow: inset 1px 1px 0 #000000;
  padding: 1px 7px 0 9px;  /* shift content 1px right+down on press */
}

:root[data-skin='icq99'] .icq-btn:focus {
  outline: 1px dotted #000000;
  outline-offset: -3px;
}

:root[data-skin='icq99'] .icq-btn:disabled {
  color: var(--icq-text-dim);
  text-shadow: 1px 1px 0 #FFFFFF;  /* Win32 engraved disabled text */
}
```

**Input fields** (`.icq-input`):
```css
:root[data-skin='icq99'] .icq-input {
  height: 20px;
  padding: 1px 3px;
  background: var(--icq-input-bg);
  color: var(--icq-text);
  border: 1px solid;
  border-color: #808080 #FFFFFF #FFFFFF #808080;
  box-shadow: inset 1px 1px 0 #000000;
  font-family: var(--icq-font);
  font-size: var(--icq-font-size);
  outline: none;
}
```

**Bottom bar** (`.icq-bottombar`):
```css
:root[data-skin='icq99'] .icq-bottombar {
  height: var(--icq-bottombar-h);   /* 22px */
  display: flex;
  align-items: center;
  padding: 1px 2px;
  background: var(--icq-bg);
  gap: 2px;
  border-top: 1px solid #808080;
}
```

The bottom bar holds icon buttons (Flower/Menu, Add User, Message, Chat, Email, URLs, Search, ICQ Phone). Each button is 20×20px with a Win32-style toolbar appearance: flat (no border) at rest, raised on hover, pressed on click.

**`src/skins/icq5.css`** — no changes to this file. It continues to serve the `icq5` skin. The new `icq99.css` is an entirely separate file imported in `src/index.js` or `src/App.js` alongside `icq5.css`.

**Import line to add in `src/App.js` or `src/index.js`:**
```javascript
import './skins/icq99.css';
```

### 4.3 `src/components/icq/StatusIcon.js`

Current implementation is **correct on colors**: `#00FF00`, `#FF0000`, `#FFFF00` verified from 2001b splash.

**Problem:** Non-flower shapes (Crescent, Clock, Busy, Ghost) are modern interpretations not present in primary sources. Classic ICQ used flower variants — color only — for all 8 statuses. The current SVG shapes are not wrong (they are legible and communicate status clearly), but they are not authentic.

**Decision:** Keep current shapes for now (YAGNI — the per-status flower variant art is undocumented). Add `data-status={status}` to the SVG element so CSS can target it. No logic changes.

**One actual fix needed:** The `chat` (FFC) status renders a speech bubble overlay with `stroke="#2861D4"` (blue) — this is a modern web color, not Win98. Change to `stroke="#000080"` (Win98 HIGHLIGHT blue). Change `fill="#fff"` to `fill="#FFFFFF"`.

**PALETTE adjustment needed:** Current `PALETTE` has non-classic colors for intermediate statuses. The palette controls SVG fill on the non-flower shapes. Since we are keeping the non-flower shapes, keep the existing PALETTE values — they are readable at 16px.

**`oddPetal` position:** Current code places the red petal at index 1 (top-right, ~1–2 o'clock). This differs from the ESTIMATED 7–8 o'clock position in research notes, but the actual position is not verifiable from available primary sources. **Leave as-is.** Flag as open question (see section 7).

### 4.4 `src/components/icq/IcqContactList.js`

Logic is correct. No JS changes required for the skin.

**CSS class audit** — ensure these classes match what `icq99.css` targets:

| Current class | `icq99.css` target | Note |
|---|---|---|
| `.icq-contactlist` | `.icq-contactlist` | Match |
| `.icq-group` | `.icq-group-header` | **Mismatch** — check JSX; either rename class in JSX or rename CSS selector |
| `.icq-group-arrow` | `.icq-group-arrow` | Match |
| `.icq-contact` | `.icq-contact` | Match |
| `.icq-contact-name` | `.icq-contact-name` | Match |
| `.icq-contact-status` | — | Not needed; status shown via StatusIcon |
| `.icq-contact-unread` | `.icq-contact-unread` | Match |

Check IcqContactList.js line by line to confirm the `data-status` attribute is propagated to `.icq-contact` elements for offline dimming. If not, add `data-status={contact.status}` to the contact row div.

Group count format `${onlineCount}/${total}` is correct ICQ behavior — no change.

### 4.5 `src/components/icq/IcqLogin.js` + `IcqLogin.css`

**`IcqLogin.css`** changes:

1. Change `background: var(--icq-panel-bg, #ece9d8)` → `background: var(--icq-bg, #C0C0C0)`
2. Change `border-bottom: 1px solid var(--icq-shadow, #aca899)` → `border-bottom: 1px solid #808080`
3. The `.icq-login-header` with its `<h1>` and large StatusIcon is a modern design pattern. Classic ICQ login was a flat dialog: plain text labels, no decorative header. **Remove the header and its `<h1>`** from JSX. Replace with a bare title label if needed: `<div class="icq-login-title">ICQ Login</div>` styled as `font-weight: bold; margin-bottom: 8px`.
4. `.icq-input` in the login form gets the Win98 sunken input style from `icq99.css` automatically via the class.
5. The warning box (`.icq-login-warning`) intentionally breaks from the skin for legibility — keep it. The orange/red colors are appropriate for a security warning and must not be muted to Win98 grey.
6. Font fallback in `.icq-login` line 13: `font-family: var(--icq-font, Tahoma, sans-serif)` — the fallback `Tahoma` is fine; the `--icq-font` var from `icq99.css` will provide `'MS Sans Serif', Tahoma, ...` at runtime.

### 4.6 `src/components/icq/StatusMenu.js`

No JS changes. CSS changes:

The status menu is a floating overlay. For Win98 it must look like a standard Win32 popup menu:
- Background: `#C0C0C0` (not white, not translucent)
- Border: 1px solid `#808080` outer + box-shadow for depth
- No border-radius
- No backdrop-filter or transparency
- Menu item height: 16px
- Menu item hover: `background: #000080; color: #FFFFFF`
- Separator: 1px solid `#808080` line
- Font: `--icq-font` at `--icq-font-size`

Add to `icq99.css`:
```css
:root[data-skin='icq99'] .icq-status-menu {
  background: #C0C0C0;
  border: 1px solid;
  border-color: #FFFFFF #808080 #808080 #FFFFFF;
  box-shadow: 2px 2px 0 #000000;
  border-radius: 0;
}

:root[data-skin='icq99'] .icq-status-menu-item {
  height: 16px;
  display: flex;
  align-items: center;
  padding: 0 16px 0 4px;
  cursor: default;
  white-space: nowrap;
  gap: 4px;
}

:root[data-skin='icq99'] .icq-status-menu-item:hover {
  background: #000080;
  color: #FFFFFF;
}

:root[data-skin='icq99'] .icq-status-menu-item:hover .icq-status-icon {
  filter: brightness(2);   /* lighten the flower on dark selection bg */
}
```

### 4.7 Main window panel (Sidebar.js or App.js root)

The outer panel wrapping the contact list must get `data-skin='icq99'` applied to the document root (handled by `applySkin()` in skins.js — no change needed). The panel background must be `#C0C0C0`.

Confirm that the outermost `.app-root` or `.main-layout` div inherits `background: var(--icq-bg)`. If it sets an explicit background color, change it to use the CSS variable.

---

## 5. Feature Backlog

Ordered by build priority. All transport is XMPP via icqr.net (unchanged).

### P0 — Must ship with skin (no new backend work)

| Feature | What to build | XMPP mechanism | Notes |
|---|---|---|---|
| Win98 skin | `icq99.css` + skin entry in skins.js | — | This spec |
| 8-status system | StatusMenu.js already has all 8 | `<show>` and `<status>` stanzas | Already implemented |
| Group expand/collapse | IcqContactList.js already has it | — | CSS fix only |
| Classic flower icon | StatusIcon.js already correct | — | Chat-bubble stroke color fix |
| Win32-style input controls | CSS only | — | `.icq-sunken` class |
| Win32-style buttons | CSS only | — | `.icq-raised` + active state |
| Offline contact dimming | `data-status` attr on contact row | — | One-line JSX change |

### P1 — Next sprint (XMPP-native, no server-side infrastructure)

| Feature | What to build | XMPP mechanism | icqr.net limit |
|---|---|---|---|
| Status text (away message) | Persist last 8 in localStorage (StatusMenu.js already does) | `<status>` element in presence stanza | Works today |
| Typing notification | Send `<composing>` when user types; show indicator in contact row | XEP-0085 Chat State Notifications | Depends on icqr.net XEP-0085 support — verify |
| Unread count badge on group header | Count `icq-contact-unread` children per group | — | CSS/JS only |
| Incoming message blink | `.icq-contact-unread` blink animation already in icq5.css | — | Port blink keyframe to icq99.css |
| Sound on message receive | `public/sounds/icq-message.mp3` already wired in App.js | — | Works today |
| Startup sound | `public/sounds/Startup.wav` already wired in App.js | — | Works today |

### P2 — Later (requires more build work, no new server infra)

| Feature | What to build | XMPP mechanism | Notes |
|---|---|---|---|
| Multi-window chat (one window per contact) | Electron `BrowserWindow` pool; chat pane already per-contact | — | Main.js change |
| Contact context menu (right-click) | `onContextMenu` already in IcqContactList.js | — | Wire to menu component |
| ICQ-style message dialog | Pop-up on incoming: "X has sent you a message" | — | Mimic ICQ 99a event notification |
| ActiveList panel | Subscription list for peer-hosted community groups | XEP-0060 PubSub | NOT a recent-conversations panel — see section 6 |

### P3 — Conditional (requires server-side support)

| Feature | What to build | XMPP mechanism | Blocker |
|---|---|---|---|
| File transfer | UI + stream handler | XEP-0096 / XEP-0234 JINGLE | Requires icqr.net proxy or direct JID-to-JID |
| Offline message delivery | Automatic if server supports it | XEP-0160 Offline Messages | icqr.net must have XEP-0160 enabled |
| Read receipts | Display tick mark in chat | XEP-0184 Message Delivery Receipts | Verify icqr.net support |

---

## 6. What We Deliberately Do Not Build

| Item | Reason |
|---|---|
| Custom Electron title bar | OS Win32 frame already active. A React-drawn title bar would be second title bar inside client area. Never do this. |
| ICQ 5.1 / XP Luna visual elements | `#ECE9D8`, `#0A246A` gradient, rounded buttons, glassy controls — wrong era entirely |
| Pro7 / ProSieben branding, content, logos | Hard constraint. No media brand content of any kind. |
| White Pages / user directory search | Requires server-side LDAP/directory infrastructure. icqr.net does not provide an ICQ-compatible White Pages. Build only when infrastructure exists. |
| ICQ Phone / SMS gateway | Requires telephony backend. Not buildable on XMPP alone. |
| ActiveList-as-chat-history | ActiveList is a peer-hosted community group subscription system (XEP-0060 PubSub nodes), not a recent-conversations panel. Do not repurpose it. |
| Lingoware translation | Lingoware was a separate 1.5MB add-on download, not built into the ICQ client. The "translate word" bottom bar is unverified and likely misidentified. |
| ICQ Plus `.IPZ` skin loading at runtime | Complex ZIP-rename format with #FF00FF transparency keying. Out of scope unless skin system is a named feature. |
| Sound scheme `.SCM` files | 29-event binary container format. Use `.mp3`/`.wav` directly. |
| Chat bubble UI | Classic ICQ had a log view, not bubbles. `--icq-bubble-me` tokens exist for non-classic skins — do not add bubbles to the `icq99` skin. |
| Animated GIF avatars in contact list | `--icq-list-avatar-display: none` — authentic ICQ behavior. Avatars appear only in chat window. |

---

## 7. Open Questions

**Q1 — Red petal position on the flower**
StatusIcon.js places the red petal at index 1 (top-right, ~1–2 o'clock). Research estimated 7–8 o'clock. The 2001b splash screen shows the ICQ logo but the petal position in a 16px icon is ambiguous. Need primary-source measurement from an actual 2001b screenshot of the running contact list at 100% DPI.

**Q2 — Bottom bar button order and icons**
ICQ 2001b bottom bar had: Flower/Menu, Add User, Message, Email, Chat, Web Search, ICQ Phone. The exact left-to-right order and which buttons were present in 2001b vs. 2000b is unverified. Need a primary-source screenshot with the bottom bar visible.

**Q3 — Group header background color**
The group header in ICQ 2001b: `#C0C0C0` (same as chrome, flat) or `#808080` (darker, sunken appearance)? From available GIF data all background measurements are from a XP-era source (SUSPECT). Cannot determine from existing data.

**Q4 — Typing notification XEP support on icqr.net**
XEP-0085 (Chat State Notifications) support on icqr.net is unverified. Before building the typing indicator UI, send a test presence and observe whether the server relays `<composing/>` stanzas.

**Q5 — Win98 vs. Win2000 font target**
Spec currently targets `'MS Sans Serif', Tahoma` (Win98 primary, Win2000 fallback). ICQ 99a–2000b ran primarily on Win98; 2001b saw more Win2000/Me usage. Tahoma at 8pt is essentially identical to MS Sans Serif at 8pt at 96dpi and the difference is not visible in screenshots. Using both in the stack (`'MS Sans Serif', Tahoma`) is the correct implementation — this question is resolved.

**Q6 — `icq-group` vs. `icq-group-header` class name**
The IcqContactList.js source uses `.icq-group` on the group row element. The spec above targets `.icq-group-header`. Before writing the CSS, read IcqContactList.js lines 40–90 and confirm the exact class name on the group header element. Write the CSS to match the JSX, not the other way around.