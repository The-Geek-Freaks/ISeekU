Now I have everything I need. Let me write the spec.

# ISeekU — Feature Specification: Formatting, Backgrounds, Games

---

## 1. Fonts and Text Formatting

### What ICQ did (historical baseline)

ICQ 99b through 2001b transmitted per-message font face (LOGFONT lfFaceName string), foreground/background color (4-byte little-endian Windows COLORREF), and style flags (bold/italic/underline/strikethrough bitmask) as fields inside the OSCAR SNAC 0x0004 payload. Third-party clients (Pidgin/libpurple, Miranda, Kopete) parsed and rendered them. The ChooseFont() Win32 dialog enumerated all GDI-registered fonts on the machine — there was no fixed approved list.

The adversarial check invalidated the primary sources for the byte-level encoding (the LCS/SIP-SIMPLE citation is a 404 and describes a different protocol; the OneNote citation describes the OneNote binary format; the ByteArchive link is a 504). The existence of the fields and their approximate semantics are confirmed by alicq.sourceforge.net (high-level only) and KDE bug 91359 (formatting data arrives from ICQ, but the bug is about display preferences, not wire format). Byte-level details remain ESTIMATED.

### What XMPP can carry today

**XEP-0393 Message Styling** (ESTIMATED as referenced in compliance suite drafts; XEP-0459 is Obsolete, XEP-0479 is Experimental): carries `*bold*`, `_italic_`, `~strikethrough~`, `` `monospace` ``, triple-backtick code blocks, `>blockquote`. Marker characters are plain text and readable by clients that ignore XEP-0393. No color, no font face, no font size.

**XEP-0071 XHTML-IM** (VERIFIED: xmpp.org, Status: Deprecated 2018): can carry `style="font-family: Arial; font-size: 14pt; color: #ff0000"` inline CSS. Maps to ICQ's full feature set. Deprecated because implementations parsed without sanitization, enabling XSS and body spoofing. Some clients (Conversations for Android) have already dropped it. Others (Pidgin/libpurple, Gajim legacy) still support it, but the trajectory is removal. Building on a deprecated XEP with an active XSS history requires ongoing security maintenance that this project cannot commit to.

**Verdict on wire transport**: Bold, italic, strikethrough, and monospace can travel over XMPP via XEP-0393 markers in the `<body>`. Font face, text color, and background color cannot travel to other clients via any safe, non-deprecated XMPP standard. They are local rendering only. Recipients on other XMPP clients see a readable plain-text body. This is a deliberate fidelity loss relative to 2001-era ICQ, not an oversight.

### What to build

#### 1a. Style flags toolbar (bold, italic, strikethrough, monospace)

These travel over XMPP as XEP-0393 markers. The body the user on another client receives is human-readable whether or not they support XEP-0393.

**Compose area — toolbar additions** in `src/components/ChatWindow.js`:

Add four toolbar buttons after the existing `A+`/`A-` buttons:

```
B  (bold)         inserts/removes *…*  around selection
I  (italic)       inserts/removes _…_  around selection
S  (strikethrough) inserts/removes ~…~ around selection
M  (mono)         inserts/removes `…` around selection
```

The existing `<textarea>` is kept. A toolbar button, when clicked, reads `inputRef.current.selectionStart` and `selectionEnd`. If there is a selection it wraps it with the pair of markers; if the cursor is at a point with no selection it inserts both markers and moves the cursor between them. This is the same insertion mechanic as the existing emoji button.

The `handleSend` path does not change: the body sent to `bridge.sendMessage(jid, body)` already contains the markers as plain text. Recipients on standard XMPP clients see `*hello*`; recipients on ISeekU (and any other XEP-0393 client) see **hello**.

**Message view rendering** — `linkify()` in `ChatWindow.js` currently processes text into React elements. Extend it (or add a `formatBody()` function wrapping it) to also parse XEP-0393 patterns before linkification:

| Pattern | Render |
|---------|--------|
| `*text*` | `<strong>text</strong>` |
| `_text_` | `<em>text</em>` |
| `~text~` | `<s>text</s>` |
| `` `text` `` | `<code>text</code>` |
| ` ```\nblock\n``` ` | `<pre><code>block</code></pre>` |
| `>text` at line start | `<blockquote>text</blockquote>` |

