/**
 * The validation rules are the part that matters most here. A bad colour value
 * that reached the stylesheet could cause the message area to make a network
 * request — the same risk icq-theme.js guards against at the theme-file level.
 * These tests pin the refusals that keep the Owner's settings from becoming a
 * CSS injection surface.
 */

import {
  FONTS,
  BACKGROUNDS,
  MIN_SIZE,
  MAX_SIZE,
  DEFAULT_APPEARANCE,
  validateFont,
  validateSize,
  validateColour,
  validateBackground,
  toCssProps,
} from './appearance';

// ── font validation ──────────────────────────────────────────────────────────

describe('font validation', () => {
  it('accepts every font on the built-in list', () => {
    for (const font of FONTS) {
      const { value, error } = validateFont(font);
      expect(error).toBeUndefined();
      expect(value).toBe(`"${font}"`);
    }
  });

  it('is not sensitive to the case the caller uses', () => {
    const { value, error } = validateFont('tahoma');
    expect(error).toBeUndefined();
    // Returns the canonical capitalisation, not the caller's version.
    expect(value).toBe('"Tahoma"');
  });

  it('refuses a font that is not on the list', () => {
    const { error } = validateFont('Comic Sans MS');
    expect(error).toMatch(/not available/);
  });

  it('refuses a font name designed to escape a CSS value', () => {
    // A name containing ; or { would be an injection attempt.
    const { error } = validateFont('Tahoma; color: red');
    expect(error).toMatch(/not available/);
  });

  it('refuses a non-string', () => {
    const { error } = validateFont(42);
    expect(error).toBeDefined();
  });

  it('quotes the value so a name with spaces is not misread as two keywords', () => {
    const { value } = validateFont('Times New Roman');
    expect(value).toBe('"Times New Roman"');
  });
});

// ── size validation ──────────────────────────────────────────────────────────

describe('size validation', () => {
  it('accepts the minimum size', () => {
    const { value, error } = validateSize(MIN_SIZE);
    expect(error).toBeUndefined();
    expect(value).toBe(`${MIN_SIZE}px`);
  });

  it('accepts the maximum size', () => {
    const { value, error } = validateSize(MAX_SIZE);
    expect(error).toBeUndefined();
    expect(value).toBe(`${MAX_SIZE}px`);
  });

  it('accepts a numeric string, the way a form field would produce it', () => {
    const { value, error } = validateSize('14');
    expect(error).toBeUndefined();
    expect(value).toBe('14px');
  });

  it('rounds a fractional size rather than refusing it', () => {
    const { value } = validateSize(11.6);
    expect(value).toBe('12px');
  });

  it('refuses a size below the minimum', () => {
    const { error } = validateSize(MIN_SIZE - 1);
    expect(error).toMatch(/between/);
  });

  it('refuses a size above the maximum', () => {
    const { error } = validateSize(MAX_SIZE + 1);
    expect(error).toMatch(/between/);
  });

  it('refuses a non-numeric string', () => {
    const { error } = validateSize('large');
    expect(error).toBeDefined();
  });

  it('refuses NaN and Infinity, which Number() would otherwise produce', () => {
    expect(validateSize(NaN).error).toBeDefined();
    expect(validateSize(Infinity).error).toBeDefined();
    expect(validateSize(null).error).toBeDefined();
  });
});

// ── colour validation ────────────────────────────────────────────────────────

describe('colour validation — values that must be refused', () => {
  it('refuses url(), which would fetch a remote image', () => {
    expect(validateColour('url(https://tracker.example/pixel.png)').error).toBeDefined();
  });

  it('refuses url() in any capitalisation', () => {
    expect(validateColour('URL(https://x/p.png)').error).toBeDefined();
    expect(validateColour('Url(x)').error).toBeDefined();
  });

  it('refuses expression(), which runs script in old IE', () => {
    expect(validateColour('expression(alert(1))').error).toBeDefined();
  });

  it('refuses @import', () => {
    expect(validateColour('@import "evil.css"').error).toBeDefined();
  });

  it('refuses javascript: URIs', () => {
    expect(validateColour('javascript:alert(1)').error).toBeDefined();
  });

  it('refuses a semicolon, which would open a new declaration', () => {
    expect(validateColour('#fff; color: red').error).toBeDefined();
  });

  it('refuses braces, which would close the rule block', () => {
    expect(validateColour('#fff} body { display:none').error).toBeDefined();
  });

  it('refuses angle brackets and backslashes', () => {
    expect(validateColour('<script>').error).toBeDefined();
    expect(validateColour('\\75 rl(x)').error).toBeDefined();
  });

  it('refuses a value that is absurdly long', () => {
    expect(validateColour(`#${'f'.repeat(200)}`).error).toBeDefined();
  });

  it('refuses a non-string', () => {
    expect(validateColour(null).error).toBeDefined();
    expect(validateColour(42).error).toBeDefined();
    expect(validateColour({}).error).toBeDefined();
  });

  it('refuses gradients, which are not colours', () => {
    // A colour field should produce a colour. Accepting gradients here would
    // mean colour and background validation are indistinguishable.
    expect(validateColour('linear-gradient(180deg, #fff, #000)').error).toBeDefined();
  });

  it('refuses CSS keywords, which are not colours', () => {
    expect(validateColour('inherit').error).toBeDefined();
    expect(validateColour('transparent').error).toBeDefined();
  });
});

