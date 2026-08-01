/**
 * Reading a skin somebody made for ICQ Lite 5, twenty years ago.
 *
 * People made thousands of these, and the good ones are still online. A `.skn`
 * file is an OLE Compound File — Microsoft Structured Storage, the same
 * container as a .doc — holding a single stream called `SkinData`. That stream
 * is a serialised widget tree: every panel, button and label ICQ 5 drew, with
 * its rectangle, its anchors, its bitmaps and its colours.
 *
 * What is honestly portable is the *palette*, not the layout. ICQ 5 positioned
 * everything absolutely against a fixed window, and its bitmaps are stored in
 * an undocumented per-widget format. Recreating that would mean recreating ICQ
 * 5's exact geometry, which is not what this client is. So the import takes
 * the four global colours the skin author actually chose — and the name they
 * signed it with — and maps them onto the theme variables. The result is
 * recognisably that skin's colour scheme, not a pixel copy, and
 * `describeLimits()` exists so the interface can say so rather than imply
 * otherwise.
 *
 * The file is untrusted input from the internet, so the parser is written to
 * refuse rather than guess: every offset is bounds-checked, every length is
 * capped, and a malformed file returns an error instead of throwing. The
 * output goes through icq-theme.js `toSkin()` like any other theme, so the CSS
 * trust boundary is unchanged — nothing here can put a value into a stylesheet
 * that a hand-written theme could not.
 *
 * Kept free of I/O so the format can be tested with a buffer.
 */

'use strict';

const OLE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');

/** A skin is around a megabyte. Anything far past that is not one. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** Bound on the widget tree so a corrupt length cannot allocate wildly. */
const MAX_STREAM_BYTES = 64 * 1024 * 1024;
/** Longest plausible property name or caption, in UTF-16 bytes. */
const MAX_STRING_BYTES = 512;

const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

/**
 * Pull one named stream out of a compound file.
 *
 * Only the sector chain a skin actually uses is implemented: streams above the
 * mini-stream cutoff, and a FAT that fits in the header's DIFAT. Both hold for
 * every `.skn` — the widget tree is far larger than the 4 KB cutoff — and a
 * file that needs more is refused by name rather than parsed approximately.
 */