Regex caveat: markers must not span newlines (XEP-0393 requires this) and must not match across word boundaries in a way that breaks links. Apply the XEP-0393 pass before `URL_REGEX` so URLs inside markers still linkify correctly. Parse one pass left-to-right with no backtracking; partial overlapping markers (`*_text*_`) are left as-is per spec.

The markers inside the compose textarea remain visible as characters. The WYSIWYG compose area (where the compose textarea shows formatted text live) is Phase 2, not specified here; it requires replacing the `<textarea>` with a `contentEditable` div, which is a separate refactor.

#### 1b. Font face picker — local rendering only

**Font enumeration.** `window.queryLocalFonts()` requires the `local-fonts` permission. VERIFIED (MDN: https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts): "the user must grant permission to access local-fonts." In Electron 29, the app must call `session.defaultSession.setPermissionRequestHandler()` in the main process to grant this permission without a browser-style prompt. This requires one line in `electron/main.js`:

```js
session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
  callback(permission === 'local-fonts');
});
```

This grants `local-fonts` silently and blocks everything else, which is correct for a desktop app.

**Font list IPC.** Add `ipcMain.handle('icq:listFonts', async () => { ... })` in the main process. The handler calls `await window.queryLocalFonts()` via a preload bridge. Because `queryLocalFonts()` is a renderer API, it must be invoked in the renderer via a preload-exposed call, or the font list must be fetched in the renderer via `window.api.listFonts()` which sends an IPC call that the main process fulfills by triggering a renderer eval — which is unusual. The simpler path: expose `queryLocalFonts()` directly through `contextBridge` in the preload script so the renderer calls it directly, after the permission has been granted via the handler above.

```js
// preload.js addition
contextBridge.exposeInMainWorld('api', {
  ...existingApi,
  listFonts: () => window.queryLocalFonts().then(fonts => fonts.map(f => f.family))
    .then(families => [...new Set(families)].sort()),
});
```

**Font picker UI.** A dropdown `<select>` in the compose toolbar. Populated once on first open, cached in component state. Default value: the CSS-inherited font for the compose area (skin-dependent). Width: ~140px. Label: the font name, rendered in that font via `option { font-family: ... }`.

Selecting a font sets a React state value `composeFont`. The `<textarea>` receives `style={{ fontFamily: composeFont }}`. The chosen font is stored in `localStorage['icq-compose-font']` and restored on mount.

**Wire format**: the font name is not included in the body sent to `bridge.sendMessage`. The recipient sees the message in their skin's default font. This is the correct behavior given the XMPP transport constraint.

#### 1c. Text color picker — local rendering only

A small color swatch button in the toolbar. On click: opens the browser's native color picker via a hidden `<input type="color">`. Selected color sets a React state value `composeColor`. The `<textarea>` receives `style={{ color: composeColor }}`. Stored in `localStorage['icq-compose-color']`.

The color is not in the wire body. The recipient sees the message in their skin's default text color.

#### 1d. Font size — no change needed

The existing `A+`/`A-` buttons adjust `document.documentElement.style.fontSize` globally (13px ± 1px, clamped 10–20). This scales the entire UI uniformly, which is a reasonable interpretation of "font size" for a skin-controlled application. Per-message font size that travels over XMPP is not feasible without XHTML-IM (see "What we do not build").

#### 1e. Received formatting from other XMPP clients

Some XMPP clients send XHTML-IM. The message body's plain-text `<body>` element, which `bridge.js` already reads, will contain a clean text fallback. If a stanza contains `<html xmlns="http://jabber.org/protocol/xhtml-im">`, the bridge should log it and use only the `<body>` text child, never the HTML. Rendering the XHTML payload is not implemented; this is the correct posture given the deprecation.

---

## 2. Backgrounds

### What ICQ actually had

- **Message window background color**: Real native feature from ICQ 99b. VERIFIED: contemporary ICQ Tour page (windows.helper.tripod.com/icq_tour.htm, reached in research). A color button in the compose toolbar.
- **Background images**: A real feature, but via the third-party ICQ Plus add-on (IPZ skins, BMP/JPEG/GIF) from ICQ 99b onward. Native in ICQ 5+ via official skin system. ICQ 6 used INI + folder with a `background/` subfolder. VERIFIED for ICQ Plus via Internet Archive (archive.org/details/tucows_193854_ICQ_Plus).
- **Contact list background images**: ICQ 7 textured contact-list backgrounds. ESTIMATED (consistent with all evidence, no primary engineering document).
- **Per-contact backgrounds**: Not a historical ICQ feature. Do not spec this.

