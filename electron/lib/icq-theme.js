/**
 * Loading a theme somebody else wrote.
 *
 * A theme is the same shape as a built-in skin — an id, a name, a swatch, and
 * a map of CSS custom properties — so a file on disk can do everything a
 * shipped skin can. That is the point: people skinned ICQ endlessly, and a
 * client that only offers what its author imagined is missing most of what
 * made skinning fun.
 *
 * It also means a theme file is untrusted input that ends up in the renderer's
 * stylesheet, which is a real trust boundary and the reason most of this file
 * is validation.
 *
 * The specific danger is that CSS custom properties are not inert. A value
 * like `url(https://tracker.example/pixel.png)` fetches when the property is
 * used, so a theme could quietly report every launch — and a `--icq-avatar-bg`
 * is exactly the kind of property somebody would expect to hold an image. So
 * values are allowed by shape rather than blocked by pattern: colours,
 * gradients, and a short list of keywords get through, and everything else is
 * dropped with a reason. A blocklist here would be wrong, because the set of
 * things CSS can be talked into is not enumerable.
 *
 * Kept free of I/O so the rules can be tested without a filesystem.
 */

'use strict';

/** Property names a theme may set. Anything else is ignored. */
const ALLOWED_PROPERTIES = Object.freeze([
  '--icq-bg', '--icq-bg-mid', '--icq-bg-light',
  '--icq-teal', '--icq-teal-dark', '--icq-teal-light',
  '--icq-header-grad1', '--icq-header-grad2', '--icq-header-bg',
  '--icq-yellow', '--icq-white', '--icq-text', '--icq-text-dim',
  '--icq-border', '--icq-border-light',
  '--icq-online', '--icq-away', '--icq-offline', '--icq-dnd',
  '--icq-btn-bg', '--icq-btn-hover', '--icq-btn-active',
  '--icq-input-bg', '--icq-bubble-me', '--icq-bubble-me-border',
  '--icq-avatar-bg', '--icq-list-avatar-display',
]);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_HSL = /^(?:rgba?|hsla?)\(\s*[0-9a-z.,%\s/-]+\)$/i;
const GRADIENT = /^(?:linear|radial)-gradient\(\s*[#0-9a-z.,%\s()/-]+\)$/i;

/** Keywords that are safe because they name a fixed behaviour, not a resource. */
const KEYWORDS = Object.freeze([
  'none', 'flex', 'block', 'inline', 'inline-block', 'transparent',
  'currentColor', 'inherit', 'initial', 'unset',
]);

/**
 * Is this value safe to put into a stylesheet?
 *
 * Deliberately narrow. A theme that wants something exotic is refused rather
 * than guessed at, because the failure mode of guessing is a stylesheet that
 * makes network requests.
 */
function isSafeValue(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!v || v.length > 200) return false;

  // Nothing that can escape the declaration or pull in a resource, whatever
  // else it looks like.
  if (/[;{}<>\\]/.test(v)) return false;
  if (/url\s*\(|@import|expression\s*\(|javascript:|image-set|element\s*\(/i.test(v)) return false;

  if (KEYWORDS.some((k) => k.toLowerCase() === v.toLowerCase())) return true;
  if (HEX.test(v)) return true;
  if (RGB_HSL.test(v)) return true;
  if (GRADIENT.test(v)) return true;
  return false;
}

const isSafeId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);

/**
 * Turn a parsed theme file into a skin, or explain why it cannot be one.
 *
 * Returns `{ skin, warnings }` on success and `{ error }` on refusal. Warnings
 * are for properties that were dropped: a theme with one bad value should
 * still load, and its author should be able to find out which value it was.
 */
function toSkin(data, { source } = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'A theme must be a JSON object.' };
  }

  const { id, name, swatch, vars } = data;

  if (!isSafeId(id)) {
    return { error: 'A theme needs an id of lowercase letters, digits and hyphens.' };
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 60) {
    return { error: 'A theme needs a name of up to 60 characters.' };
  }
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
    return { error: 'A theme needs a "vars" object of CSS custom properties.' };
  }

  const warnings = [];
  const safeVars = {};

  for (const [property, value] of Object.entries(vars)) {
    if (!ALLOWED_PROPERTIES.includes(property)) {
      warnings.push(`Ignored unknown property ${property}.`);
      continue;
    }
    if (!isSafeValue(value)) {
      warnings.push(`Ignored ${property}: only colours, gradients and a few keywords are allowed.`);
      continue;
    }
    safeVars[property] = String(value).trim();
  }

  if (Object.keys(safeVars).length === 0) {
    return { error: 'A theme must set at least one usable property.' };
  }

  // A skin must define every property, or switching to it leaves values behind
  // from whichever skin was applied before. Missing ones fall back to the
  // theme's own background and text rather than to nothing.
  const filled = { ...safeVars };
  for (const property of ALLOWED_PROPERTIES) {
    if (filled[property] !== undefined) continue;
    filled[property] = property === '--icq-list-avatar-display'
      ? 'none'
      : (safeVars['--icq-bg'] || 'transparent');
    warnings.push(`${property} was not set; filled in so switching skins cannot leave a stale value.`);
  }

  return {
    skin: {
      id,
      name: name.trim(),
      swatch: isSafeValue(swatch) ? String(swatch).trim() : (filled['--icq-teal'] || '#808080'),
      vars: filled,
      // Marks it in the interface as something the Owner installed, and stops
      // a theme from impersonating a built-in one.
      custom: true,
      source: source || null,
    },
    warnings,
  };
}

/**
 * Build the skin list the interface shows.
 *
 * Built-ins win on an id collision: a theme file must not be able to replace
 * the skin somebody is currently using by claiming its name.
 */
function mergeSkins(builtIn, themes) {
  const taken = new Set(builtIn.map((s) => s.id));
  const extra = [];
  for (const theme of themes || []) {
    if (!theme || taken.has(theme.id)) continue;
    taken.add(theme.id);
    extra.push(theme);
  }
  return [...builtIn, ...extra];
}

module.exports = {
  ALLOWED_PROPERTIES,
  KEYWORDS,
  isSafeValue,
  isSafeId,
  toSkin,
  mergeSkins,
};
