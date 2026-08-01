/**
 * A `.skn` file is untrusted input from the internet — the files people want
 * to import have been sitting on skin archives since 2005 — so most of these
 * tests are about a malformed file being refused rather than crashing, looping
 * or reading past the end of the buffer.
 *
 * The fixtures are built rather than committed: a real skin is three quarters
 * of a megabyte, and building one makes the format explicit in the test.
 */

'use strict';

const {
  readCompoundStream,
  parseSkinData,
  toTheme,
  idFromName,
  skinName,
  shade,
  luminance,
  describeLimits,
} = require('./icq-skn');
const { toSkin } = require('./icq-theme');

const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const FREESECT = 0xffffffff;
const SECTOR = 512;

/** A length-prefixed UTF-16 string record, as the widget tree stores one. */
function stringRecord(text) {
  const chars = Buffer.from(text + '\0', 'utf16le');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(10, 0);
  head.writeUInt32LE(chars.length, 4);
  return Buffer.concat([head, chars]);
}

/** An RGB colour record: tag 7, three bytes of payload. */
function colourRecord(hex) {
  const head = Buffer.alloc(8);
  head.writeUInt32LE(7, 0);
  head.writeUInt32LE(3, 4);
  return Buffer.concat([head, Buffer.from(hex.replace('#', ''), 'hex')]);
}

/** A property name followed by its colour, which is how the format pairs them. */
const colourProperty = (name, hex) => Buffer.concat([stringRecord(name), colourRecord(hex)]);

/** A string property and its string value. */
const textProperty = (name, value) => Buffer.concat([stringRecord(name), stringRecord(value)]);

/** Wrap a payload in a compound file holding it as the stream `SkinData`. */
function compoundFile(payload, { streamName = 'SkinData', sectorShift = 9 } = {}) {
  const sectorSize = 1 << sectorShift;
  // Streams below the mini cutoff live in the mini-FAT, which real skins never
  // use — pad so the fixture takes the same path a real skin does.
  const data = payload.length >= 4096
    ? payload
    : Buffer.concat([payload, Buffer.alloc(4096 - payload.length)]);

  const dataSectors = Math.ceil(data.length / sectorSize);
  const totalSectors = 2 + dataSectors; // FAT, directory, then data

  const fat = Buffer.alloc(sectorSize, 0xff);
  fat.writeUInt32LE(FATSECT, 0); // sector 0 holds the FAT itself
  fat.writeUInt32LE(ENDOFCHAIN, 4); // sector 1 is the directory
  for (let i = 0; i < dataSectors; i++) {
    const isLast = i === dataSectors - 1;
    fat.writeUInt32LE(isLast ? ENDOFCHAIN : 2 + i + 1, (2 + i) * 4);
  }

  const dir = Buffer.alloc(sectorSize);
  const writeEntry = (index, name, type, start, size) => {
    const base = index * 128;
    const chars = Buffer.from(name + '\0', 'utf16le');
    chars.copy(dir, base);
    dir.writeUInt16LE(chars.length, base + 64);
    dir[base + 66] = type;
    dir.writeUInt32LE(start, base + 116);
    dir.writeUInt32LE(size, base + 120);
  };
  writeEntry(0, 'Root Entry', 5, ENDOFCHAIN, 0);
  writeEntry(1, streamName, 2, 2, data.length);

  const header = Buffer.alloc(512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header, 0);
  header.writeUInt16LE(sectorShift, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44); // one FAT sector
  header.writeUInt32LE(1, 48); // directory starts at sector 1
  header.writeUInt32LE(4096, 56); // mini stream cutoff
  header.writeUInt32LE(ENDOFCHAIN, 60);
  header.writeUInt32LE(0, 64);
  header.writeUInt32LE(ENDOFCHAIN, 68);
  header.writeUInt32LE(0, 72);
  header.fill(0xff, 76, 512);
  header.writeUInt32LE(0, 76); // DIFAT[0]: the FAT is in sector 0

  const body = Buffer.alloc(totalSectors * sectorSize);
  fat.copy(body, 0);
  dir.copy(body, sectorSize);
  data.copy(body, 2 * sectorSize);

  return Buffer.concat([header, body]);
}