### The trust boundary that must not move

`electron/lib/icq-theme.js` deliberately blocks `url()`, `@import`, `expression()`, `javascript:`, `image-set`, and `element()` from theme JSON values because a theme file is untrusted input. A user downloading a theme cannot make the client phone home. This is correct and must not be reopened.

Background image support for a user who picks a local file is a different trust level: the user performed an explicit file-picker action. The distinction is **interactive file dialog** (trusted, user-initiated, bounded to local disk) versus **URL or path in a JSON field** (untrusted, potentially remote). The implementation must keep these paths completely separate.

### What to build

#### 2a. Chat area background color

Add `--icq-message-area-bg` to `ALLOWED_PROPERTIES` in `electron/lib/icq-theme.js`. The skins (`icq99.css`, `icq78.css`) set this to their existing message-area background (white for icq99, the ICQ 7 chat background for icq78). The theme validator already handles it safely because colors/gradients/keywords pass through `isSafeValue()`.

Additionally expose a per-window color override in the compose toolbar: a color swatch button that sets `localStorage['icq-msg-area-bg']`. On mount, `ChatWindow.js` reads this and applies it as inline `style={{ backgroundColor }}` on the `.message-area` div. This is a user preference that overrides the skin; it is not in the theme JSON path.

#### 2b. Chat area background image — safe local file picker path

This is entirely separate from the theme system. The flow:

1. Add a wallpaper button (🖼) to the compose toolbar. When clicked, it calls `window.api.openFileDialog()` — which already exists for file sending — with a filter for `['jpg', 'jpeg', 'png', 'gif', 'webp']`.

2. In the **main process**, extend the file-dialog handler or add a new `ipcMain.handle('icq:pickWallpaper', ...)` that:
   - Opens `dialog.showOpenDialog` with `filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]`
   - Reads the file with `fs.readFile`
   - Checks size: if > 2 MB, returns `{ error: 'Image must be under 2 MB' }`
   - Converts to a `data:image/...;base64,...` string
   - Returns the data URL to the renderer

3. In `ChatWindow.js`, on receiving the data URL:
   - Store in `localStorage['icq-chat-wallpaper']` (data URLs are large; this is acceptable for 2 MB max)
   - Apply as `backgroundImage: \`url(${dataUrl})\`` in inline style on `.message-area`
   - Add a "Clear wallpaper" option (right-click on the button, or a toggle) that sets the localStorage key to `''` and clears the inline style

4. On mount, read `localStorage['icq-chat-wallpaper']` and apply if present.

The `isSafeValue()` function in `icq-theme.js` is never called in this path. The data URL is generated by the main process from a file the user explicitly chose; it does not come from any theme JSON, config file, or user-typed field. The hole the theme validator closes stays closed.

**Skin interaction**: when a wallpaper is active, the message text still needs contrast. Apply `--icq-text` color via the skin's CSS variable. If the skin's text color is illegible against an arbitrary wallpaper, that is the user's problem — they chose the image.

#### 2c. Contact list background image

Same pattern. A separate button in the sidebar/contact list header area, stores in `localStorage['icq-sidebar-wallpaper']`, applied as inline `background-image` style on the contact list container in `Sidebar.js`. Same 2 MB limit, same data-URL path.

#### 2d. What is explicitly not added

- `url()` in theme JSON: the validator already blocks it, and it stays blocked.
- Per-contact background images: not a historical ICQ feature.
- Remote URL input for backgrounds: any text field where a user can type a URL that the renderer then fetches is the same attack surface as a URL in a theme JSON. Do not add one.

---

## 3. Games

### Current state

The `GAMES` array is in `src/components/ChatWindow.js` (lines 26–29), not in `Sidebar.js` as the task description states. The games menu renders from this array via the 🎮 toolbar button.

```js
const GAMES = [
  { id: '8ball', name: '8 Ball Pool',   icon: '🎱', url: 'https://bloob.io/de/8ballpool' },
  { id: 'lama',  name: 'Slide-A-Lama',  icon: '🦙', url: 'https://slidealama.eu/' },
];
```

### Game-by-game verdict

