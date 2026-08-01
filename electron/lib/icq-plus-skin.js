/**
 * Reading a skin made for ICQ Plus — the 1999 to 2003 era.
 *
 * ICQ Plus was an add-on that let people reskin ICQ 99b through 2003b, and it
 * is what most surviving ICQ skins were made for. A skin ships as a ZIP with
 * the extension `.ipz`, holding image files and one binary index called
 * `skininfo.dat`.
 *
 * That index starts with the bytes `VE`, two version bytes, and the
 * length-prefixed string `ICQPlus skin file`. After that comes the author's
 * description and then a run of sections — `Main dialog`, `Other dialogs`,
 * `Floating contacts`, `Floating groups` — each carrying its font, its image
 * filenames and its colours. Colours are Windows COLORREF: four bytes, red
 * first, then green, blue, and a zero.
 *
 * Three version bytes have been seen in the wild (`00 01`, `01 02`, `04 03`)
 * and the header is identical across all of them, so the reader keys off the
 * magic rather than the version.
 *
 * As with ICQ Lite 5 skins, what travels is the palette. The images are real
 * BMP and GIF files here rather than an opaque blob, but they were positioned
 * absolutely against ICQ 99b's window and, more to the point, putting a theme's
 * image into a stylesheet means allowing `url()` — which icq-theme.js refuses
 * for good reason. Colours it is.
 *
 * Kept free of I/O so the format can be tested with a buffer.
 */

'use strict';

const zlib = require('zlib');

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const SKIN_MAGIC = 'ICQPlus skin file';

/** Local file header, central directory entry, end of central directory. */
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * Pull one file out of a ZIP.
 *
 * Written here rather than taken from a package because it is a dozen lines
 * for the one case that matters, and a skin archive from 2001 is untrusted
 * input that deserves its own bounds checks rather than a general-purpose
 * reader's.
 */
function readZipEntry(buffer, predicate) {
  if (!Buffer.isBuffer(buffer)) return { error: 'Not a file.' };
  if (buffer.length < 22) return { error: 'Too short to be an ICQ Plus skin.' };
  if (buffer.length > MAX_FILE_BYTES) return { error: 'That file is too large to be an ICQ Plus skin.' };
  if (buffer.readUInt32LE(0) !== SIG_LOCAL) {
    return { error: 'Not an ICQ Plus skin — the file is not a ZIP archive.' };
  }

  // The end-of-central-directory record is last, after a comment of unknown
  // length, so it is found by scanning backwards for its signature.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return { error: 'This skin archive is damaged.' };

  const count = buffer.readUInt16LE(eocd + 10);
  let off = buffer.readUInt32LE(eocd + 16);
  const names = [];

  for (let k = 0; k < count; k++) {
    if (off + 46 > buffer.length || buffer.readUInt32LE(off) !== SIG_CENTRAL) break;
    const nameLen = buffer.readUInt16LE(off + 28);
    const extraLen = buffer.readUInt16LE(off + 30);
    const commentLen = buffer.readUInt16LE(off + 32);
    if (off + 46 + nameLen > buffer.length) break;

    const name = buffer.subarray(off + 46, off + 46 + nameLen).toString('latin1');
    names.push(name);

    if (predicate(name)) {
      const method = buffer.readUInt16LE(off + 10);
      const compressed = buffer.readUInt32LE(off + 20);
      const localOff = buffer.readUInt32LE(off + 42);
      if (localOff + 30 > buffer.length || compressed > MAX_INDEX_BYTES) {
        return { error: 'This skin archive is damaged.' };
      }
      const localNameLen = buffer.readUInt16LE(localOff + 26);
      const localExtraLen = buffer.readUInt16LE(localOff + 28);
      const start = localOff + 30 + localNameLen + localExtraLen;
      if (start + compressed > buffer.length) return { error: 'This skin archive is damaged.' };

      let data = buffer.subarray(start, start + compressed);
      if (method === 8) {
        try {
          data = zlib.inflateRawSync(data, { maxOutputLength: MAX_INDEX_BYTES });
        } catch {
          return { error: 'This skin archive is damaged.' };
        }
      } else if (method !== 0) {
        return { error: 'This skin uses a compression method the importer does not read.' };
      } else {
        // Some archives store the index with method 0 but write raw deflate
        // anyway. Inflating is worth a try; failing means it really was stored.
        try {
          data = zlib.inflateRawSync(data, { maxOutputLength: MAX_INDEX_BYTES });
        } catch { /* stored after all */ }
      }
      return { data, name, names };
    }

    off += 46 + nameLen + extraLen + commentLen;
  }

  return { error: 'This archive has no ICQ Plus skin data in it.', names };
}

