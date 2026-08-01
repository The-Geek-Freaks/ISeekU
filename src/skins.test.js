/**
 * Unit tests for the skin engine.
 *
 * These run under the CRA/Jest jsdom environment (no Electron, no network),
 * so they are fast and deterministic on Windows, macOS and Linux alike.
 * They guard the two things most likely to regress silently:
 *   1. a skin missing a CSS variable (→ stale colour bleeds from the
 *      previously applied skin), and
 *   2. applySkin / persistence behaviour.
 */
import { SKINS, getSkin, getSavedSkinId, applySkin, setSkin } from './skins';

const STORAGE_KEY = 'icq-skin';

beforeEach(() => {
  localStorage.clear();
  // Strip any inline custom properties left on <html> between tests.
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-skin');
});

describe('skin registry', () => {
  test('ships at least the three default skins, each well-formed', () => {
    expect(SKINS.length).toBeGreaterThanOrEqual(3);
    for (const skin of SKINS) {
      expect(typeof skin.id).toBe('string');
      expect(skin.id).not.toHaveLength(0);
      expect(typeof skin.name).toBe('string');
      expect(typeof skin.swatch).toBe('string');
      expect(skin.vars && typeof skin.vars).toBe('object');
    }
  });

  test('skin ids are unique', () => {
    const ids = SKINS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every skin defines the EXACT same set of CSS variables', () => {
    // The whole point of writing the complete var set per skin is that
    // switching never leaves a stale value behind. If one skin is missing
    // a key, this test fails loudly instead of shipping a visual bug.
    const reference = Object.keys(SKINS[0].vars).sort();
    for (const skin of SKINS) {
      expect(Object.keys(skin.vars).sort()).toEqual(reference);
    }
  });

  test('every variable value is a non-empty string', () => {
    for (const skin of SKINS) {
      for (const [key, value] of Object.entries(skin.vars)) {
        expect(key.startsWith('--icq-')).toBe(true);
        expect(typeof value).toBe('string');
        expect(value.trim()).not.toHaveLength(0);
      }
    }
  });

  test('every skin decides for itself whether the contact list shows avatars', () => {
    // This used to assert 'none' for every skin, on the grounds that authentic
    // ICQ showed avatars only in the chat window. That is true of the classic
    // era and demonstrably false of ICQ 7, whose own product screenshot shows
    // a photograph in every contact row — it was one of the defining changes
    // of that era. The invariant is that a skin states its choice, so switching
    // skins never inherits the previous one's.
    for (const skin of SKINS) {
      expect(['none', 'flex']).toContain(skin.vars['--icq-list-avatar-display']);
    }
  });

  test('the classic-era skins hide avatars, as the client did', () => {
    for (const id of ['icq99', 'retro-teal', 'icq-green', 'msn-blue']) {
      const skin = SKINS.find((s) => s.id === id);
      expect(skin.vars['--icq-list-avatar-display']).toBe('none');
    }
  });

  test('the ICQ 7 skin shows them, as that client did', () => {
    expect(SKINS.find((s) => s.id === 'icq78').vars['--icq-list-avatar-display']).toBe('flex');
  });
});

describe('getSkin', () => {
  test('returns the matching skin by id', () => {
    expect(getSkin('msn-blue').id).toBe('msn-blue');
  });

  test('falls back to the first skin for an unknown id', () => {
    expect(getSkin('does-not-exist').id).toBe(SKINS[0].id);
  });
});

describe('getSavedSkinId', () => {
  test('defaults to the first skin when nothing is saved', () => {
    expect(getSavedSkinId()).toBe(SKINS[0].id);
  });

  test('returns a previously saved, valid skin id', () => {
    localStorage.setItem(STORAGE_KEY, 'icq-green');
    expect(getSavedSkinId()).toBe('icq-green');
  });

  test('ignores an invalid saved id and falls back to default', () => {
    localStorage.setItem(STORAGE_KEY, 'garbage');
    expect(getSavedSkinId()).toBe(SKINS[0].id);
  });
});

describe('applySkin', () => {
  test('writes every variable onto <html> and tags data-skin', () => {
    applySkin('icq-green');
    const root = document.documentElement;
    expect(root.getAttribute('data-skin')).toBe('icq-green');
    const green = getSkin('icq-green');
    for (const [key, value] of Object.entries(green.vars)) {
      expect(root.style.getPropertyValue(key)).toBe(value);
    }
  });

  test('switching skins fully overwrites the previous skin (no stale values)', () => {
    applySkin('retro-teal');
    applySkin('msn-blue');
    const root = document.documentElement;
    const msn = getSkin('msn-blue');
    // A representative variable must reflect the NEW skin, not the old one.
    expect(root.style.getPropertyValue('--icq-bg')).toBe(msn.vars['--icq-bg']);
    expect(root.getAttribute('data-skin')).toBe('msn-blue');
  });
});

describe('setSkin', () => {
  test('persists the choice and applies it', () => {
    setSkin('icq-green');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('icq-green');
    expect(document.documentElement.getAttribute('data-skin')).toBe('icq-green');
  });
});
