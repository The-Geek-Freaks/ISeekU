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
    // ICQ 5.1, as it actually looked: Windows XP chrome, Tahoma 8pt, hard
    // edges, the verified ICQ green. The bulk of this skin lives in
    // skins/icq5.css, which keys off the data-skin attribute applySkin() sets
    // — colours alone cannot produce 16px rows, Win32 bevels or the absence of
    // rounded corners. The variables below exist so the components that have
    // not been reskinned yet still land in the right palette instead of
    // staying dark.
    id: 'icq5',
    name: 'ICQ 5.1 (Authentic)',
    swatch: '#4DAB27',
    vars: {
      '--icq-bg': '#ECE9D8',
      '--icq-bg-mid': '#FFFFFF',
      '--icq-bg-light': '#E8F4E8',
      '--icq-teal': '#4DAB27',
      '--icq-teal-dark': '#3A8F1A',
      '--icq-teal-light': '#94C729',
      '--icq-header-grad1': '#0054E3',
      '--icq-header-grad2': '#A6CAF0',
      '--icq-header-bg': 'linear-gradient(180deg, #0A246A 0%, #3F8CF3 8%, #0054E3 40%, #0054E3 88%, #A6CAF0 100%)',
      '--icq-yellow': '#FFD700',
      '--icq-white': '#FFFFFF',
      '--icq-text': '#000000',
      '--icq-text-dim': '#808080',
      '--icq-border': '#ACA899',
      '--icq-border-light': '#FFFFFF',
      '--icq-online': '#4DAB27',
      '--icq-away': '#FFD700',
      '--icq-offline': '#606060',
      '--icq-dnd': '#CC0000',
      '--icq-btn-bg': '#ECE9D8',
      '--icq-btn-hover': '#E3E1D2',
      '--icq-btn-active': '#D4D0C8',
      '--icq-input-bg': '#FFFFFF',
      // A log, not bubbles — ICQ 5 had no bubbles at all.
      '--icq-bubble-me': '#FFFFFF',
      '--icq-bubble-me-border': '#ACA899',
      '--icq-avatar-bg': '#D4D0C8',
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

const DEFAULT_SKIN_ID = 'icq5';

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