describe('colour validation — values that must be accepted', () => {
  it('accepts three-digit hex', () => {
    const { value, error } = validateColour('#f00');
    expect(error).toBeUndefined();
    expect(value).toBe('#f00');
  });

  it('accepts six-digit hex', () => {
    const { value, error } = validateColour('#ff0000');
    expect(error).toBeUndefined();
    expect(value).toBe('#ff0000');
  });

  it('accepts four-digit and eight-digit hex with alpha', () => {
    expect(validateColour('#f00f').error).toBeUndefined();
    expect(validateColour('#ff0000ff').error).toBeUndefined();
  });

  it('accepts rgb()', () => {
    const { value, error } = validateColour('rgb(255, 0, 0)');
    expect(error).toBeUndefined();
    expect(value).toBe('rgb(255, 0, 0)');
  });

  it('accepts rgba()', () => {
    expect(validateColour('rgba(255, 0, 0, 0.5)').error).toBeUndefined();
  });

  it('accepts hsl() and hsla()', () => {
    expect(validateColour('hsl(0, 100%, 50%)').error).toBeUndefined();
    expect(validateColour('hsla(0, 100%, 50%, .8)').error).toBeUndefined();
  });

  it('trims surrounding whitespace and returns the trimmed value', () => {
    const { value } = validateColour('  #ff0000  ');
    expect(value).toBe('#ff0000');
  });
});

// ── background validation ────────────────────────────────────────────────────

describe('background validation', () => {
  it('accepts every name from the built-in list and returns a CSS value', () => {
    for (const name of Object.keys(BACKGROUNDS)) {
      const { value, error } = validateBackground(name);
      expect(error).toBeUndefined();
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('is not sensitive to the case of the name', () => {
    const lower = validateBackground('none');
    const upper = validateBackground('NONE');
    expect(lower.error).toBeUndefined();
    expect(upper.error).toBeUndefined();
    expect(lower.value).toBe(upper.value);
  });

  it('refuses a name not on the list', () => {
    const { error } = validateBackground('wallpaper.jpg');
    expect(error).toMatch(/built-in background/);
  });

  it('refuses an empty string', () => {
    const { error } = validateBackground('');
    expect(error).toBeDefined();
  });

  it('refuses a non-string', () => {
    const { error } = validateBackground(null);
    expect(error).toBeDefined();
  });

  it('produces no url() value for any built-in background', () => {
    // A url() would fetch a remote resource the moment it was applied to the
    // message area — the same attack icq-theme.js was written to prevent.
    for (const css of Object.values(BACKGROUNDS)) {
      expect(css.toLowerCase()).not.toContain('url(');
    }
  });

  it('the "none" background maps to a transparent value', () => {
    const { value } = validateBackground('none');
    expect(value).toBe('transparent');
  });
});

// ── CSS property mapping ─────────────────────────────────────────────────────

describe('mapping settings to CSS custom properties', () => {
  it('returns the four properties the message area reads', () => {
    const props = toCssProps({ fontFamily: 'Tahoma', fontSize: 12, colour: '#000000', background: 'none' });
    expect(props).toHaveProperty('--icq-chat-font');
    expect(props).toHaveProperty('--icq-chat-font-size');
    expect(props).toHaveProperty('--icq-chat-colour');
    expect(props).toHaveProperty('--icq-chat-background');
  });

  it('uses validated values, not raw input', () => {
    const props = toCssProps({ fontFamily: 'Tahoma', fontSize: 12, colour: '#336699', background: 'ice' });
    expect(props['--icq-chat-font']).toBe('"Tahoma"');
    expect(props['--icq-chat-font-size']).toBe('12px');
    expect(props['--icq-chat-colour']).toBe('#336699');
    // The ice background is a gradient, not the literal string 'ice'.
    expect(props['--icq-chat-background']).toMatch(/gradient/);
  });

  it('falls back to a safe default for an invalid font rather than propagating the bad value', () => {
    const props = toCssProps({ fontFamily: 'Comic Sans MS' });
    expect(props['--icq-chat-font']).toBe('"Tahoma"');
  });

  it('falls back to a safe default for an out-of-range size', () => {
    const props = toCssProps({ fontSize: 999 });
    expect(props['--icq-chat-font-size']).toBe('11px');
  });

  it('falls back to an empty colour for a colour that would fetch a resource', () => {
    const props = toCssProps({ colour: 'url(https://x/tracker.png)' });
    // Empty string leaves the property unset, which is the safest fallback —
    // the skin's text colour takes over rather than something injected.
    expect(props['--icq-chat-colour']).toBe('');
  });

  it('falls back to transparent for an invalid background name', () => {
    const props = toCssProps({ background: 'C:/Users/alex/wallpaper.jpg' });
    expect(props['--icq-chat-background']).toBe('transparent');
  });

  it('copes with a completely empty settings object', () => {
    const props = toCssProps({});
    expect(props['--icq-chat-font']).toBe('"Tahoma"');
    expect(props['--icq-chat-font-size']).toBe('11px');
  });

  it('copes with null, the way localStorage produces before first save', () => {
    const props = toCssProps(null);
    expect(props['--icq-chat-background']).toBe('transparent');
  });
});

// ── defaults ─────────────────────────────────────────────────────────────────

describe('default appearance settings', () => {
  it('validates cleanly through every function', () => {
    expect(validateFont(DEFAULT_APPEARANCE.fontFamily).error).toBeUndefined();
    expect(validateSize(DEFAULT_APPEARANCE.fontSize).error).toBeUndefined();
    expect(validateBackground(DEFAULT_APPEARANCE.background).error).toBeUndefined();
    // colour defaults to empty string, which validateColour refuses — that is
    // intentional: empty means "use the skin's colour", not "inject nothing".
  });

  it('produces a fully-populated CSS props object', () => {
    const props = toCssProps(DEFAULT_APPEARANCE);
    expect(Object.keys(props)).toHaveLength(4);
  });
});
