/**
 * A theme file is untrusted input that ends up in the renderer's stylesheet.
 *
 * The tests that matter here are the refusals. CSS custom properties are not
 * inert — a value containing url() fetches when the property is used — so a
 * theme could report every launch to whoever wrote it. These pin that shut.
 */

const { isSafeValue, isSafeId, toSkin, mergeSkins, ALLOWED_PROPERTIES } = require('./icq-theme');

const validTheme = (over = {}) => ({
  id: 'midnight',
  name: 'Midnight',
  swatch: '#223355',
  vars: { '--icq-bg': '#101820', '--icq-text': '#e0e0e0' },
  ...over,
});

describe('refusing values that can reach the network', () => {
  it('refuses url()', () => {
    expect(isSafeValue('url(https://tracker.example/p.png)')).toBe(false);
  });

  it('refuses url() hidden inside a gradient', () => {
    expect(isSafeValue('linear-gradient(180deg, url(https://x/p.png), #fff)')).toBe(false);
  });

  it('refuses url() however it is spaced or cased', () => {
    expect(isSafeValue('URL ( https://x/p.png )')).toBe(false);
    expect(isSafeValue('Url(https://x)')).toBe(false);
  });

  it('refuses image-set and element, which also fetch', () => {
    expect(isSafeValue('image-set("a.png" 1x)')).toBe(false);
    expect(isSafeValue('element(#someid)')).toBe(false);
  });

  it('refuses @import and expression', () => {
    expect(isSafeValue('@import "evil.css"')).toBe(false);
    expect(isSafeValue('expression(alert(1))')).toBe(false);
  });

  it('refuses javascript: URLs', () => {
    expect(isSafeValue('javascript:alert(1)')).toBe(false);
  });
});

describe('refusing values that can escape the declaration', () => {
  it('refuses a semicolon, which would start a new declaration', () => {
    expect(isSafeValue('#fff; background: red')).toBe(false);
  });

  it('refuses braces, which would close the rule', () => {
    expect(isSafeValue('#fff} body {display:none')).toBe(false);
  });

  it('refuses angle brackets and backslashes', () => {
    expect(isSafeValue('<script>')).toBe(false);
    expect(isSafeValue('\\75 rl(x)')).toBe(false);
  });

  it('refuses an absurdly long value', () => {
    expect(isSafeValue(`#${'a'.repeat(500)}`)).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    expect(isSafeValue(null)).toBe(false);
    expect(isSafeValue(42)).toBe(false);
    expect(isSafeValue({})).toBe(false);
  });
});

describe('accepting what a theme legitimately needs', () => {
  it('accepts hex in every length', () => {
    for (const v of ['#fff', '#ffff', '#ffffff', '#ffffffff']) expect(isSafeValue(v)).toBe(true);
  });

  it('accepts rgb, rgba, hsl and hsla', () => {
    expect(isSafeValue('rgb(16, 24, 32)')).toBe(true);
    expect(isSafeValue('rgba(16, 24, 32, 0.5)')).toBe(true);
    expect(isSafeValue('hsl(210 40% 20%)')).toBe(true);
    expect(isSafeValue('hsla(210, 40%, 20%, .5)')).toBe(true);
  });

  it('accepts gradients, which skins genuinely use', () => {
    expect(isSafeValue('linear-gradient(180deg, #DEEDD4 0%, #97C770 100%)')).toBe(true);
    expect(isSafeValue('radial-gradient(circle, #fff, #000)')).toBe(true);
  });

  it('accepts the display keywords the avatar switch needs', () => {
    expect(isSafeValue('none')).toBe(true);
    expect(isSafeValue('flex')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isSafeValue('  #ffffff  ')).toBe(true);
  });
});

describe('theme ids', () => {
  it('accepts lowercase, digits and hyphens', () => {
    expect(isSafeId('midnight-2')).toBe(true);
  });

  it('refuses anything that could confuse a selector or a path', () => {
    expect(isSafeId('../../etc/passwd')).toBe(false);
    expect(isSafeId('Midnight')).toBe(false);
    expect(isSafeId('has space')).toBe(false);
    expect(isSafeId('')).toBe(false);
    expect(isSafeId('-leading')).toBe(false);
  });
});

