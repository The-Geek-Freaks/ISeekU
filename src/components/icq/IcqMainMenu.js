import React, { useState, useRef, useEffect } from 'react';
import StatusIcon from './StatusIcon';
import './IcqMainMenu.css';

/**
 * The flower button, bottom-left, and the menu behind it.
 *
 * This is where ICQ put everything. Not a settings gear in a corner and not a
 * row of icons along the top — one button with the logo on it, and every
 * command in the application hanging off it. People clicked it constantly and
 * knew the menu by muscle memory.
 *
 * Rebuilding that shape matters more than it looks: scattering the same
 * commands across a toolbar would be more discoverable by modern standards and
 * would feel nothing like the original.
 *
 * The menu opens upwards, because the button sits at the bottom of the window.
 */

function Separator() {
  // Win32 separators are a groove: one dark line, one light line under it.
  return <div className="icq-menu-sep" role="separator" />;
}

function Item({ label, shortcut, onClick, submenu, checked, disabled, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="icq-menu-item-wrap"
      onMouseEnter={() => submenu && setOpen(true)}
      onMouseLeave={() => submenu && setOpen(false)}
    >
      <button
        type="button"
        className="icq-menu-item"
        role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={checked === undefined ? undefined : checked}
        aria-haspopup={submenu ? 'menu' : undefined}
        aria-expanded={submenu ? open : undefined}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="icq-menu-check">{checked ? '✓' : ''}</span>
        <span className="icq-menu-label">{label}</span>
        {shortcut && <span className="icq-menu-shortcut">{shortcut}</span>}
        {submenu && <span className="icq-menu-arrow">▸</span>}
      </button>
      {submenu && open && <div className="icq-submenu">{children}</div>}
    </div>
  );
}

export default function IcqMainMenu({
  ownStatus = 'offline',
  soundEnabled = true,
  onToggleSound,
  skins = [],
  currentSkin,
  onChooseSkin,
  games = [],
  onOpenGame,
  onAddContact,
  onMyDetails,
  onPreferences,
  onMessageArchive,
  onSignOff,
  onIncreaseScale,
  onDecreaseScale,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  // Every command closes the menu, the way a native menu does.
  const run = (fn) => () => { setOpen(false); fn?.(); };

  return (
    <div className="icq-mainmenu" ref={rootRef}>
      <button
        type="button"
        className="icq-btn icq-flower-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="ICQ"
      >
        <StatusIcon status={ownStatus} title="ICQ" />
        <span>ICQ</span>
      </button>

      {open && (
        <div className="icq-menu" role="menu" aria-label="ICQ">
          <Item label="Add/Find Users…" onClick={run(onAddContact)} />
          <Item label="My Details…" onClick={run(onMyDetails)} />
          <Item label="Message Archive…" onClick={run(onMessageArchive)} />
          <Separator />

          <Item label="Sounds" checked={soundEnabled} onClick={run(onToggleSound)} />

          <Item label="Skins" submenu>
            {skins.map((s) => (
              <button
                key={s.id}
                type="button"
                className="icq-menu-item"
                role="menuitemradio"
                aria-checked={s.id === currentSkin}
                onClick={run(() => onChooseSkin?.(s.id))}
              >
                <span className="icq-menu-check">{s.id === currentSkin ? '✓' : ''}</span>
                <span className="icq-menu-swatch" style={{ background: s.swatch }} />
                <span className="icq-menu-label">{s.name}</span>
              </button>
            ))}
          </Item>

          <Item label="Contact List Size" submenu>
            <button type="button" className="icq-menu-item" role="menuitem" onClick={run(onIncreaseScale)}>
              <span className="icq-menu-check" />
              <span className="icq-menu-label">Larger</span>
            </button>
            <button type="button" className="icq-menu-item" role="menuitem" onClick={run(onDecreaseScale)}>
              <span className="icq-menu-check" />
              <span className="icq-menu-label">Smaller</span>
            </button>
          </Item>

          {games.length > 0 && (
            <Item label="Games" submenu>
              {games.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="icq-menu-item"
                  role="menuitem"
                  onClick={run(() => onOpenGame?.(g))}
                >
                  <span className="icq-menu-check" />
                  <span className="icq-menu-label">{g.name}</span>
                </button>
              ))}
            </Item>
          )}

          <Separator />
          <Item label="Preferences…" onClick={run(onPreferences)} />
          <Separator />
          <Item label="Sign Off" onClick={run(onSignOff)} />
        </div>
      )}
    </div>
  );
}