/** Read every length-prefixed string in the index. */
function readStrings(index) {
  const out = [];
  let off = 4; // past the magic and version bytes
  while (off + 2 <= index.length) {
    const len = index.readUInt16LE(off);
    if (len > 0 && len <= 2048 && off + 2 + len <= index.length) {
      const text = index.subarray(off + 2, off + 2 + len).toString('latin1');
      // Printable, and containing at least one letter — otherwise a pair of
      // coincidental length bytes turns binary into a "string".
      if (/^[\t\n\r\x20-\xff]+$/.test(text) && /[A-Za-z]/.test(text)) {
        out.push({ offset: off, text });
        off += 2 + len;
        continue;
      }
    }
    off += 1;
  }
  return out;
}

/** The transparency key in Windows skinning, not a colour anyone chose. */
const MAGENTA = '#FF00FF';

/**
 * Read the colours out of the index.
 *
 * A COLORREF is four bytes — red, green, blue, zero — which is a common enough
 * byte pattern that scanning for it alone turns up mostly noise: counters,
 * offsets and stray ASCII all match. Two things separate a real palette from
 * that noise.
 *
 * First, skins write their colours consecutively, so only runs of two or more
 * back-to-back COLORREFs count. Second — and this is what a plain run check
 * misses — a run found one byte off from a real one looks just as valid: the
 * bytes of `C0 C0 C0 00 C0 C0 C0 00` read at offset 1 give a perfectly
 * plausible `#C0C000`. So each byte is allowed to belong to one run only, and
 * runs are taken longest-first, which lets the correctly aligned reading win.
 *
 * Returned with a count, because a colour the skin actually uses appears in
 * several sections while a coincidence appears once.
 */