/** The four colours a skin sets globally, in the order the format stores them. */
const paletteBlock = () => Buffer.concat([
  textProperty('m_bstrAuthor', 'Kazio'),
  textProperty('m_bstrApp', 'ICQ 5'),
  textProperty('m_bstrTag', 'Midnight'),
  colourProperty('m_BackColor', '#FFFFFF'),
  colourProperty('m_ForeColor', '#804000'),
  colourProperty('m_PanelColor', '#EFEEEC'),
  colourProperty('m_PanelTextColor', '#000000'),
  colourProperty('m_BackColor', '#C88F26'), // a widget's own colour, later
]);

describe('opening the container', () => {
  it('reads the skin data stream out of a compound file', () => {
    const { stream, error } = readCompoundStream(compoundFile(paletteBlock()), 'SkinData');
    expect(error).toBeUndefined();
    expect(stream.length).toBeGreaterThan(0);
  });

  it('refuses a file that is not a compound file', () => {
    const { error } = readCompoundStream(Buffer.alloc(1024, 0x41), 'SkinData');
    expect(error).toMatch(/not an icq/i);
  });

  it('refuses something that is not a buffer at all', () => {
    expect(readCompoundStream(null, 'SkinData').error).toBeTruthy();
    expect(readCompoundStream('a string', 'SkinData').error).toBeTruthy();
  });

  it('refuses a truncated file rather than reading past its end', () => {
    const { error } = readCompoundStream(compoundFile(paletteBlock()).subarray(0, 600), 'SkinData');
    expect(error).toBeTruthy();
  });

  it('reports a missing stream instead of returning nothing silently', () => {
    const { error } = readCompoundStream(compoundFile(paletteBlock()), 'NotThere');
    expect(error).toMatch(/no readable skin data/i);
  });

  it('does not hang on a sector chain that points at itself', () => {
    // The failure mode worth protecting against: a corrupt FAT that loops.
    const file = compoundFile(paletteBlock());
    file.writeUInt32LE(2, 512 + 2 * 4); // sector 2 -> sector 2
    const { error } = readCompoundStream(file, 'SkinData');
    expect(error).toBeTruthy();
  });

  it('reads a file whose last sector is short, as real skins are', () => {
    // Real writers do not pad the file out to a sector boundary: the stream
    // ends part-way through the final sector and the file stops there. Every
    // byte of the stream is present, so this must load.
    const payload = Buffer.concat([paletteBlock(), Buffer.alloc(4200 - paletteBlock().length)]);
    const file = compoundFile(payload);
    const used = 512 + 2 * SECTOR + payload.length; // header + FAT + directory + data
    const { error, stream } = readCompoundStream(file.subarray(0, used), 'SkinData');
    expect(error).toBeUndefined();
    expect(stream).toHaveLength(payload.length);
  });

  it('still refuses a file that stops before the stream does', () => {
    const file = compoundFile(paletteBlock());
    const { error } = readCompoundStream(file.subarray(0, file.length - 900), 'SkinData');
    expect(error).toMatch(/damaged/i);
  });
});

describe('reading the widget tree', () => {
  it('pairs each colour with the property that owns it', () => {
    const { stream } = readCompoundStream(compoundFile(paletteBlock()), 'SkinData');
    const { colours } = parseSkinData(stream);
    expect(colours.m_PanelColor).toBe('#EFEEEC');
    expect(colours.m_BackColor).toBe('#FFFFFF');
    expect(colours.m_ForeColor).toBe('#804000');
    expect(colours.m_PanelTextColor).toBe('#000000');
  });

  it('keeps the first value for a name, since the global colours come first', () => {
    const { stream } = readCompoundStream(compoundFile(paletteBlock()), 'SkinData');
    const { colours, palette } = parseSkinData(stream);
    expect(colours.m_BackColor).toBe('#FFFFFF'); // not the later widget's #C88F26
    expect(palette).toContain('#C88F26'); // but it is still available as an accent
  });

  it('reads the strings the author filled in', () => {
    const { stream } = readCompoundStream(compoundFile(paletteBlock()), 'SkinData');
    const { props } = parseSkinData(stream);
    expect(props.m_bstrAuthor).toBe('Kazio');
    expect(props.m_bstrApp).toBe('ICQ 5');
    expect(props.m_bstrTag).toBe('Midnight');
  });

  it('returns empties for a stream with nothing in it', () => {
    const { props, colours, palette } = parseSkinData(Buffer.alloc(64));
    expect(props).toEqual({});
    expect(colours).toEqual({});
    expect(palette).toEqual([]);
  });
});