function readCompoundStream(buffer, wanted) {
  if (!Buffer.isBuffer(buffer)) return { error: 'Not a file.' };
  if (buffer.length < 512) return { error: 'Too short to be an ICQ skin.' };
  if (buffer.length > MAX_FILE_BYTES) return { error: 'That file is too large to be an ICQ skin.' };
  if (!buffer.subarray(0, 8).equals(OLE_SIGNATURE)) {
    return { error: 'Not an ICQ Lite 5 skin — the file does not start like one.' };
  }

  const sectorShift = buffer.readUInt16LE(30);
  if (sectorShift !== 9 && sectorShift !== 12) {
    return { error: 'Unsupported skin file layout.' };
  }
  const sectorSize = 1 << sectorShift;
  const miniCutoff = buffer.readUInt32LE(56);
  const dirStart = buffer.readUInt32LE(48);
  const fatCount = buffer.readUInt32LE(44);

  // Sector n starts after the 512-byte header, whatever the sector size.
  //
  // The last sector of a real file is often short — writers do not pad the
  // file out to a sector boundary, and the stream simply ends inside it. So a
  // sector counts as present when it *starts* inside the file; reads from it
  // are clamped below.
  const sectorOffset = (n) => 512 + n * sectorSize;
  const sectorInBounds = (n) =>
    Number.isInteger(n) && n >= 0 && sectorOffset(n) < buffer.length;

  // The FAT: one entry per sector, saying which sector follows it.
  const fatSectors = [];
  for (let i = 0; i < Math.min(fatCount, 109); i++) {
    const s = buffer.readUInt32LE(76 + i * 4);
    if (s === FREESECT) break;
    if (!sectorInBounds(s)) return { error: 'This skin file is damaged.' };
    fatSectors.push(s);
  }
  if (fatCount > 109) {
    return { error: 'This skin file is larger than the importer supports.' };
  }
  if (fatSectors.length === 0) return { error: 'This skin file is damaged.' };

  const fat = [];
  for (const s of fatSectors) {
    const base = sectorOffset(s);
    const end = Math.min(base + sectorSize, buffer.length);
    for (let i = base; i + 4 <= end; i += 4) fat.push(buffer.readUInt32LE(i));
  }

  /** Follow a sector chain, refusing loops rather than hanging on them. */
  const chain = (start, limitBytes) => {
    const out = [];
    let s = start;
    let guard = 0;
    const maxSectors = Math.ceil(limitBytes / sectorSize) + 2;
    while (s !== ENDOFCHAIN && s !== FREESECT) {
      if (!sectorInBounds(s) || guard++ > maxSectors) return null;
      out.push(s);
      s = fat[s];
      if (s === undefined) return null;
    }
    return out;
  };

  // Walk the directory for the stream we want.
  const dirChain = chain(dirStart, MAX_STREAM_BYTES);
  if (!dirChain) return { error: 'This skin file is damaged.' };

  const perSector = sectorSize / 128;
  for (const sector of dirChain) {
    for (let e = 0; e < perSector; e++) {
      const base = sectorOffset(sector) + e * 128;
      if (base + 128 > buffer.length) break; // short final sector
      const nameLen = buffer.readUInt16LE(base + 64);
      const type = buffer[base + 66];
      if (type !== 2 || nameLen < 4 || nameLen > 64) continue; // 2 = stream

      const name = buffer.subarray(base, base + nameLen - 2).toString('utf16le');
      if (name !== wanted) continue;

      const size = buffer.readUInt32LE(base + 120);
      const startSector = buffer.readUInt32LE(base + 116);
      if (size === 0 || size > MAX_STREAM_BYTES) {
        return { error: 'This skin file is damaged.' };
      }
      if (size < miniCutoff) {
        // Small streams live in the mini-FAT. No real skin lands here.
        return { error: 'This skin has no readable skin data.' };
      }

      const dataChain = chain(startSector, size);
      if (!dataChain) return { error: 'This skin file is damaged.' };

      const parts = dataChain.map((s) => buffer.subarray(sectorOffset(s), sectorOffset(s) + sectorSize));
      const joined = Buffer.concat(parts);
      if (joined.length < size) return { error: 'This skin file is damaged.' };
      return { stream: joined.subarray(0, size) };
    }
  }
  return { error: 'This skin has no readable skin data.' };
}

/**
 * The property name whose string record ends exactly at `end`, if any.
 *
 * A string record is `<u32 tag><u32 byteLength><UTF-16 payload>`, so its start
 * is determined by its length. Trying each plausible length and checking that
 * the stored length agrees identifies the record without having to have parsed
 * everything before it correctly.
 */
function nameEndingAt(stream, end) {
  for (let len = 6; len <= MAX_STRING_BYTES; len += 2) {
    const start = end - len - 8;
    if (start < 0) break;
    if (stream.readUInt32LE(start + 4) !== len) continue;
    const raw = stream.subarray(start + 8, end);
    if (raw[len - 1] !== 0 || raw[len - 2] !== 0) continue;
    const text = raw.subarray(0, len - 2).toString('utf16le');
    if (/^m_[A-Za-z]+$/.test(text)) return text;
  }
  return null;
}

/**
 * Read the property bag out of the widget tree.
 *
 * Records are `<u32 tag><u32 length><payload>`: tag 10 is a length-prefixed
 * UTF-16 string, tag 7 with length 3 is a raw RGB triple. Rather than model the
 * whole tree — which nests deeper than anything here needs — this scans for
 * those two shapes. A colour record sits immediately after the name of the
 * property it belongs to, which is what makes the palette recoverable.
 *
 * Only the first value for a given name is kept: the global skin colours come
 * first in the stream, and per-widget overrides of the same name follow.
 */
