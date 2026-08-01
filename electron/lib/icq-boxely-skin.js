/**
 * Reading a skin made for ICQ 6.5 or ICQ 7 — the last era.
 *
 * By ICQ 6 the interface was drawn by Boxely, AOL's XML-and-CSS rendering
 * engine, which means these skins are the only ones in the whole ICQ lineage
 * that are not a binary format. A skin is a `*.style.box` file: XML declaring
 * bitmaps, image brushes and styles, with plain `#rrggbb` colours written out
 * in full. After the OLE compound file of ICQ Lite 5 and the COLORREF-hunting
 * of ICQ Plus, this one can simply be read.
 *
 * Getting to that file is the awkward part. Skins shipped as Inno Setup
 * installers, and unpacking one needs `innoextract`, which is not something
 * this application can require of anyone. So the importer takes the skin
 * *package* rather than the installer: unpack the installer yourself, zip the
 * skin folder, drop it in. `describeSource()` explains that, and the
 * documentation carries the exact command.
 *
 * What is imported is the palette, on the same terms as the other two
 * importers — the PNGs are real files here, but a theme still cannot reference
 * an image without opening the `url()` hole that icq-theme.js exists to close.
 *
 * Kept free of I/O so the format can be tested with a buffer.
 */

'use strict';

const { readZipEntry } = require('./icq-plus-skin');

/**
 * A Boxely style file names itself; the folder around it may be anything.
 *
 * Both separators are accepted. The ZIP specification says forward slash, but
 * archives made on Windows routinely store backslashes, and a package that
 * came out of an installer was almost certainly zipped there — matching only
 * `/` silently loses the package name on exactly the files this reads.
 */
const STYLE_FILE = /\.style\.box$/i;
const PACKAGE_FILE = /(^|[/\\])Package\.xml$/i;

const MAX_STYLE_BYTES = 4 * 1024 * 1024;

/** Colours that carry no design intent and would drown out the ones that do. */
const STRUCTURAL = new Set(['#FFFFFF', '#000000']);

/**
 * Strip XML comments before looking at anything.
 *
 * These files open with a large copyright banner, and skins were copied from
 * one another, so a commented-out block from whatever skin the author started
 * from is common. Reading colours out of a comment means importing the palette
 * of a different skin entirely.
 */
function stripComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Read the colours out of a Boxely style file.
 *
 * Returned with a count. A colour used once is likely a border on a single
 * element; the one used thirty times is what the skin is made of.
 */
function readColours(xml) {
  const body = stripComments(xml);
  const counts = new Map();
  const order = [];

  for (const match of body.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const value = '#' + match[1].toUpperCase();
    if (!counts.has(value)) order.push(value);
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return order.map((value) => ({ value, count: counts.get(value) }));
}

/**
 * Read what the package says about itself.
 *
 * `Package.xml` carries the display name in an attribute and often a
 * translated name in a child element. The attribute is the one that is
 * always there.
 */
function readPackageName(xml) {
  if (typeof xml !== 'string') return null;
  const body = stripComments(xml);
  const attr = /<Package\b[^>]*\bPackageName\s*=\s*"([^"]{1,80})"/i.exec(body);
  if (attr) return attr[1].trim() || null;
  const text = /<text\b[^>]*>([^<]{1,80})<\/text>/i.exec(body);
  return text ? text[1].trim() || null : null;
}

/**
 * Does this look like a Boxely style file at all?
 *
 * Checked after stripping comments, and against the whole file rather than its
 * first few kilobytes: several skins put a copyright banner ahead of the
 * `<?boxely?>` instruction, and it runs long enough that a window over the
 * head of the file misses the declaration entirely. The namespace is accepted
 * as well, since it identifies the format just as firmly.
 */
function looksLikeBoxely(xml) {
  if (typeof xml !== 'string') return false;
  const body = stripComments(xml);
  return /<\?boxely\b/i.test(body) || /boxely\/resource\.xsd/i.test(body);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function saturation(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.max(0, Math.min(255, amount < 0
    ? Math.round(c * (1 + amount))
    : Math.round(c + (255 - c) * amount)));
  return '#' + [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)]
    .map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function idFromName(filename) {
  const base = String(filename || '')
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 31);
  return base ? `icq7-${base}`.slice(0, 40) : 'icq7-imported';
}

