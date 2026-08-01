/**
 * ICQ 6.5 and ICQ 7 skins are the only ones in the lineage that are not a
 * binary format — Boxely is XML with plain hex colours — so the tests here are
 * less about parsing and more about the two things that actually went wrong:
 * a copyright banner long enough to hide the format declaration, and archives
 * that store backslashes in their paths.
 */

'use strict';

const zlib = require('zlib');
const {
  readColours,
  readPackageName,
  looksLikeBoxely,
  stripComments,
  toTheme,
  idFromName,
  describeSource,
  describeLimits,
  luminance,
  saturation,
  shade,
} = require('./icq-boxely-skin');
const { toSkin } = require('./icq-theme');

/** Build a ZIP holding the given files, with the given path separator. */
function zip(files, { separator = '/', deflate = true } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [rawName, content] of Object.entries(files)) {
    const name = rawName.split('/').join(separator);
    const nameBuf = Buffer.from(name, 'latin1');
    const body = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const stored = deflate ? zlib.deflateRawSync(body) : body;
    const method = deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, stored);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(body.length, 24);
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

const BANNER = `<!--\n${'*'.repeat(78)}\n${'   C O P Y R I G H T\n'.repeat(300)}${'*'.repeat(78)}\n-->`;

/** A style file shaped like the real ones, with the banner ahead of the PI. */
const styleFile = ({ banner = true, colours = [] } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
${banner ? BANNER : ''}
<?boxely version="1.0"?>
<library xmlns="http://www.aol.com/boxely/resource.xsd">
  <imageBrush id="imgWinBack" fill="images/common/window-background.png" fillSize="both"/>
${colours.map((c, i) => `  <style id="s${i}"><color>${c}</color></style>`).join('\n')}
</library>`;

/** Repeat a colour so it carries weight, the way a real file does. */
const times = (colour, n) => Array.from({ length: n }, () => colour);

const PACKAGE = '<Package schema="2" PackageName="Prosieben Skin">\n  <text language="en-us">Prosieben</text>\n</Package>';

const SKIN = (opts = {}) => zip({
  'pro7/Package.xml': PACKAGE,
  'pro7/Skins/pro7Skin/pro7Skin.style.box': styleFile({
    colours: [
      ...times('#FFFFFF', 20),
      ...times('#4B4A47', 14),
      ...times('#EEEEEE', 6),
      ...times('#C50026', 4),
      '#0B68AF',
    ],
  }),
  'pro7/Skins/pro7Skin/IMAGES/Common/cl-background.png': Buffer.alloc(32, 9),
}, opts);

describe('recognising the format', () => {
  it('recognises a Boxely file whose banner runs ahead of the declaration', () => {
    // Several real skins put a copyright block of several kilobytes before
    // <?boxely?>, and looking only at the head of the file missed it entirely.
    expect(looksLikeBoxely(styleFile({ banner: true }))).toBe(true);
  });

  it('recognises one by its namespace when the instruction is absent', () => {
    const xml = '<?xml version="1.0"?>\n<library xmlns="http://www.aol.com/boxely/resource.xsd"/>';
    expect(looksLikeBoxely(xml)).toBe(true);
  });

  it('refuses a file that is not Boxely at all', () => {
    expect(looksLikeBoxely('<html><body>hello</body></html>')).toBe(false);
    expect(looksLikeBoxely(null)).toBe(false);
  });

  it('does not accept a file that only mentions boxely in a comment', () => {
    // Skins were copied from one another, so a commented-out block from
    // whatever the author started with is ordinary.
    expect(looksLikeBoxely('<?xml version="1.0"?><!-- <?boxely version="1.0"?> --><html/>')).toBe(false);
  });
});

describe('reading the style file', () => {
  it('counts each colour by how often the skin uses it', () => {
    const found = readColours(styleFile({ colours: [...times('#C50026', 3), '#FFFFFF'] }));
    expect(found.find((c) => c.value === '#C50026').count).toBe(3);
    expect(found.find((c) => c.value === '#FFFFFF').count).toBe(1);
  });

  it('never reads a colour out of a comment', () => {
    // Otherwise the palette of the skin somebody copied from wins.
    const xml = `<?boxely version="1.0"?><!-- <color>#ABCDEF</color> --><style><color>#123456</color></style>`;
    const values = readColours(xml).map((c) => c.value);
    expect(values).toContain('#123456');
    expect(values).not.toContain('#ABCDEF');
  });

  it('normalises case so one colour is not counted as two', () => {
    const found = readColours('<?boxely?><a>#c50026</a><b>#C50026</b>');
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({ value: '#C50026', count: 2 });
  });

  it('reads the package name from the attribute', () => {
    expect(readPackageName(PACKAGE)).toBe('Prosieben Skin');
  });

  it('falls back to the text element when there is no attribute', () => {
    expect(readPackageName('<Package schema="2"><text language="en-us">Walla</text></Package>')).toBe('Walla');
  });

  it('returns nothing rather than guessing when there is no name', () => {
    expect(readPackageName('<Package schema="2"/>')).toBeNull();
    expect(readPackageName(null)).toBeNull();
  });

  it('strips comments without eating the document around them', () => {
    expect(stripComments('a<!-- b -->c')).toBe('ac');
  });
});