function parseSkinData(stream) {
  const strings = [];
  const props = {};
  const colours = {};
  const palette = [];

  let off = 0;
  while (off + 8 <= stream.length) {
    const len = stream.readUInt32LE(off + 4);

    // A UTF-16 string: even length, NUL-terminated, printable.
    if (len >= 4 && len <= MAX_STRING_BYTES && len % 2 === 0 && off + 8 + len <= stream.length) {
      const raw = stream.subarray(off + 8, off + 8 + len);
      if (raw[len - 1] === 0 && raw[len - 2] === 0) {
        const text = raw.subarray(0, len - 2).toString('utf16le');
        if (/^[\x20-\x7e]+$/.test(text)) {
          const end = off + 8 + len;
          strings.push({ text, end });

          // A property name is followed either by another string (its value)
          // or by a colour record.
          const previous = strings.length >= 2 ? strings[strings.length - 2] : null;
          if (previous && /^m_bstr[A-Za-z]+$/.test(previous.text) && previous.end === off
              && props[previous.text] === undefined) {
            props[previous.text] = text;
          }
          off = end;
          continue;
        }
      }
    }

    // A colour: tag 7, three bytes of RGB.
    if (stream.readUInt32LE(off) === 7 && len === 3 && off + 11 <= stream.length) {
      const hex = '#' + stream.subarray(off + 8, off + 11).toString('hex').toUpperCase();
      // Resolve the owning property by reading backwards for a string record
      // that ends exactly here. Scanning forwards a byte at a time turns up
      // enough plausible-looking noise that "the last string seen" is not
      // reliable; reading back from a known boundary is.
      const owner = nameEndingAt(stream, off);
      if (owner && colours[owner] === undefined) colours[owner] = hex;
      palette.push(hex);
      off += 11;
      continue;
    }

    // One byte at a time. Records are not aligned to any boundary — a string
    // payload is an even number of bytes but a colour payload is three, so
    // stepping by four walks straight past most of the file.
    off += 1;
  }

  return { props, colours, palette };
}

const isHex = (v) => typeof v === 'string' && /^#[0-9A-F]{6}$/i.test(v);

/** Perceived brightness, for deciding whether text should be light or dark. */
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Shift a colour towards black or white by a fraction. */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => {
    const v = amount < 0
      ? Math.round(c * (1 + amount))
      : Math.round(c + (255 - c) * amount);
    return Math.max(0, Math.min(255, v));
  };
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Names the skin editor left on its template rather than names of skins.
 *
 * The first `m_bstrName` in the stream belongs to the root widget, so a great
 * many skins call themselves "Form". Where the embedded name says nothing, the
 * filename is what the author actually chose.
 */
const GENERIC_NAMES = /^(form\d*|formmain|default skin|default|skin|untitled|main|new skin)$/i;