function prettyFilename(filename) {
  return String(filename || '')
    .replace(/\.[^.]*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** How to get a skin out of the installer it shipped in. */
function describeSource() {
  return [
    'ICQ 6.5 and ICQ 7 skins ship inside Inno Setup installers.',
    'Unpack one with innoextract, then zip the folder under app/Packages and drop the zip in.',
    'The importer reads the *.style.box file inside it.',
  ];
}

function describeLimits() {
  return [
    'Colours and the package name are imported.',
    'The PNGs are not: a theme cannot reference an image file without reopening the url() hole the theme rules close.',
    'Boxely laid the window out itself; this client keeps its own two era layouts.',
  ];
}

/**
 * Read a zipped ICQ 6.5 / ICQ 7 skin package into the shape `toSkin()` expects.
 *
 * Returns `{ theme, notes }` or `{ error }`. Validation is left to
 * icq-theme.js so an imported skin passes exactly the checks a hand-written
 * one does.
 */
function toTheme(buffer, { filename } = {}) {
  const style = readZipEntry(buffer, (n) => STYLE_FILE.test(n));
  if (style.error) {
    // A plain "no skin data" is unhelpful when the likely cause is that
    // somebody dropped the installer in rather than the unpacked package.
    if (Array.isArray(style.names) && style.names.some((n) => /\.exe$/i.test(n))) {
      return { error: 'That is the installer, not the skin. Unpack it with innoextract first — see docs/THEMES.md.' };
    }
    return { error: style.error };
  }
  if (style.data.length > MAX_STYLE_BYTES) {
    return { error: 'That skin file is too large to read.' };
  }

  const xml = style.data.toString('utf8');
  if (!looksLikeBoxely(xml)) {
    return { error: 'Not an ICQ 6.5 or ICQ 7 skin — the style file is not Boxely.' };
  }

  const counted = readColours(xml);
  if (counted.length === 0) {
    return { error: 'This skin does not define any colours that can be imported.' };
  }

  // Boxely skins are mostly drawn with images, so the colours that appear are
  // text, borders and the few painted surfaces. The most-used light one is
  // the reading surface and the most-used dark one is the text.
  const light = counted.filter((c) => luminance(c.value) > 0.7).sort((a, b) => b.count - a.count);
  const dark = counted.filter((c) => luminance(c.value) < 0.35).sort((a, b) => b.count - a.count);

  const surface = light[0]?.value || '#FFFFFF';
  const text = dark[0]?.value || '#000000';

  // The signature colour: saturated, and used more than once so a single
  // decorative border does not decide the whole theme.
  const accent = counted
    .filter((c) => saturation(c.value) > 40 && !STRUCTURAL.has(c.value))
    .map((c) => ({ ...c, score: saturation(c.value) * Math.min(c.count, 4) }))
    .sort((a, b) => b.score - a.score)[0]?.value
    || shade(text, 0.4);

  // A chrome tone between the surface and the text, chosen by how much the
  // skin uses it rather than by how colourful it is. Picking the most
  // saturated candidate turned every skin's frame the same gold, because these
  // files all descend from one template and inherit a decorative tone none of
  // them actually paints the window with.
  const chrome = counted
    .filter((c) => luminance(c.value) > 0.75 && luminance(c.value) < 0.97 && c.value !== surface)
    .sort((a, b) => b.count - a.count)[0]?.value
    || shade(surface, -0.08);

  const border = shade(chrome, -0.18);

  const name = readPackageName(
    (() => {
      const pkg = readZipEntry(buffer, (n) => PACKAGE_FILE.test(n));
      return pkg.error ? null : pkg.data.toString('utf8');
    })(),
  ) || prettyFilename(filename) || 'Imported skin';

  const theme = {
    id: idFromName(filename),
    name: name.slice(0, 60),
    swatch: accent,
    vars: {
      '--icq-bg': chrome,
      '--icq-bg-mid': shade(chrome, -0.05),
      '--icq-bg-light': surface,
      '--icq-teal': accent,
      '--icq-teal-dark': shade(accent, -0.25),
      '--icq-teal-light': shade(accent, 0.35),
      '--icq-header-grad1': shade(chrome, 0.18),
      '--icq-header-grad2': chrome,
      '--icq-header-bg': chrome,
      '--icq-text': text,
      '--icq-text-dim': shade(text, 0.4),
      '--icq-white': surface,
      '--icq-border': border,
      '--icq-border-light': shade(border, 0.35),
      '--icq-btn-bg': shade(chrome, 0.25),
      '--icq-btn-hover': shade(accent, 0.6),
      '--icq-btn-active': accent,
      '--icq-input-bg': surface,
      '--icq-bubble-me': shade(accent, 0.78),
      '--icq-bubble-me-border': shade(accent, 0.45),
      '--icq-avatar-bg': shade(chrome, -0.1),
      // ICQ 6 onwards did show contact pictures, unlike the earlier eras.
      '--icq-list-avatar-display': 'flex',
    },
  };

  const notes = [
    `Boxely skin, ${counted.length} colours in the style file.`,
    ...describeLimits(),
  ];

  return { theme, notes };
}

module.exports = {
  readColours,
  readPackageName,
  looksLikeBoxely,
  stripComments,
  toTheme,
  describeSource,
  describeLimits,
  idFromName,
  shade,
  luminance,
  saturation,
};