describe('turning a skin into a theme', () => {
  it('produces a theme the loader accepts', () => {
    const { theme, error } = toTheme(SKIN(), { filename: 'pro7.zip' });
    expect(error).toBeUndefined();
    const { skin, error: refused } = toSkin(theme, { source: 'pro7.zip' });
    expect(refused).toBeUndefined();
    expect(skin.custom).toBe(true);
  });

  it('takes the brand colour as the accent', () => {
    expect(toTheme(SKIN(), { filename: 'pro7.zip' }).theme.vars['--icq-teal']).toBe('#C50026');
  });

  it('chooses the frame by how much the skin uses it, not by how colourful it is', () => {
    // Picking the most saturated candidate turned every skin's frame the same
    // gold: these files descend from one template and inherit a decorative
    // tone none of them paints the window with.
    const buf = zip({
      'p/Package.xml': PACKAGE,
      'p/x.style.box': styleFile({
        colours: [...times('#FFFFFF', 20), ...times('#EEEEEE', 9), '#FFC452', ...times('#111111', 5)],
      }),
    });
    expect(toTheme(buf, { filename: 'p.zip' }).theme.vars['--icq-bg']).toBe('#EEEEEE');
  });

  it('finds the package name in an archive that stores backslashes', () => {
    // Archives made on Windows routinely do, and matching only "/" silently
    // lost the name on exactly the packages this reads.
    const { theme } = toTheme(SKIN({ separator: '\\' }), { filename: 'pro7.zip' });
    expect(theme.name).toBe('Prosieben Skin');
  });

  it('falls back to the filename when the package has no name', () => {
    const buf = zip({ 'p/x.style.box': styleFile({ colours: [...times('#FFFFFF', 6), ...times('#222222', 4)] }) });
    expect(toTheme(buf, { filename: 'bvb_v2.zip' }).theme.name).toBe('Bvb V2');
  });

  it('shows avatars, because ICQ 6 onwards did', () => {
    expect(toTheme(SKIN(), { filename: 'pro7.zip' }).theme.vars['--icq-list-avatar-display']).toBe('flex');
  });

  it('produces only values the stylesheet will accept', () => {
    const { theme } = toTheme(SKIN(), { filename: 'pro7.zip' });
    for (const value of Object.values(theme.vars)) {
      expect(value).toMatch(/^(#[0-9A-F]{6}|flex|none)$/i);
    }
  });

  it('says so plainly when given the installer instead of the package', () => {
    // The likely mistake, and "no skin data" would not help anyone fix it.
    const buf = zip({ 'ICQ 7 Skin - Pro7 Setup.exe': Buffer.alloc(64, 1) });
    expect(toTheme(buf, { filename: 'icq7.zip' }).error).toMatch(/installer, not the skin/i);
  });

  it('refuses an archive with no style file', () => {
    expect(toTheme(zip({ 'readme.txt': 'hello' }), { filename: 'x.zip' }).error).toBeTruthy();
  });

  it('refuses a style file that is not Boxely', () => {
    const buf = zip({ 'p/fake.style.box': '<html><body>not a skin</body></html>' });
    expect(toTheme(buf, { filename: 'x.zip' }).error).toMatch(/not boxely/i);
  });

  it('refuses a style file with no colours instead of inventing a theme', () => {
    const buf = zip({ 'p/x.style.box': '<?boxely version="1.0"?><library/>' });
    expect(toTheme(buf, { filename: 'x.zip' }).error).toMatch(/does not define any colours/i);
  });

  it('passes the error through when the file is not an archive', () => {
    const { error, theme } = toTheme(Buffer.alloc(2048, 0x41), { filename: 'junk.zip' });
    expect(theme).toBeUndefined();
    expect(error).toBeTruthy();
  });
});

describe('helpers', () => {
  it('makes ids distinct from the other two importers', () => {
    // plus- and skn- are taken; an id collision would let one era's skin
    // replace another's in the list.
    expect(idFromName('BVB v2.zip')).toBe('icq7-bvb-v2');
    expect(idFromName('!!!.zip')).toBe('icq7-imported');
    expect(idFromName('x'.repeat(90)).length).toBeLessThanOrEqual(40);
  });

  it('explains how to get a skin out of its installer', () => {
    expect(describeSource().join(' ')).toMatch(/innoextract/i);
  });

  it('says plainly that the images do not come across', () => {
    expect(describeLimits().join(' ')).toMatch(/png|image/i);
  });

  it('measures brightness and colourfulness', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1);
    expect(saturation('#C50026')).toBe(197);
    expect(shade('#808080', 1)).toBe('#FFFFFF');
  });
});
