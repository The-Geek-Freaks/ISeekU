/**
 * Local rendering preferences: font, colour, and chat background.
 *
 * ICQ let people choose how their conversations looked — the font, the text
 * colour, even the background of the message area. None of that ever reached
 * the other end: ICQ's wire protocol carried plain text and the client alone
 * decided how to render it. XMPP is the same. XEP-0071 XHTML-IM tried to
 * carry styling across the wire and was deprecated in 2018 after persistent
 * cross-site scripting problems; the server this client speaks to supports
 * nothing in its place. So everything here affects only the Owner's screen.
 * The recipient sees their own client's defaults, whatever those happen to be.
 *
 * The font list is fixed rather than read from the system for two reasons.
 * First, enumerating installed fonts is a fingerprinting surface: the exact
 * set of fonts on a machine identifies it reliably across sites, and a
 * messaging client that hands that set to any page it renders is doing the
 * work of a tracker. Second, offering a font the recipient lacks is a promise
 * this client cannot keep — the rendering would silently fall back and look
 * nothing like what was chosen. The list here contains fonts that ship with
 * every version of Windows this client targets, so what the Owner picks is
 * what they see.
 *
 * Colour validation follows the allow-by-shape approach icq-theme.js
 * established: values are allowed because they match a pattern for a safe
 * thing, not blocked because they match a pattern for a dangerous one. The
 * set of things CSS can be coerced into is not enumerable, so a blocklist
 * would always have gaps. Specifically, nothing that contains url() can reach
 * here — a background specified as url() could pull an image from a remote
 * host, silently reporting every time the Owner opens a conversation.
 *
 * Built-in backgrounds are CSS gradients or plain colours, defined here
 * rather than supplied by the user. A user-supplied image path would reopen
 * exactly the hole icq-theme.js closes: a path that happens to be a URL would
 * fetch, and a local path would leak filesystem layout to anyone who could
 * read the settings. Gradients defined here can be trusted because they come
 * from this file, not from the network or the Owner's keyboard.
 *
 * Kept free of React and free of I/O so the rules can be tested in Node
 * without a browser.
 */

'use strict';

/** The fonts the message area may use. Fixed — see module comment. */
export const FONTS = Object.freeze([
  'Tahoma',
  'MS Sans Serif',
  'Verdana',
  'Arial',
  'Times New Roman',
  'Courier New',
  'Trebuchet MS',
  'Georgia',
  'Segoe UI',
]);

/** The smallest and largest point size the size field will accept. */
export const MIN_SIZE = 8;
export const MAX_SIZE = 24;

/**
 * Built-in backgrounds: named patterns the Owner picks from a list, rendered
 * as CSS gradients or solid colours. The value is the CSS that goes into
 * background: … on the message area. Nothing here contains url() — see the
 * module comment for why.
 */
export const BACKGROUNDS = Object.freeze({
  none:       'transparent',
  paper:      'linear-gradient(180deg, #f9f6f0 0%, #f0ebe0 100%)',
  ice:        'linear-gradient(180deg, #e8f4ff 0%, #d0e8f8 100%)',
  dusk:       'linear-gradient(180deg, #2a1a3a 0%, #1a1225 100%)',
  mint:       'linear-gradient(180deg, #e8f8f0 0%, #d0edd8 100%)',
  sunset:     'linear-gradient(135deg, #ffe8d0 0%, #ffd0d0 50%, #e8d0f0 100%)',
  graphite:   'linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%)',
  cream:      '#fffdf5',
});

// Patterns used for allowed-by-shape colour validation. These are the same
// patterns icq-theme.js uses, duplicated here because that module lives in
// electron/lib/ and crossing that boundary from the renderer would be wrong.
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_HSL_RE = /^(?:rgba?|hsla?)\(\s*[0-9a-z.,%\s/-]+\)$/i;