| Game | Status | Action | Reason |
|---|---|---|---|
| Slide-A-Lama | Live at slidealama.eu (VERIFIED) | **Keep** | Already linked. Unity WebGL rebuild of the original MLiven/Redboss ICQ partner title. Correct link. |
| Bloob.io 8-ball | Live at bloob.io (VERIFIED) | **Keep** | Already linked. No original ICQ 8-ball pool web version survives; this is the practical stand-in. |
| Zoopaloola | Live at zoopaloola.eu (VERIFIED: indexed by multiple aggregators with active play counts, HTML5/WebGL rebuild released May 2021) | **Add immediately** | The second iconic ICQ Xtraz game from MLiven/Redboss. One array entry. Highest value/effort ratio of any change in this spec. |
| Cubis 2 | Live at brightestgames.com (VERIFIED: site resolves) | **Add (optional)** | FreshGames, partnered with ICQ-era portals. Worth linking; lower nostalgia recognition than Zoopaloola. |
| Kung-Fu Chess | Fan reimplementation at kungfuchess.com | **Skip** | Original Shizmoo site gone. Fan site playability not verified in this research pass. Verify the link works before adding. |
| Warsheep | Dead. No web version, no Ruffle archive | **Skip** | |
| ICQ RPS | Dead. No surviving web version | **Skip** | |
| Galaxy Guardians | Dead. No surviving web version | **Skip** | |
| Teddy Adventures | Dead. No surviving web version | **Skip** | |
| Sumo Volleyball | Dead. Shizmoo site gone, no archive found | **Skip** | |
| ICQ Solitaire | Dead. Mobile-only (J2ME/Symbian era) | **Skip** | Generic solitaire is everywhere; no differentiation |
| Built-in board games (Checkers, Chess, Go, Reversi) | Dead. Ran over OSCAR peer-to-peer rendezvous; died with ICQ's OSCAR server (June 2024) | **Skip** | No web equivalent preserves the 'play against your contact' feel |

**Immediate change**: add Zoopaloola to the `GAMES` array:

```js
const GAMES = [
  { id: '8ball',      name: '8 Ball Pool',   icon: '🎱', url: 'https://bloob.io/de/8ballpool' },
  { id: 'lama',       name: 'Slide-A-Lama',  icon: '🦙', url: 'https://slidealama.eu/' },
  { id: 'zoopaloola', name: 'Zoopaloola',    icon: '🐘', url: 'https://zoopaloola.eu/' },
];
```

### XMPP in-client multiplayer — is it feasible?

The research is honest: no standardized XMPP gaming protocol exists that is usable today.

- XEP-0196 (User Gaming): VERIFIED at xmpp.org, Status: Deferred since 2008. Announces "I am currently playing X" as presence data. No session management. Cannot be used for actual gameplay.
- Inbox/instant-gaming, inbox/multi-user-gaming: VERIFIED at xmpp.org, Status: Inbox (not even a numbered XEP). No server implementations, no client support outside the submitter.
- XEP-0166 (Jingle): VERIFIED at xmpp.org, Status: Final. Could bootstrap a direct WebRTC data channel between two clients. Significant implementation work; no existing Jingle-data-channel library for Electron/xmppjs that is actively maintained.

**Custom namespace approach**: an ordinary `<message type='chat'>` stanza can carry any child element with any XML namespace. icqr.net (and any standards-compliant XMPP server) passes custom namespace payloads through without inspection. This is standard XMPP behavior. A turn-based game can therefore be implemented as custom stanzas without any XEP support, as long as both endpoints run ISeekU.

Example game invite stanza:

```xml
<message to="12345678@icqr.net" type="chat" id="game-abc123">
  <body>[ISeekU game invite: Tic-Tac-Toe. Reply to join.]</body>
  <game xmlns="urn:iseeku:game:1" action="invite" game-type="tictactoe" game-id="abc123"/>
</message>
```

The `<body>` element always contains human-readable fallback text so a non-ISeekU client receiving the stanza sees something sensible.

**Is it worth building?** Yes, for one simple game, as a demonstration of the mechanism. The game that makes the most sense architecturally is Tic-Tac-Toe (9-cell board, two moves per state transition, state fits in one attribute). It demonstrates: invite/accept/decline flow, turn validation, win detection, disconnect handling (stanza delivery timeout). Once the infrastructure exists, any other turn-based game (a 5x5 version of Slide-A-Lama, Checkers) adds only the game-logic module.