describe('turning a skin into a theme', () => {
  const build = (payload = paletteBlock(), filename = 'midnight_blue.skn') =>
    toTheme(compoundFile(payload), { filename });

  it('maps the panel colour to the window chrome and the back colour to the surface', () => {
    // ICQ 5 drew its frame in the panel colour and its content area in the
    // back colour, which is the distinction worth preserving.
    const { theme } = build();
    expect(theme.vars['--icq-bg']).toBe('#EFEEEC');
    expect(theme.vars['--icq-bg-light']).toBe('#FFFFFF');
  });

  it('takes a saturated colour as the accent rather than leaving it grey', () => {
    const { theme } = build();
    expect(theme.vars['--icq-teal']).toBe('#C88F26');
    expect(theme.swatch).toBe('#C88F26');
  });

  it('sets every property the theme loader knows about', () => {
    const { theme } = build();
    const { skin, error } = toSkin(theme, { source: 'x.skn' });
    expect(error).toBeUndefined();
    expect(skin.custom).toBe(true);
  });

  it('produces only values the stylesheet will accept', () => {
    // The import must not become a way around the CSS validation.
    const { theme } = build();
    for (const value of Object.values(theme.vars)) {
      expect(value).toMatch(/^(#[0-9A-F]{6}|none)$/i);
    }
  });

  it('names the skin after its tag when the tag says something', () => {
    expect(build().theme.name).toBe('Midnight');
  });

  it('falls back to the filename when the embedded name is the editor default', () => {
    const payload = Buffer.concat([
      textProperty('m_bstrName', 'Form'),
      colourProperty('m_PanelColor', '#EFEEEC'),
    ]);
    expect(build(payload, 'abv_skin.skn').theme.name).toBe('Abv Skin');
  });

  it('gives two skins with the same embedded name different ids', () => {
    const a = build(paletteBlock(), 'one.skn').theme.id;
    const b = build(paletteBlock(), 'two.skn').theme.id;
    expect(a).not.toBe(b);
  });

  it('hides avatars, because ICQ 5 had none in the contact list', () => {
    expect(build().theme.vars['--icq-list-avatar-display']).toBe('none');
  });

  it('credits the author and says what did not come across', () => {
    const { notes } = build();
    expect(notes.join(' ')).toMatch(/Kazio/);
    expect(notes.join(' ')).toMatch(/bitmaps are not/i);
  });

  it('refuses a skin with no colours instead of inventing a theme', () => {
    const { error } = toTheme(compoundFile(textProperty('m_bstrAuthor', 'Nobody')), {
      filename: 'empty.skn',
    });
    expect(error).toMatch(/does not define any colours/i);
  });

  it('picks readable text when the skin only set a background', () => {
    const dark = toTheme(compoundFile(colourProperty('m_PanelColor', '#101018')), {
      filename: 'dark.skn',
    });
    expect(dark.theme.vars['--icq-text']).toBe('#FFFFFF');

    const light = toTheme(compoundFile(colourProperty('m_PanelColor', '#F0F0F0')), {
      filename: 'light.skn',
    });
    expect(light.theme.vars['--icq-text']).toBe('#000000');
  });

  it('passes the error through when the file is not a skin', () => {
    const { error, theme } = toTheme(Buffer.alloc(2048, 0x41), { filename: 'junk.skn' });
    expect(theme).toBeUndefined();
    expect(error).toBeTruthy();
  });
});

describe('helpers', () => {
  it('makes ids the theme loader accepts', () => {
    expect(idFromName('Midnight Blue.skn')).toBe('skn-midnight-blue');
    expect(idFromName('!!!.skn')).toBe('skn-imported');
    expect(idFromName('x'.repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it('treats editor defaults as no name at all', () => {
    expect(skinName({ m_bstrName: 'Form' }, 'blue.skn')).toBe('Blue');
    expect(skinName({ m_bstrTag: 'Default Skin' }, 'blue.skn')).toBe('Blue');
    expect(skinName({ m_bstrTag: 'Aquanoid' }, 'blue.skn')).toBe('Aquanoid');
  });

  it('shades towards white and black without leaving the range', () => {
    expect(shade('#808080', 1)).toBe('#FFFFFF');
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 0)).toBe('#808080');
  });

  it('measures brightness', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1);
    expect(luminance('#000000')).toBeCloseTo(0);
  });

  it('says plainly that bitmaps do not come across', () => {
    expect(describeLimits().join(' ')).toMatch(/bitmaps are not/i);
  });
});
