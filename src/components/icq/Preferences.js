import React, { useState, useEffect, useCallback } from 'react';
import './Preferences.css';

/**
 * Preferences.
 *
 * ICQ's own preferences dialog was a tabbed window with a page per area, and
 * that shape is worth keeping: it is where people expected to find things.
 *
 * What is deliberately NOT here: pages for features this client does not have.
 * A settings dialog full of greyed-out controls for SMS, ICQ Phone and Web
 * Aware would look more complete and be worse — every one of them is a promise
 * the application cannot keep. Every control on these pages does something.
 *
 * Settings live in localStorage under `icq-*` keys, which is where the rest of
 * the application already keeps them, so this dialog reads and writes the same
 * values the Contact List does rather than introducing a second source.
 */

const PAGES = [
  { id: 'general', label: 'General' },
  { id: 'contacts', label: 'Contact List' },
  { id: 'events', label: 'Events' },
  { id: 'status', label: 'Status' },
  { id: 'connection', label: 'Connection' },
  { id: 'about', label: 'About' },
];

/** Read a boolean the same way the rest of the app does: absent means on. */
const readBool = (key, dflt = true) => {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return dflt;
    return v !== 'off';
  } catch { return dflt; }
};

const writeBool = (key, on) => {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* private mode */ }
};

const readNumber = (key, dflt) => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : dflt;
  } catch { return dflt; }
};

/**
 * A labelled setting.
 *
 * `htmlFor` is required rather than optional: a label that is merely next to
 * its control looks identical on screen and is invisible to a screen reader,
 * and the mistake is impossible to spot by looking.
 */
function Field({ label, htmlFor, hint, children }) {
  return (
    <div className="icq-pref-field">
      <label className="icq-pref-label" htmlFor={htmlFor}>{label}</label>
      <div className="icq-pref-control">
        {children}
        {hint && <p className="icq-pref-hint">{hint}</p>}
      </div>
    </div>
  );
}

/**
 * A minutes field.
 *
 * Holds what was typed as a string rather than coercing on every keystroke.
 * Clamping as you type means clearing the field to replace the number puts a
 * 1 in immediately, so typing "5" over "10" leaves "15" — the value is only
 * settled when the field is left.
 */
function NumberField({ id, value, min, max, disabled, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = Number(draft);
    const settled = Number.isFinite(n) && n > 0
      ? Math.max(min, Math.min(max, Math.round(n)))
      : value;
    setDraft(String(settled));
    onCommit(settled);
  };

  return (
    <input
      id={id}
      className="icq-input icq-pref-number"
      type="number"
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
    />
  );
}

function Check({ id, checked, onChange, children, hint }) {
  return (
    <div className="icq-pref-check-row">
      <label className="icq-pref-check">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {children}
      </label>
      {hint && <p className="icq-pref-hint">{hint}</p>}
    </div>
  );
}