**Effort estimate**: 2–3 weeks for one developer including the invite UI, turn stanza protocol, game state machine, win/draw detection, abandon-on-close handling, and a skin-appropriate board renderer. This is a separate project from the menu additions.

**Real-time games (Zoopaloola-style physics)**: XMPP message delivery latency makes in-client real-time physics games impractical. The external zoopaloola.eu site already has working multiplayer. Link to it; do not attempt to rebuild it in-client.

---

## 4. Build Order

| # | Item | Effort | Notes |
|---|---|---|---|
| 1 | Add Zoopaloola to GAMES array | 30 min | One array entry in `ChatWindow.js`. Verify zoopaloola.eu is up before shipping. |
| 2 | XEP-0393 message view rendering | 2 days | Extend `linkify()` / add `formatBody()`. Six patterns. Unit-test the regex against malformed inputs before merging. |
| 3 | Toolbar: bold/italic/strikethrough/mono insertion | 1 day | Four buttons, `selectionStart`/`selectionEnd` wrapping logic. No compose-area changes. |
| 4 | Chat area background color override | 1 day | Add `--icq-message-area-bg` to `ALLOWED_PROPERTIES` + localStorage per-window override in `ChatWindow.js`. |
| 5 | Text color picker (local rendering) | 1 day | Hidden `<input type="color">`, inline style on textarea. localStorage. |
| 6 | Font face picker (local rendering) | 2–3 days | Permission handler in main process, `queryLocalFonts()` via preload, `<select>` in toolbar. localStorage. |
| 7 | Chat area background image | 2 days | `ipcMain.handle` for wallpaper picker, 2 MB limit, data URL, localStorage. Never through theme validator. |
| 8 | Contact list background image | 1 day | Same pattern as item 7, different localStorage key, applied in `Sidebar.js`. |
| 9 | XMPP in-client game (Tic-Tac-Toe, one game) | 2–3 weeks | Custom namespace protocol, invite/accept UI, state machine, board renderer. Separate feature branch. |

Items 1–8 are independent and can be built in parallel. Item 9 depends on nothing in 1–8 but is a dedicated project.

---

## 5. What We Deliberately Do Not Build

**XHTML-IM (XEP-0071) for sending formatting to other clients.** Deprecated by the XMPP Council in 2018. Known XSS vector (HTML payload can differ from the plain-text body; implementations that rendered without sanitization were compromised). Some clients have removed support. The security maintenance burden (sanitize every inbound XHTML payload against a moving set of XSS patterns) is ongoing and disproportionate to the benefit. The wire format for font face and color on XMPP will remain "local rendering only" until a non-deprecated, safe replacement standard exists. There is currently no such standard.

**Sender-chosen text color or font face appearing on the recipient's screen.** No safe XMPP path exists. This is a fidelity loss relative to ICQ 2001b and is stated honestly here.

**Per-message font size transmitted to recipients.** Same reasoning. The global A+/A- zoom covers the use case of "I want bigger text" at the local level.

**`url()` in theme JSON.** The theme validator already blocks it. It stays blocked. A theme downloaded from anywhere can set colors and gradients; it cannot cause a network request. Background images travel through a completely separate user-initiated file-picker path.

**Per-contact background images.** Not a historical ICQ feature at any version. The ICQ Plus add-on applied skins globally; per-contact customization is a smartphone-era convention.

**Dead Xtraz games** (Warsheep, ICQ RPS, Galaxy Guardians, Teddy Adventures, Sumo Volleyball). No web version, no Ruffle-compatible SWF archive, no reimplementation, no primary documentation of the exact rules. The gameplay niches are covered by live alternatives.

**Real-time in-client multiplayer for physics games.** XMPP message round-trip time makes sub-100ms game state sync impractical over a federation-capable XMPP network. External sites (zoopaloola.eu, bloob.io) already solve this problem. Linking is the correct answer.

**Replacing the `<textarea>` with a `contentEditable` WYSIWYG compose area.** This is Phase 2 of formatting support. It requires significant careful engineering (cursor management, paste handling, clipboard sanitization, IME support) and is a separate refactor. The Phase 1 spec above (toolbar buttons that insert XEP-0393 markers into the textarea) is buildable without it and delivers immediate value.