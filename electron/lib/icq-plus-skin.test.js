/**
 * ICQ Plus skins are ZIP archives from around 2001, downloaded from archives
 * that have been unmaintained for twenty years, so most of these tests are
 * about a malformed archive being refused rather than crashing.
 *
 * The rest are about the colour reader, which is where this format is hard:
 * a COLORREF is four bytes with a zero in the last one, which is common enough
 * in binary data that a naive scan finds far more noise than palette. The tests
 * pin the two rules that make it work — text is never a colour, and colours
 * come in runs.
 */

'use strict';

const zlib = require('zlib');
const {
  readZipEntry,
  readStrings,
  readColours,
  parseIndex,
  toTheme,
  idFromName,
  shade,
  luminance,
  saturation,
  describeLimits,
} = require('./icq-plus-skin');
const { toSkin } = require('./icq-theme');

/** A length-prefixed ASCII string, as skininfo.dat stores one. */
function str(text) {
  const body = Buffer.from(text, 'latin1');
  const head = Buffer.alloc(2);
  head.writeUInt16LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** A Windows COLORREF: red, green, blue, zero. */
function colour(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return Buffer.from([(n >> 16) & 255, (n >> 8) & 255, n & 255, 0]);
}

/** Build a skininfo.dat with the given body after the standard header. */
function skinInfo(body, { version = [4, 3], description = '' } = {}) {
  return Buffer.concat([
    Buffer.from('VE', 'latin1'),
    Buffer.from(version),
    str('ICQPlus skin file'),
    str(description),
    body,
  ]);
}

/** Build a ZIP holding the given files. `deflate` exercises the other path. */
function zip(files, { deflate = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'latin1');
    const stored = deflate ? zlib.deflateRawSync(content) : content;
    const method = deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + stored.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  return Buffer.concat([localPart, centralPart, eocd]);
}

/** A section with its palette, in the layout a real skin uses. */
const section = (name, colours) => Buffer.concat([
  str(name),
  Buffer.alloc(12),
  ...colours.map(colour),
  str('MS Sans Serif'),
  str('bkgnd.bmp'),
]);

const SKIN = () => zip({
  'skininfo.dat': skinInfo(
    Buffer.concat([
      str('CSkin'),
      section('Main dialog', ['#4E86D4', '#5580BC', '#FFFFFF', '#EDF1F8']),
      section('Other dialogs', ['#4E86D4', '#FFFFFF']),
    ]),
    { description: 'Dieses Skin ist dem Longhorn Design nach empfunden.' },
  ),
  'bkgnd.bmp': Buffer.alloc(64, 7),
});

describe('opening the archive', () => {
  it('finds the index inside the zip', () => {
    const { data, error } = readZipEntry(SKIN(), (n) => /skininfo\.dat$/i.test(n));
    expect(error).toBeUndefined();
    expect(data.toString('latin1', 0, 2)).toBe('VE');
  });

  it('inflates a deflated index', () => {
    const archive = zip({ 'skininfo.dat': skinInfo(section('Main dialog', ['#FFFFFF', '#C0C0C0'])) }, { deflate: true });
    const { data, error } = readZipEntry(archive, (n) => /skininfo\.dat$/i.test(n));
    expect(error).toBeUndefined();
    expect(data.toString('latin1', 0, 2)).toBe('VE');
  });

  it('refuses something that is not a zip', () => {
    expect(readZipEntry(Buffer.alloc(1024, 0x41), () => true).error).toMatch(/not a zip/i);
  });

  it('refuses something that is not a buffer', () => {
    expect(readZipEntry(null, () => true).error).toBeTruthy();
    expect(readZipEntry('text', () => true).error).toBeTruthy();
  });

  it('reports an archive with no index rather than guessing', () => {
    const { error } = readZipEntry(zip({ 'readme.txt': Buffer.from('hello') }), (n) => /skininfo\.dat$/i.test(n));
    expect(error).toMatch(/no icq plus skin data/i);
  });

  it('refuses a truncated archive', () => {
    expect(readZipEntry(SKIN().subarray(0, 40), () => true).error).toBeTruthy();
  });
});

describe('reading the index', () => {
  it('rejects an index without the magic', () => {
    const bad = Buffer.concat([Buffer.from('XX'), Buffer.from([4, 3]), str('Something else'), Buffer.alloc(40)]);
    expect(parseIndex(bad).error).toMatch(/not an icq plus skin/i);
  });

  it('rejects an index that starts right but identifies as something else', () => {
    const bad = Buffer.concat([Buffer.from('VE'), Buffer.from([4, 3]), str('Some other file!'), Buffer.alloc(40)]);
    expect(parseIndex(bad).error).toMatch(/not an icq plus skin/i);
  });

  it('rejects an index too short to hold a header', () => {
    expect(parseIndex(Buffer.alloc(8)).error).toBeTruthy();
    expect(parseIndex(null).error).toBeTruthy();
  });

  it('reads the version bytes, which differ across the format eras', () => {
    const early = parseIndex(skinInfo(section('Main dialog', ['#FFFFFF', '#C0C0C0']), { version: [1, 2] }));
    expect(early.version).toBe('1.2');
    const late = parseIndex(skinInfo(section('Main dialog', ['#FFFFFF', '#C0C0C0']), { version: [4, 3] }));
    expect(late.version).toBe('4.3');
  });

  it('reads the description the author wrote, including non-English text', () => {
    const { description } = parseIndex(skinInfo(section('Main dialog', ['#FFFFFF', '#C0C0C0']), {
      description: 'Viel Spa\xdf damit!',
    }));
    expect(description).toBe('Viel Spa\xdf damit!');
  });

  it('lists the sections and the images they reference', () => {
    const { sections, images, fonts } = parseIndex(skinInfo(Buffer.concat([
      section('Main dialog', ['#FFFFFF', '#C0C0C0']),
      section('Floating groups', ['#FFFFFF', '#C0C0C0']),
    ])));
    expect(sections).toEqual(['Main dialog', 'Floating groups']);
    expect(images).toContain('bkgnd.bmp');
    expect(fonts).toContain('MS Sans Serif');
  });
});

describe('finding the colours', () => {
  const read = (buf) => readColours(buf).map((c) => c.value);

  it('reads a run of colours', () => {
    const buf = Buffer.concat([Buffer.alloc(8), colour('#4E86D4'), colour('#5580BC'), Buffer.alloc(8)]);
    expect(read(buf)).toEqual(['#4E86D4', '#5580BC']);
  });

  it('ignores a colour standing on its own', () => {
    // A lone four-byte pattern is far more often a number than a colour.
    const buf = Buffer.concat([Buffer.alloc(8), colour('#4E86D4'), Buffer.from([1, 2, 3, 4]), Buffer.alloc(8)]);
    expect(read(buf)).toEqual([]);
  });

  it('drops the magenta transparency key', () => {
    const buf = Buffer.concat([colour('#FF00FF'), colour('#4E86D4'), colour('#5580BC')]);
    expect(read(buf)).not.toContain('#FF00FF');
  });

  it('prefers the longer run when two readings overlap', () => {
    // Read one byte late, `C0 C0 C0 00` repeated also parses as #C0C000 --
    // the correctly aligned four-colour reading has to win.
    const buf = Buffer.concat([
      Buffer.alloc(4),
      colour('#C0C0C0'), colour('#C0C0C0'), colour('#C0C0C0'), colour('#C0C0C0'),
      Buffer.alloc(4),
    ]);
    const found = read(buf);
    expect(found).toContain('#C0C0C0');
    expect(found).not.toContain('#C0C000');
  });

  it('never reads a filename as a colour', () => {
    // `.gif` is 2e 67 69 66 -- shifted, that reads as a saturated colour, and
    // it used to outvote the palette entirely.
    const index = skinInfo(Buffer.concat([
      str('Main dialog'),
      Buffer.alloc(12),
      colour('#4E86D4'), colour('#5580BC'),
      str('animation.gif'), str('button.jpg'), str('bkgnd.bmp'),
    ]));
    const values = parseIndex(index).colours.map((c) => c.value);
    expect(values).toContain('#4E86D4');
    expect(values.some((v) => /^#(69|70|67|6D)/i.test(v))).toBe(false);
  });

  it('counts a colour once per place it is used', () => {
    const index = skinInfo(Buffer.concat([
      section('Main dialog', ['#4E86D4', '#FFFFFF']),
      section('Other dialogs', ['#4E86D4', '#FFFFFF']),
    ]));
    const found = parseIndex(index).colours.find((c) => c.value === '#4E86D4');
    expect(found.count).toBe(2);
  });
});

describe('turning a skin into a theme', () => {
  it('produces a theme the loader accepts', () => {
    const { theme, error } = toTheme(SKIN(), { filename: 'longhorn.ipz' });
    expect(error).toBeUndefined();
    const { skin, error: refused } = toSkin(theme, { source: 'longhorn.ipz' });
    expect(refused).toBeUndefined();
    expect(skin.custom).toBe(true);
  });

  it('puts the lightest colour on the reading surface', () => {
    const { theme } = toTheme(SKIN(), { filename: 'longhorn.ipz' });
    expect(theme.vars['--icq-bg-light']).toBe('#FFFFFF');
    expect(theme.vars['--icq-bg']).not.toBe('#FFFFFF');
  });

  it('takes the skin signature colour as the accent', () => {
    const { theme } = toTheme(SKIN(), { filename: 'longhorn.ipz' });
    expect(['#4E86D4', '#5580BC']).toContain(theme.vars['--icq-teal']);
  });

  it('produces only values the stylesheet will accept', () => {
    const { theme } = toTheme(SKIN(), { filename: 'longhorn.ipz' });
    for (const value of Object.values(theme.vars)) {
      expect(value).toMatch(/^(#[0-9A-F]{6}|none)$/i);
    }
  });

  it('takes a short description as the name', () => {
    const named = zip({
      'skininfo.dat': skinInfo(section('Main dialog', ['#FFFFFF', '#C0C0C0']), { description: 'Festival skin' }),
    });
    expect(toTheme(named, { filename: 'easy-8.zip' }).theme.name).toBe('Festival skin');
  });

  it('uses the filename when the description is the author writing prose', () => {
    // Twenty skins by one designer carry the same paragraph of greetings;
    // naming them all after it would fill the list with identical entries.
    expect(toTheme(SKIN(), { filename: 'longhorn_v2.ipz' }).theme.name).toBe('Longhorn V2');
  });

  it('falls back to the filename when there is no description at all', () => {
    const plain = zip({ 'skininfo.dat': skinInfo(section('Main dialog', ['#FFFFFF', '#C0C0C0'])) });
    expect(toTheme(plain, { filename: 'big_blue.zip' }).theme.name).toBe('Big Blue');
  });

  it('ignores a description that is only a web address', () => {
    const promo = zip({
      'skininfo.dat': skinInfo(section('Main dialog', ['#FFFFFF', '#C0C0C0']), { description: 'www.easyskin.com' }),
    });
    // Splitting that on full stops used to produce a skin called "com".
    expect(toTheme(promo, { filename: 'easy-1.zip' }).theme.name).toBe('Easy 1');
  });

  it('reads a skin packed one archive deep, as archive downloads often are', () => {
    const inner = zip({ 'skininfo.dat': skinInfo(section('Main dialog', ['#4E86D4', '#FFFFFF'])) });
    const outer = zip({ 'BorgSkin.ipz': inner, 'readme.txt': Buffer.from('install me') });
    const { theme, error } = toTheme(outer, { filename: 'borgskin.zip' });
    expect(error).toBeUndefined();
    expect(theme.vars['--icq-teal']).toBe('#4E86D4');
  });

  it('gives two archives different ids', () => {
    expect(toTheme(SKIN(), { filename: 'a.ipz' }).theme.id)
      .not.toBe(toTheme(SKIN(), { filename: 'b.ipz' }).theme.id);
  });

  it('refuses a skin with no colours instead of inventing one', () => {
    const empty = zip({ 'skininfo.dat': skinInfo(Buffer.concat([str('Main dialog'), str('bkgnd.bmp')])) });
    expect(toTheme(empty, { filename: 'empty.ipz' }).error).toMatch(/does not define any colours/i);
  });

  it('says what did not come across', () => {
    const { notes } = toTheme(SKIN(), { filename: 'longhorn.ipz' });
    expect(notes.join(' ')).toMatch(/bitmaps are not/i);
    expect(notes.join(' ')).toMatch(/ICQ Plus skin format 4\.3/);
  });

  it('passes the error through when the file is not a skin', () => {
    const { error, theme } = toTheme(Buffer.alloc(2048, 0x41), { filename: 'junk.ipz' });
    expect(theme).toBeUndefined();
    expect(error).toBeTruthy();
  });
});

describe('helpers', () => {
  it('makes ids the theme loader accepts and keeps them distinct from ICQ 5 ones', () => {
    expect(idFromName('Big Blue.ipz')).toBe('plus-big-blue');
    expect(idFromName('!!!.ipz')).toBe('plus-imported');
    expect(idFromName('x'.repeat(90)).length).toBeLessThanOrEqual(40);
  });

  it('measures brightness and colourfulness', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1);
    expect(saturation('#808080')).toBe(0);
    expect(saturation('#FF0000')).toBe(255);
  });

  it('shades without leaving the range', () => {
    expect(shade('#808080', 1)).toBe('#FFFFFF');
    expect(shade('#808080', -1)).toBe('#000000');
  });

  it('says plainly that bitmaps do not come across', () => {
    expect(describeLimits().join(' ')).toMatch(/bitmaps are not/i);
  });

  it('reads length-prefixed strings and skips binary', () => {
    const buf = Buffer.concat([Buffer.alloc(4), str('Main dialog'), Buffer.from([0xff, 0x00, 0x12]), str('bkgnd.bmp')]);
    const texts = readStrings(buf).map((s) => s.text);
    expect(texts).toContain('Main dialog');
    expect(texts).toContain('bkgnd.bmp');
  });
});