export default function Preferences({
  onClose,
  skins = [],
  currentSkin,
  onChooseSkin,
  contactScale = 1,
  onContactScale,
  soundEnabled = true,
  onToggleSound,
  showOffline = true,
  onShowOffline,
  awayMessage = '',
  onAwayMessage,
  connection,
  appVersion,
}) {
  const [page, setPage] = useState('general');

  // Local echo so the dialog responds instantly; each change is also pushed
  // to the owner immediately — ICQ's preferences applied as you set them, it
  // had no OK/Cancel round trip for most things.
  const [away, setAway] = useState(awayMessage);
  const [idleMinutes, setIdleMinutes] = useState(() => readNumber('icq-idle-away-min', 10));
  const [idleEnabled, setIdleEnabled] = useState(() => readBool('icq-idle-away', true));
  const [naMinutes, setNaMinutes] = useState(() => readNumber('icq-idle-na-min', 20));
  const [blinkEnabled, setBlinkEnabled] = useState(() => readBool('icq-blink', true));
  const [startupSound, setStartupSound] = useState(() => readBool('icq-startup-sound', true));

  useEffect(() => { setAway(awayMessage); }, [awayMessage]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const commitAway = useCallback(() => {
    onAwayMessage?.(away.trim());
  }, [away, onAwayMessage]);

  return (
    <div className="icq-pref-backdrop" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) onClose?.();
    }}
    >
      <div className="icq-pref icq-raised" role="dialog" aria-modal="true" aria-label="Preferences">
        <div className="icq-pref-body">
          <nav className="icq-pref-tabs" role="tablist" aria-orientation="vertical">
            {PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === page}
                className="icq-pref-tab"
                data-active={p.id === page ? 'true' : undefined}
                onClick={() => setPage(p.id)}
              >
                {p.label}
              </button>
            ))}
          </nav>

          <div className="icq-pref-page" role="tabpanel">
            {page === 'general' && (
              <>
                <Field label="Skin" htmlFor="pref-skin">
                  <select
                    id="pref-skin"
                    className="icq-input"
                    value={currentSkin}
                    onChange={(e) => onChooseSkin?.(e.target.value)}
                  >
                    {skins.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
                <Check id="pref-sound" checked={soundEnabled} onChange={onToggleSound}>
                  Play sounds for events
                </Check>
                <Check
                  id="pref-startup-sound"
                  checked={startupSound}
                  onChange={(v) => { setStartupSound(v); writeBool('icq-startup-sound', v); }}
                  hint="The chime when the Contact List first appears."
                >
                  Play the startup sound
                </Check>
              </>
            )}

            {page === 'contacts' && (
              <>
                <Check id="pref-offline" checked={showOffline} onChange={onShowOffline}>
                  Show offline contacts
                </Check>
                <Field label="Text size">
                  <div className="icq-pref-row">
                    <button type="button" className="icq-btn" onClick={() => onContactScale?.(Math.max(0.85, contactScale - 0.1))}>Smaller</button>
                    <button type="button" className="icq-btn" onClick={() => onContactScale?.(Math.min(1.45, contactScale + 0.1))}>Larger</button>
                    <span className="icq-pref-value">{Math.round(contactScale * 100)}%</span>
                  </div>
                </Field>
              </>
            )}

            {page === 'events' && (
              <>
                <Check
                  id="pref-blink"
                  checked={blinkEnabled}
                  onChange={(v) => { setBlinkEnabled(v); writeBool('icq-blink', v); }}
                  hint="The contact's icon alternates until the message is read."
                >
                  Blink the contact when a message arrives
                </Check>
                <p className="icq-pref-note">
                  Message windows open when you click a contact with waiting
                  messages, the way they always did.
                </p>
              </>
            )}

            {page === 'status' && (
              <>
                <Field
                  label="Away message"
                  htmlFor="pref-away"
                  hint="Sent once to anyone who writes while you are Away, N/A, Occupied or DND. Left empty, nothing is sent."
                >
                  <textarea
                    id="pref-away"
                    className="icq-input icq-pref-textarea"
                    value={away}
                    onChange={(e) => setAway(e.target.value)}
                    onBlur={commitAway}
                    rows={3}
                    maxLength={500}
                  />
                </Field>
                <Check
                  id="pref-idle"
                  checked={idleEnabled}
                  onChange={(v) => { setIdleEnabled(v); writeBool('icq-idle-away', v); }}
                >
                  Set my status automatically when I am idle
                </Check>
                <Field label="Away after" htmlFor="pref-idle-away">
                  <div className="icq-pref-row">
                    <NumberField
                      id="pref-idle-away"
                      value={idleMinutes}
                      min={1}
                      max={120}
                      disabled={!idleEnabled}
                      onCommit={(n) => {
                        setIdleMinutes(n);
                        try { localStorage.setItem('icq-idle-away-min', String(n)); } catch { /* ignore */ }
                      }}
                    />
                    <span>minutes</span>
                  </div>
                </Field>
                <Field label="N/A after" htmlFor="pref-idle-na">
                  <div className="icq-pref-row">
                    <NumberField
                      id="pref-idle-na"
                      value={naMinutes}
                      min={1}
                      max={240}
                      disabled={!idleEnabled}
                      onCommit={(n) => {
                        setNaMinutes(n);
                        try { localStorage.setItem('icq-idle-na-min', String(n)); } catch { /* ignore */ }
                      }}
                    />
                    <span>minutes</span>
                  </div>
                </Field>
              </>
            )}

            {page === 'connection' && (
              <>
                <Field label="Server" htmlFor="pref-server">
                  <span id="pref-server" className="icq-pref-value">
                    {connection?.account?.server || 'not connected'}
                  </span>
                </Field>
                <Field label="ICQ number" htmlFor="pref-uin">
                  <span id="pref-uin" className="icq-pref-value">{connection?.account?.uin || '—'}</span>
                </Field>
                <Field label="Encryption" htmlFor="pref-enc">
                  {connection?.secure
                    ? <span id="pref-enc" className="icq-pref-value">Encrypted</span>
                    : (
                      <span id="pref-enc" className="icq-pref-insecure">
                        None — your password and messages travel in readable form
                      </span>
                    )}
                </Field>
                <p className="icq-pref-note">
                  The server address is chosen when you sign in. Sign off to
                  connect to a different one.
                </p>
              </>
            )}

            {page === 'about' && (
              <>
                <p className="icq-pref-note">
                  <strong>ISeekU {appVersion || ''}</strong>
                </p>
                <p className="icq-pref-note">
                  An ICQ client speaking XMPP. Forked from ICQ Messenger by
                  Felix Helleckes, MIT licensed.
                </p>
                <p className="icq-pref-note">
                  Not affiliated with ICQ, its former owners, or the icqr.net
                  project. The interface is an original recreation.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="icq-pref-actions">
          <button type="button" className="icq-btn" onClick={() => { commitAway(); onClose?.(); }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export { PAGES, readBool, writeBool, readNumber };
