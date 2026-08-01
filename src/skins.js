// ── ICQ Skin Engine ─────────────────────────────────────────
// Each skin is a flat map of CSS custom properties applied to
// <html>. Colours only — no proprietary bitmaps — so the classic
// look is *recreated* rather than redistributed.
//
// applySkin() always writes the COMPLETE variable set, so switching
// skins never leaves a stale value behind from the previous one.
//
// Contact-list avatars: each skin sets '--icq-list-avatar-display'.
// Default skins use 'none' (authentic ICQ — avatars only in the chat
// window). A custom skin can set 'flex' to show them in the list again.

const STORAGE_KEY = 'icq-skin';

export const SKINS = [
  {
    // ICQ 7 (2010) — the late era. Colours and metrics sampled from ICQ's own
    // product screenshot of the contact list, recovered from the Wayback
    // Machine; see the header of skins/icq78.css for which values are measured
    // and which are estimated.
    //
    // ICQ 7 drew its own window header. This skin does not: the OS paints the
    // caption and the skin applies the era's design language below it.
    id: 'icq78',
    name: 'ICQ 7 (2010)',
    swatch: '#97C770',
    vars: {
      '--icq-bg': '#F2F4EE',
      '--icq-bg-mid': '#FFFFFF',
      '--icq-bg-light': '#EEF6E6',
      '--icq-teal': '#7AB648',
      '--icq-teal-dark': '#5D9433',
      '--icq-teal-light': '#C4DFA6',
      '--icq-header-grad1': '#DEEDD4',
      '--icq-header-grad2': '#97C770',
      '--icq-header-bg': 'linear-gradient(180deg, #DEEDD4 0%, #C5E2B6 45%, #97C770 100%)',
      '--icq-yellow': '#F5C400',
      '--icq-white': '#FFFFFF',
      '--icq-text': '#1A1A1A',
      '--icq-text-dim': '#8A8A8A',
      '--icq-border': '#D5DACB',
      '--icq-border-light': '#FFFFFF',
      '--icq-online': '#7AB648',
      '--icq-away': '#F5C400',
      '--icq-offline': '#B0B0B0',
      '--icq-dnd': '#D64545',
      '--icq-btn-bg': '#EEF2E8',
      '--icq-btn-hover': '#EEF6E6',
      '--icq-btn-active': '#E6EEDD',
      '--icq-input-bg': '#FFFFFF',
      // This era did use bubbles, unlike the classic client.
      '--icq-bubble-me': 'linear-gradient(180deg, #FFFFFF, #EEF6E6)',
      '--icq-bubble-me-border': '#C3CDB6',
      '--icq-avatar-bg': '#E3E4DA',
      // ICQ 7 put a photograph in every contact row — the one era where the
      // contact list genuinely showed avatars.
      '--icq-list-avatar-display': 'flex',
    },
  },
  {
    // ICQ 2001b on Windows 98 — the classic era. Colours below are the
    // Windows 98 GetSysColor() defaults; the flower greens are measured from
    // the 2001b splash screen. The bulk of the skin lives in
    // skins/icq99.css, because 16px rows, two-ring Win32 bevels and the
    // absence of rounded corners cannot be expressed as colour variables.
    // See docs/ORIGINAL-REFERENCE.md and docs/CLASSIC-SKIN-SPEC.md.
    id: 'icq99',
    name: 'ICQ Classic (2001)',
    swatch: '#00FF00',
    vars: {
      '--icq-bg': '#C0C0C0',
      '--icq-bg-mid': '#FFFFFF',
      '--icq-bg-light': '#DFDFDF',
      '--icq-teal': '#00FF00',
      '--icq-teal-dark': '#008400',
      '--icq-teal-light': '#84FF00',
      '--icq-header-grad1': '#000080',
      '--icq-header-grad2': '#1084D0',
      '--icq-header-bg': 'linear-gradient(90deg, #000080 0%, #1084D0 100%)',
      '--icq-yellow': '#FFFF00',
      '--icq-white': '#FFFFFF',
      '--icq-text': '#000000',
      '--icq-text-dim': '#808080',
      '--icq-border': '#808080',
      '--icq-border-light': '#FFFFFF',
      '--icq-online': '#00FF00',
      '--icq-away': '#FFD700',
      '--icq-offline': '#808080',
      '--icq-dnd': '#FF0000',
      '--icq-btn-bg': '#C0C0C0',
      '--icq-btn-hover': '#D4D0C8',
      '--icq-btn-active': '#A0A0A0',
      '--icq-input-bg': '#FFFFFF',
      // A log, not bubbles — the classic client had no bubbles at all.
      '--icq-bubble-me': '#FFFFFF',
      '--icq-bubble-me-border': '#808080',
      '--icq-avatar-bg': '#C0C0C0',
      // Authentic: the classic contact list showed no avatars.
      '--icq-list-avatar-display': 'none',
    },
  },
  {
    id: 'retro-teal',
    name: 'ICQ Retro (Teal)',
    swatch: '#0D6B6B',
    vars: {
      '--icq-bg': '#1F2530',
      '--icq-bg-mid': '#252D3A',
      '--icq-bg-light': '#2E3748',
      '--icq-teal': '#1A8A8A',
      '--icq-teal-dark': '#0E5F5F',
      '--icq-teal-light': '#2BBFBF',
      '--icq-header-grad1': '#0D6B6B',
      '--icq-header-grad2': '#0A4E4E',
      '--icq-header-bg': 'linear-gradient(180deg, #0D6B6B 0%, #0A3A3A 100%)',
      '--icq-yellow': '#F5C400',
      '--icq-white': '#FFFFFF',
      '--icq-text': '#E0E8F0',
      '--icq-text-dim': '#7A90A8',
      '--icq-border': '#3A4A5E',
      '--icq-border-light': '#4A5E78',
      '--icq-online': '#44DD44',
      '--icq-away': '#F5C400',
      '--icq-offline': '#CC3333',
      '--icq-dnd': '#FF6600',
      '--icq-btn-bg': '#2E3748',
      '--icq-btn-hover': '#3A4A5E',
      '--icq-btn-active': '#1A8A8A',
      '--icq-input-bg': '#151B24',
      '--icq-bubble-me': 'linear-gradient(135deg, #0D5C5C, #0A3A3A)',
      '--icq-bubble-me-border': '#0E5F5F',
      '--icq-avatar-bg': 'linear-gradient(135deg, #2A4060, #1A2A40)',
      '--icq-list-avatar-display': 'none',
    },
  },
  {
    // The authentic, recreated ICQ classic look — light silver with
    // the iconic green flower accent.
    id: 'icq-green',
    name: 'ICQ Classic (Green)',
    swatch: '#5CA52E',
    vars: {
      '--icq-bg': '#E8ECF0',
      '--icq-bg-mid': '#FFFFFF',
      '--icq-bg-light': '#DCE7D2',
      '--icq-teal': '#5CA52E',
      '--icq-teal-dark': '#3E7C18',
      '--icq-teal-light': '#7FC44C',
      '--icq-header-grad1': '#6FB52E',
      '--icq-header-grad2': '#3E7C18',
      '--icq-header-bg': 'linear-gradient(180deg, #6FB52E 0%, #2F5E12 100%)',
      '--icq-yellow': '#F5C400',
      '--icq-white': '#FFFFFF',
      '--icq-text': '#1B2A1B',
      '--icq-text-dim': '#5E7152',
      '--icq-border': '#B6C2AE',
      '--icq-border-light': '#D2DCC8',
      '--icq-online': '#4CA52E',
      '--icq-away': '#E8A100',
      '--icq-offline': '#CC3333',
      '--icq-dnd': '#FF6600',
      '--icq-btn-bg': '#EAF0E2',
      '--icq-btn-hover': '#DCE7D2',
      '--icq-btn-active': '#5CA52E',
      '--icq-input-bg': '#FFFFFF',
      '--icq-bubble-me': 'linear-gradient(135deg, #DCEFC4, #C9E5A6)',
      '--icq-bubble-me-border': '#A9CE7A',
      '--icq-avatar-bg': 'linear-gradient(135deg, #8FC85E, #5CA52E)',
      '--icq-list-avatar-display': 'none',
    },
  },
  {
    // Audience multiplier — the classic MSN Messenger blue/white skin.
    id: 'msn-blue',
    name: 'MSN Messenger',
    swatch: '#2E86DE',
    vars: {
      '--icq-bg': '#EAF1FB',
      '--icq-bg-mid': '#FFFFFF',
      '--icq-bg-light': '#D6E6FA',
      '--icq-teal': '#2E86DE',
      '--icq-teal-dark': '#1862B0',
      '--icq-teal-light': '#5BA8EE',
      '--icq-header-grad1': '#4A9AE8',
      '--icq-header-grad2': '#1E5FB0',
      '--icq-header-bg': 'linear-gradient(180deg, #5BA8EE 0%, #154E96 100%)',
      '--icq-yellow': '#F5C400',
      '--icq-white': '#FFFFFF',
      '--icq-text': '#14304F',
      '--icq-text-dim': '#5E7894',
      '--icq-border': '#AEC6E4',
      '--icq-border-light': '#CFE0F4',
      '--icq-online': '#5BB72B',
      '--icq-away': '#E8A100',
      '--icq-offline': '#CC3333',
      '--icq-dnd': '#FF6600',
      '--icq-btn-bg': '#E4EEFB',
      '--icq-btn-hover': '#D6E6FA',
      '--icq-btn-active': '#2E86DE',
      '--icq-input-bg': '#FFFFFF',
      '--icq-bubble-me': 'linear-gradient(135deg, #DCEAFB, #C2DBF7)',
      '--icq-bubble-me-border': '#93BEEC',
      '--icq-avatar-bg': 'linear-gradient(135deg, #7FB4EE, #2E86DE)',
      '--icq-list-avatar-display': 'none',
    },
  },
];

const DEFAULT_SKIN_ID = 'icq78';

export function getSkin(id) {
  return SKINS.find(s => s.id === id) || SKINS[0];
}

export function getSavedSkinId() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SKINS.some(s => s.id === saved)) return saved;
  } catch (e) {}
  return DEFAULT_SKIN_ID;
}

// Apply a skin's variables to <html>. Does NOT persist or broadcast.
export function applySkin(id) {
  const skin = getSkin(id);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(skin.vars)) {
    root.style.setProperty(key, value);
  }
  root.setAttribute('data-skin', skin.id);
  return skin.id;
}

// Apply the persisted skin — call once on window load (every window).
export function applySavedSkin() {
  return applySkin(getSavedSkinId());
}

// Persist, apply locally, and broadcast to all other windows.
export function setSkin(id) {
  const skin = getSkin(id);
  try { localStorage.setItem(STORAGE_KEY, skin.id); } catch (e) {}
  applySkin(skin.id);
  try { window.api?.setSkin?.(skin.id); } catch (e) {}
  return skin.id;
}