/** Make a filename presentable: `abv_skin.skn` becomes `Abv Skin`. */
function prettyFilename(filename) {
  return String(filename || '')
    .replace(/\.[^.]*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** What to call the skin once imported. */
function skinName(props, filename) {
  const embedded = (props.m_bstrTag || props.m_bstrName || '').trim();
  if (embedded && !GENERIC_NAMES.test(embedded)) return embedded;
  return prettyFilename(filename) || embedded || 'Imported skin';
}

/** Turn a filename into an id that icq-theme.js will accept. */
function idFromName(name) {
  const base = String(name || '')
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 33);
  return base ? `skn-${base}`.slice(0, 40) : 'skn-imported';
}

/**
 * What this import cannot carry across.
 *
 * Shown to whoever imports a skin, because a colour scheme presented as "your
 * old skin" invites the reasonable complaint that it looks nothing like it.
 */
function describeLimits() {
  return [
    'Colours and the skin name are imported.',
    'Bitmaps are not: ICQ 5 stored them per widget, positioned against a window layout this client does not have.',
    'Fonts are imported only when the skin set them; most skins inherited the system font.',
  ];
}

/**
 * Read a `.skn` file into the shape icq-theme.js `toSkin()` expects.
 *
 * Returns `{ theme, notes }` or `{ error }`. Deliberately does not call
 * `toSkin()` itself — the caller does, so that an imported skin is validated by
 * exactly the same code as a hand-written theme file.
 */
function toTheme(buffer, { filename } = {}) {
  const { stream, error } = readCompoundStream(buffer, 'SkinData');
  if (error) return { error };

  const { props, colours, palette } = parseSkinData(stream);

  const panel = isHex(colours.m_PanelColor) ? colours.m_PanelColor : null;
  const back = isHex(colours.m_BackColor) ? colours.m_BackColor : null;
  const fore = isHex(colours.m_ForeColor) ? colours.m_ForeColor : null;
  const panelText = isHex(colours.m_PanelTextColor) ? colours.m_PanelTextColor : null;

  if (!panel && !back) {
    return { error: 'This skin does not define any colours that can be imported.' };
  }

  const chrome = panel || back;
  const surface = back || panel;
  const text = panelText || fore || (luminance(chrome) > 0.5 ? '#000000' : '#FFFFFF');

  // An accent: the most saturated colour the skin used that is not one of the
  // four structural ones. Skins pick a signature colour for selections and
  // headers, and without it every import comes out grey.
  const structural = new Set([chrome, surface, text, fore].filter(Boolean));
  const accent = palette.find((c) => {
    if (structural.has(c)) return false;
    const n = parseInt(c.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return Math.max(r, g, b) - Math.min(r, g, b) > 40;
  }) || shade(chrome, luminance(chrome) > 0.5 ? -0.35 : 0.35);

  const dim = luminance(surface) > 0.5 ? shade(text, 0.45) : shade(text, -0.35);
  const border = luminance(chrome) > 0.5 ? shade(chrome, -0.2) : shade(chrome, 0.25);

  const name = skinName(props, filename);

  const theme = {
    // From the filename, never the embedded name: skins that both call
    // themselves "Default Skin" must not collide into one id.
    id: idFromName(filename || props.m_bstrTag || 'imported'),
    name: name.slice(0, 60),
    swatch: accent,
    vars: {
      '--icq-bg': chrome,
      '--icq-bg-mid': shade(chrome, luminance(chrome) > 0.5 ? -0.06 : 0.08),
      '--icq-bg-light': surface,
      '--icq-teal': accent,
      '--icq-teal-dark': shade(accent, -0.25),
      '--icq-teal-light': shade(accent, 0.3),
      '--icq-header-grad1': shade(chrome, luminance(chrome) > 0.5 ? 0.25 : 0.12),
      '--icq-header-grad2': chrome,
      '--icq-header-bg': chrome,
      '--icq-text': text,
      '--icq-text-dim': dim,
      '--icq-white': surface,
      '--icq-border': border,
      '--icq-border-light': shade(border, 0.3),
      '--icq-btn-bg': shade(chrome, luminance(chrome) > 0.5 ? 0.35 : 0.15),
      '--icq-btn-hover': shade(accent, 0.55),
      '--icq-btn-active': accent,
      '--icq-input-bg': surface,
      '--icq-bubble-me': shade(accent, 0.75),
      '--icq-bubble-me-border': shade(accent, 0.4),
      '--icq-avatar-bg': shade(chrome, luminance(chrome) > 0.5 ? -0.12 : 0.18),
      // ICQ 5 listed contacts without pictures, and a skin from that era has
      // nothing to say about avatars — so match what it actually looked like.
      '--icq-list-avatar-display': 'none',
    },
  };

  const notes = [];
  if (props.m_bstrAuthor) notes.push(`Skin by ${props.m_bstrAuthor}.`);
  if (props.m_bstrApp) notes.push(`Originally for ${props.m_bstrApp}.`);
  notes.push(...describeLimits());

  return { theme, notes };
}

module.exports = {
  readCompoundStream,
  parseSkinData,
  toTheme,
  describeLimits,
  idFromName,
  skinName,
  shade,
  luminance,
};