// Characters and patterns that must never appear in a CSS value: they either
// close the declaration or pull in a resource. Checked before the positive
// patterns so an injected value that happens to match #rrggbb is still refused.
const UNSAFE_CHARS = /[;{}<>\\]/;
const UNSAFE_FUNCS = /url\s*\(|@import|expression\s*\(|javascript:|image-set|element\s*\(/i;

/**
 * Is this string a safe colour value for a stylesheet?
 *
 * Only hex colours and rgb()/hsl() pass — not gradients and not keywords,
 * because a colour field should produce a colour, not a display value or a
 * gradient. Keeping it narrow means a bad value produces a clear message
 * rather than something that looks superficially right and misbehaves later.
 */
function isSafeColour(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || v.length > 100) return false;
  if (UNSAFE_CHARS.test(v)) return false;
  if (UNSAFE_FUNCS.test(v)) return false;
  return HEX_RE.test(v) || RGB_HSL_RE.test(v);
}

/**
 * Validate a font family name against the fixed list.
 *
 * Returns `{ value }` with the CSS-safe quoted family name on success, or
 * `{ error }` on refusal. The CSS value is quoted so the browser cannot
 * misread a name with spaces as two keywords.
 */
export function validateFont(family) {
  if (typeof family !== 'string') {
    return { error: 'Font family must be a string.' };
  }
  const normalised = family.trim();
  if (!FONTS.some((f) => f.toLowerCase() === normalised.toLowerCase())) {
    return { error: `"${normalised}" is not available. Choose one of: ${FONTS.join(', ')}.` };
  }
  // Find the canonical capitalisation from the list.
  const canonical = FONTS.find((f) => f.toLowerCase() === normalised.toLowerCase());
  return { value: `"${canonical}"` };
}

/**
 * Validate a font size in points.
 *
 * Accepts a number or a numeric string. Returns `{ value }` with a CSS px
 * value on success (ICQ used point sizes but CSS pixels are close enough at
 * screen resolution), or `{ error }` on refusal.
 */
export function validateSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) {
    return { error: `Size must be a number between ${MIN_SIZE} and ${MAX_SIZE}.` };
  }
  const clamped = Math.round(n);
  if (clamped < MIN_SIZE || clamped > MAX_SIZE) {
    return { error: `Size must be between ${MIN_SIZE} and ${MAX_SIZE} points.` };
  }
  return { value: `${clamped}px` };
}

/**
 * Validate a colour value for use in a stylesheet.
 *
 * Returns `{ value }` with the trimmed string on success, or `{ error }` on
 * refusal. Accepts hex (#rgb, #rrggbb, etc.) and functional notation
 * (rgb(), rgba(), hsl(), hsla()). Refuses anything that could pull a resource
 * or escape the declaration — see the module comment.
 */
export function validateColour(colour) {
  if (!isSafeColour(colour)) {
    return {
      error: 'Colour must be a hex value (#rrggbb) or rgb()/hsl() notation. '
           + 'Values containing url(), expressions or special characters are not accepted.',
    };
  }
  return { value: colour.trim() };
}

/**
 * Validate a background name against the built-in list.
 *
 * Returns `{ value }` with the CSS gradient or colour string on success, or
 * `{ error }` on refusal. User-supplied image paths and url() values are not
 * accepted — see the module comment.
 */
export function validateBackground(name) {
  if (typeof name !== 'string') {
    return { error: 'Background must be a name from the built-in list.' };
  }
  const key = name.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(BACKGROUNDS, key)) {
    return {
      error: `"${name}" is not a built-in background. `
           + `Choose one of: ${Object.keys(BACKGROUNDS).join(', ')}.`,
    };
  }
  return { value: BACKGROUNDS[key] };
}

/**
 * Map a settings object to the CSS custom properties the message area reads.
 *
 * Each field is validated independently; an invalid value is silently replaced
 * with the corresponding default so a single bad setting does not break the
 * whole conversation view. Returns a plain object of property → value pairs.
 *
 * The returned properties are local rendering hints only. They change how the
 * Owner sees the conversation. The recipient's client ignores them entirely.
 */
export function toCssProps(settings) {
  const s = settings || {};

  const fontResult   = validateFont(s.fontFamily || '');
  const sizeResult   = validateSize(s.fontSize   != null ? s.fontSize : 11);
  const colourResult = validateColour(s.colour    || '');
  const bgResult     = validateBackground(s.background || 'none');

  return {
    '--icq-chat-font':       fontResult.value   || '"Tahoma"',
    '--icq-chat-font-size':  sizeResult.value   || '11px',
    '--icq-chat-colour':     colourResult.value || '',
    '--icq-chat-background': bgResult.value     || 'transparent',
  };
}

/**
 * The default settings for a fresh installation.
 *
 * Matches what the message area looks like before the Owner has changed
 * anything, so the Appearance page can start with the controls in a
 * meaningful state.
 */
export const DEFAULT_APPEARANCE = Object.freeze({
  fontFamily: 'Tahoma',
  fontSize:   11,
  colour:     '',        // empty means: use the skin's default text colour
  background: 'none',
});