function readColours(index, { from = 0, to = index.length, occupied = null } = {}) {
  const limit = Math.min(to, index.length);
  const isColour = (i) => {
    if (i + 4 > limit) return false;
    if (index[i + 3] !== 0) return false;
    if ((index[i] | index[i + 1] | index[i + 2]) === 0) return false;
    // Text read as a colour is the single biggest source of wrong palettes:
    // `.gif` gives `69 66 08` -> #696608, `.jpg` gives `70 67 01` -> #706701,
    // and those beat the skin's real colours on both saturation and count.
    if (occupied && (occupied[i] || occupied[i + 1] || occupied[i + 2])) return false;
    return true;
  };

  const hex = (i) => '#' + [index[i], index[i + 1], index[i + 2]]
    .map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

  // Every candidate run, with its length.
  const runs = [];
  for (let i = Math.max(0, from); i + 8 <= limit; i++) {
    if (!isColour(i) || !isColour(i + 4)) continue;
    let end = i;
    while (isColour(end)) end += 4;
    runs.push({ start: i, end, length: (end - i) / 4 });
  }

  // Longest first, so a four-colour run beats the two-colour misreading that
  // overlaps it. Ties break towards the earlier offset for stable output.
  runs.sort((a, b) => (b.length - a.length) || (a.start - b.start));

  const claimed = new Uint8Array(index.length);
  const counts = new Map();
  const order = [];

  for (const run of runs) {
    let overlaps = false;
    for (let i = run.start; i < run.end && !overlaps; i++) if (claimed[i]) overlaps = true;
    if (overlaps) continue;
    for (let i = run.start; i < run.end; i++) claimed[i] = 1;

    for (let j = run.start; j < run.end; j += 4) {
      const value = hex(j);
      // Near-black values inside a run are almost always small integers stored
      // side by side rather than colours; magenta is the transparency key.
      const dark = index[j] + index[j + 1] + index[j + 2] < 24;
      if (dark || value === MAGENTA) continue;
      if (!counts.has(value)) order.push(value);
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }

  return order.map((value) => ({ value, count: counts.get(value) }));
}

/** Sections the format defines, in the order they carry weight. */
const SECTION_NAMES = ['Main dialog', 'Other dialogs', 'Floating contacts', 'Floating groups'];

/**
 * Read what the index says about the skin.
 *
 * The description sits immediately after the magic string as a length-prefixed
 * run of text — often with leading newlines, and often in the author's own
 * language, since a great many of these were made in Germany.
 */
function parseIndex(index) {
  if (!Buffer.isBuffer(index) || index.length < 25) {
    return { error: 'This skin has no readable skin data.' };
  }
  if (index.toString('latin1', 0, 2) !== 'VE') {
    return { error: 'Not an ICQ Plus skin — the index does not start like one.' };
  }
  const magicLen = index.readUInt16LE(4);
  if (magicLen !== SKIN_MAGIC.length
      || index.toString('latin1', 6, 6 + magicLen) !== SKIN_MAGIC) {
    return { error: 'Not an ICQ Plus skin — the index does not identify itself as one.' };
  }

  const version = `${index[2]}.${index[3]}`;
  const strings = readStrings(index);

  // Colours are read per section rather than from the whole file. A skin's
  // real palette sits in the block immediately after each section name; the
  // rest of the index is filenames and layout numbers, and scanning all of it
  // turns up bytes that outvote the actual colours — a run of `00 00 FF 00`
  // deep in the layout data reads as a pure blue far more saturated, and far
  // more often, than the muted blue the skin is built from.
  const COLOUR_BLOCK_BYTES = 128;
  const rawRanges = strings
    .filter((s) => SECTION_NAMES.includes(s.text))
    .map((s) => ({ from: s.offset, to: s.offset + s.text.length + COLOUR_BLOCK_BYTES }))
    .sort((a, b) => a.from - b.from);

  // Sections close together produce overlapping windows, and reading the same
  // bytes twice would count a colour twice -- which then skews the weighting
  // that decides the accent.
  const colourRanges = [];
  for (const range of rawRanges) {
    const last = colourRanges[colourRanges.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else colourRanges.push({ ...range });
  }

  // Mark every byte that belongs to a string, so filenames and section names
  // cannot be misread as colours.
  const occupied = new Uint8Array(index.length);
  for (const s of strings) {
    const end = Math.min(s.offset + 2 + s.text.length, index.length);
    for (let i = s.offset; i < end; i++) occupied[i] = 1;
  }

  const merged = new Map();
  const order = [];
  // With no recognisable section, fall back to the whole index: better an
  // approximate palette than refusing a skin that is otherwise readable.
  for (const range of colourRanges.length ? colourRanges : [{ from: 0, to: index.length }]) {
    for (const { value, count } of readColours(index, { ...range, occupied })) {
      if (!merged.has(value)) order.push(value);
      merged.set(value, (merged.get(value) || 0) + count);
    }
  }
  const colours = order.map((value) => ({ value, count: merged.get(value) }));

  // The description follows the magic string.
  let description = '';
  const descOffset = 6 + magicLen;
  if (descOffset + 2 <= index.length) {
    const len = index.readUInt16LE(descOffset);
    if (len > 0 && len <= 2048 && descOffset + 2 + len <= index.length) {
      description = index.toString('latin1', descOffset + 2, descOffset + 2 + len).trim();
    }
  }

  const sections = SECTION_NAMES.filter((s) => strings.some((x) => x.text === s));
  const fonts = [...new Set(
    strings.map((x) => x.text.trim())
      .filter((t) => /^[A-Z][A-Za-z0-9 ]{2,31}$/.test(t) && !SECTION_NAMES.includes(t)
        && !/\.(bmp|gif|jpe?g)$/i.test(t) && /(MS|Serif|Sans|Arial|Tahoma|Verdana|Trebuchet|Comic|Courier|Times)/i.test(t)),
  )];
  const images = [...new Set(
    strings.map((x) => x.text.trim()).filter((t) => /\.(bmp|gif|jpe?g)$/i.test(t)),
  )];

  return { version, description, colours, sections, fonts, images };
}

const isHex = (v) => typeof v === 'string' && /^#[0-9A-F]{6}$/i.test(v);

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
    .slice(0, 32);
  return base ? `plus-${base}`.slice(0, 40) : 'plus-imported';
}

function prettyFilename(filename) {
  return String(filename || '')
    .replace(/\.[^.]*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * What to call the skin.
 *
 * Authors wrote a paragraph — greetings, a web address, a thank-you — not a
 * name. Taking the first line of it works far better than the first sentence,
 * because splitting on full stops turns `www.easyskin.com` into a skin called
 * "com". Where the description yields nothing usable, the filename is what the
 * author actually chose.
 */
function skinName(description, filename) {
  const line = String(description || '')
    .split(/[\r\n]+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    // A line that is only a web address names nothing.
    .filter((l) => l.length >= 3 && !/^\S*(www\.|https?:|\.(com|net|org|de)\b)\S*$/i.test(l))
    .find((l) => /[A-Za-z]{3}/.test(l));

  // Only a short line is a name. Anything longer is the author writing prose —
  // greetings, credits, a thank-you — and twenty skins from one designer all
  // carry the same paragraph, which would put twenty identical entries in the
  // list. The filename is what distinguishes them.
  if (line && line.length <= 30 && !/[:;,]$/.test(line)) return line;
  return prettyFilename(filename) || line?.slice(0, 60) || 'Imported skin';
}

function describeLimits() {
  return [
    'Colours and the description are imported.',
    'The bitmaps are not: they were drawn against ICQ 99b\'s fixed window layout, and a theme cannot reference an image file.',
    'Fonts are listed but not applied — the two built-in eras set their own.',
  ];
}

/**
 * Read an `.ipz` or `.zip` ICQ Plus skin into the shape `toSkin()` expects.
 *
 * Returns `{ theme, notes }` or `{ error }`. As with the ICQ Lite 5 importer,
 * validation is left to icq-theme.js so that an imported skin passes through
 * exactly the same checks as a hand-written one.
 */
function toTheme(buffer, { filename } = {}) {
  const wantIndex = (n) => /(^|\/)skininfo\.dat$/i.test(n);
  let entry = readZipEntry(buffer, wantIndex);

  // Skins were often uploaded as a plain `.zip` with the real `.ipz` inside,
  // so a download from an archive is regularly one wrapper deep. One level is
  // enough -- deeper than that is not a packaging habit, it is a zip bomb.
  if (entry.error && Array.isArray(entry.names)) {
    const inner = readZipEntry(buffer, (n) => /\.(ipz|zip)$/i.test(n));
    if (!inner.error) {
      const nested = readZipEntry(inner.data, wantIndex);
      if (!nested.error) entry = nested;
    }
  }
  if (entry.error) return { error: entry.error };

  const parsed = parseIndex(entry.data);
  if (parsed.error) return { error: parsed.error };

  const { colours, description, version, sections, fonts, images } = parsed;
  const counted = colours.filter((c) => isHex(c.value));
  if (counted.length === 0) {
    return { error: 'This skin does not define any colours that can be imported.' };
  }
  const usable = counted.map((c) => c.value);

  // The lightest colour is the surface people read text on; the darkest with
  // some colour in it is the frame. Skins of this era were built around a
  // window colour and a lighter panel, so that split holds up well.
  const byLuminance = [...usable].sort((a, b) => luminance(b) - luminance(a));
  const surface = byLuminance[0];
  const chrome = byLuminance.find((c) => luminance(c) < luminance(surface) - 0.05) || shade(surface, -0.1);

  // The accent is the skin's signature colour, and picking it purely by
  // saturation goes wrong: a single stray `#FFFF00` from a coincidental byte
  // pattern outscores the blue a skin is actually built from. Weighting by how
  // many sections a colour appears in fixes that, since a real palette colour
  // is reused and a coincidence is not.
  const scored = counted
    .filter((c) => saturation(c.value) > 30 && c.value !== surface && c.value !== chrome)
    .map((c) => ({ ...c, score: saturation(c.value) * Math.min(c.count, 4) }))
    .sort((a, b) => b.score - a.score);
  // With a small palette there may be nothing left once the surface and the
  // frame are taken. A saturated frame is then a far better accent than a
  // tinted version of itself — a two-colour blue skin should read as blue.
  const accentIsUseful = scored.length ? scored[0].value
    : saturation(chrome) > 30 ? chrome
      : shade(chrome, luminance(chrome) > 0.5 ? -0.35 : 0.35);

  const text = luminance(surface) > 0.5 ? '#000000' : '#FFFFFF';
  const dim = luminance(surface) > 0.5 ? '#555555' : '#BBBBBB';
  const border = shade(chrome, luminance(chrome) > 0.5 ? -0.22 : 0.28);

  const name = skinName(description, filename);

  const theme = {
    id: idFromName(filename),
    name: name.slice(0, 60),
    swatch: accentIsUseful,
    vars: {
      '--icq-bg': chrome,
      '--icq-bg-mid': shade(chrome, luminance(chrome) > 0.5 ? -0.06 : 0.08),
      '--icq-bg-light': surface,
      '--icq-teal': accentIsUseful,
      '--icq-teal-dark': shade(accentIsUseful, -0.25),
      '--icq-teal-light': shade(accentIsUseful, 0.3),
      '--icq-header-grad1': shade(chrome, luminance(chrome) > 0.5 ? 0.22 : 0.12),
      '--icq-header-grad2': chrome,
      '--icq-header-bg': chrome,
      '--icq-text': text,
      '--icq-text-dim': dim,
      '--icq-white': surface,
      '--icq-border': border,
      '--icq-border-light': shade(border, 0.3),
      '--icq-btn-bg': shade(chrome, luminance(chrome) > 0.5 ? 0.3 : 0.15),
      '--icq-btn-hover': shade(accentIsUseful, 0.55),
      '--icq-btn-active': accentIsUseful,
      '--icq-input-bg': surface,
      '--icq-bubble-me': shade(accentIsUseful, 0.75),
      '--icq-bubble-me-border': shade(accentIsUseful, 0.4),
      '--icq-avatar-bg': shade(chrome, luminance(chrome) > 0.5 ? -0.12 : 0.18),
      // ICQ 99b listed contacts without pictures.
      '--icq-list-avatar-display': 'none',
    },
  };

  const notes = [];
  if (description) notes.push(description.replace(/\s+/g, ' ').slice(0, 200));
  notes.push(`ICQ Plus skin format ${version}, ${sections.length} sections, ${images.length} images.`);
  if (fonts.length) notes.push(`Fonts named: ${fonts.join(', ')}.`);
  notes.push(...describeLimits());

  return { theme, notes };
}

module.exports = {
  readZipEntry,
  readStrings,
  readColours,
  parseIndex,
  toTheme,
  describeLimits,
  idFromName,
  skinName,
  shade,
  luminance,
  saturation,
};