describe('building a skin from a theme file', () => {
  it('accepts a well-formed theme', () => {
    const { skin, error } = toSkin(validTheme());
    expect(error).toBeUndefined();
    expect(skin).toMatchObject({ id: 'midnight', name: 'Midnight', custom: true });
  });

  it('marks it as custom so it cannot pass as built in', () => {
    expect(toSkin(validTheme()).skin.custom).toBe(true);
  });

  it('fills in every property a skin must define', () => {
    // A partial skin would leave values behind from whichever skin was applied
    // before it — the exact bug the built-in skins are written to avoid.
    const { skin } = toSkin(validTheme());
    for (const p of ALLOWED_PROPERTIES) expect(skin.vars[p]).toBeDefined();
  });

  it('drops an unsafe value but keeps the rest of the theme', () => {
    const { skin, warnings } = toSkin(validTheme({
      vars: { '--icq-bg': '#101820', '--icq-avatar-bg': 'url(https://x/p.png)' },
    }));
    expect(skin.vars['--icq-bg']).toBe('#101820');
    expect(skin.vars['--icq-avatar-bg']).not.toContain('url');
    expect(warnings.join(' ')).toMatch(/--icq-avatar-bg/);
  });

  it('ignores properties it does not know', () => {
    const { skin, warnings } = toSkin(validTheme({
      vars: { '--icq-bg': '#101820', '--evil-thing': '#fff' },
    }));
    expect(skin.vars['--evil-thing']).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/--evil-thing/);
  });

  it('falls back to a safe swatch when the given one is not', () => {
    const { skin } = toSkin(validTheme({ swatch: 'url(https://x)' }));
    expect(skin.swatch).not.toContain('url');
  });

  it('refuses a theme with no usable property at all', () => {
    expect(toSkin(validTheme({ vars: { '--icq-bg': 'url(https://x)' } })).error).toMatch(/at least one/);
  });

  it('refuses a theme that is not an object', () => {
    expect(toSkin(null).error).toBeDefined();
    expect(toSkin([]).error).toBeDefined();
    expect(toSkin('a string').error).toBeDefined();
  });

  it('refuses a missing or unusable id and says so', () => {
    expect(toSkin(validTheme({ id: 'Bad Id' })).error).toMatch(/id/);
  });

  it('refuses a missing name', () => {
    expect(toSkin(validTheme({ name: '   ' })).error).toMatch(/name/);
  });

  it('records where it came from, for the interface to show', () => {
    expect(toSkin(validTheme(), { source: 'midnight.json' }).skin.source).toBe('midnight.json');
  });
});

describe('merging themes with the built-in skins', () => {
  const builtIn = [{ id: 'icq99', name: 'Classic', vars: {} }, { id: 'icq78', name: 'ICQ 7', vars: {} }];

  it('appends themes after the built-ins', () => {
    const merged = mergeSkins(builtIn, [{ id: 'midnight', name: 'Midnight', vars: {} }]);
    expect(merged.map((s) => s.id)).toEqual(['icq99', 'icq78', 'midnight']);
  });

  it('refuses to let a theme replace a built-in by claiming its id', () => {
    // Otherwise a theme file could silently become the skin somebody is using.
    const merged = mergeSkins(builtIn, [{ id: 'icq99', name: 'Impostor', vars: {} }]);
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.id === 'icq99').name).toBe('Classic');
  });

  it('keeps the first of two themes claiming the same id', () => {
    const merged = mergeSkins(builtIn, [
      { id: 'dup', name: 'First', vars: {} },
      { id: 'dup', name: 'Second', vars: {} },
    ]);
    expect(merged.filter((s) => s.id === 'dup')).toHaveLength(1);
    expect(merged.find((s) => s.id === 'dup').name).toBe('First');
  });

  it('copes with no themes at all', () => {
    expect(mergeSkins(builtIn, null)).toHaveLength(2);
    expect(mergeSkins(builtIn, [])).toHaveLength(2);
  });
});

describe('the example theme that ships with the project', () => {
  it('loads cleanly through the same code the app uses', () => {
    // A broken example is worse than none: it is the first thing anyone
    // copies, and it would teach the wrong shape.
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '..', '..', 'examples', 'themes', 'midnight.json');
    const { skin, error, warnings } = toSkin(JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(error).toBeUndefined();
    expect(warnings).toEqual([]);
    expect(skin.id).toBe('midnight');
  });
});
