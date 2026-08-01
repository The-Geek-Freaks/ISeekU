/*
 * The right-click context menu on a Contact in the Contact List.
 *
 * ICQ's original had three sections in a defined order, recorded in
 * docs/ORIGINAL-REFERENCE.md from a screenshot verified against a primary
 * source: Send at the top, Launch (games) in the middle, User at the bottom.
 * Matching that order matters because it is what ICQ users built muscle memory
 * around, and deviation reads as something that is trying to be ICQ but got it
 * slightly wrong.
 *
 * Items whose feature is not yet in ISeekU are disabled rather than hidden. A
 * menu that changes shape between versions is worse than a consistent one with
 * some grey items: when a feature arrives, the item is simply enabled. When it
 * is hidden, the user never knows it is coming and cannot tell the difference
 * between "not done yet" and "deliberately absent." Every disabled item carries
 * a title attribute that says specifically why it cannot be used right now.
 *
 * The hard part for a context menu is positioning. The Contact List uses
 * overflow-y: auto for its scrollbar, which clips any absolutely-positioned
 * child. The StatusMenu hit exactly this bug and fixed it by making its
 * ancestor containers overflow: visible — which works when one element owns
 * both the trigger and the popup. A context menu can appear at any row in a
 * scrollable list, and that ancestor-level fix does not generalise because the
 * contact row scrolls away while the popup should stay. The solution here is a
 * React portal: the menu renders directly into document.body and is positioned
 * with fixed coordinates from the contextmenu event. Nothing in the Contact
 * List can clip it because it is not a descendant of the Contact List at all.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ContactMenu.css';

function Separator() {
  return <div className="icq-cmenu-sep" role="separator" />;
}

function SectionLabel({ children }) {
  // Section labels are visual dividers, not interactive. Using a div rather
  // than a heading or button so that screen readers group items as a menu,
  // not as a document with headings inside it.
  return <div className="icq-cmenu-section" aria-hidden="true">{children}</div>;
}

function MenuItem({ label, disabled, title, onClick, danger }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`icq-cmenu-item${danger ? ' icq-cmenu-item--danger' : ''}`}
      disabled={disabled}
      title={title}
      onClick={disabled ? undefined : onClick}
    >
      {label}
    </button>
  );
}

/**
 * The Contact right-click context menu.
 *
 * Renders via a React portal into document.body, positioned at the
 * pixel coordinates reported by the contextmenu event. Nothing in the
 * Contact List tree can clip it.
 *
 * Props:
 *   contact         — the contact object ({ uin, name, … })
 *   position        — { x, y } in viewport pixels, from e.clientX / e.clientY
 *   onClose         — called to dismiss the menu
 *   onSendMessage   — (contact) => void; if absent the item is disabled
 *   onInfo          — (contact) => void; if absent the item is disabled
 *   onRename        — (contact) => void; if absent the item is disabled
 *   onDelete        — (contact) => void; if absent the item is disabled
 *   onInviteGame    — (contact, gameId) => void; if absent game items are disabled
 */
export default function ContactMenu({
  contact,
  position,
  onClose,
  onSendMessage,
  onInfo,
  onRename,
  onDelete,
  onInviteGame,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    // Escape and click-outside both dismiss the menu. The same pattern as
    // StatusMenu, applied here because the expectation is the same: a popup
    // that traps the Owner is worse than no popup.
    const handleKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Close after any successful action — the menu should not linger.
  const act = (fn) => () => {
    fn?.();
    onClose?.();
  };

  const name = contact?.name || contact?.id || 'Contact';

  const menu = (
    <div
      ref={menuRef}
      className="icq-cmenu"
      role="menu"
      aria-label={`Options for ${name}`}
      style={{
        position: 'fixed',
        left: position?.x ?? 0,
        top: position?.y ?? 0,
      }}
    >
      {/* Send ----------------------------------------------------------------
          The original had: Send Message, Send SMS, Send File, Push2Talk,
          Multi User Chat. We expose the three most relevant to the current
          feature set and mark the rest disabled rather than hiding them. */}
      <SectionLabel>Send</SectionLabel>

      <MenuItem
        label="Send Message"
        disabled={!onSendMessage}
        title={onSendMessage ? undefined : 'No conversation is open with this Contact'}
        onClick={act(() => onSendMessage?.(contact))}
      />
      <MenuItem
        label="Send File"
        disabled
        title="File transfer is not yet implemented"
      />
      <MenuItem
        label="Send Contacts"
        disabled
        title="Contacts cannot be forwarded yet"
      />

      <Separator />

      {/* Launch -------------------------------------------------------------
          The original listed RPS Online, Slide-a-lama, Sumo Volleyball and
          More… — all Flash applets that cannot run today. Our reimplemented
          games take their place; the principle of same-menu-shape-across-
          versions means they sit in the same Launch section, same position. */}
      <SectionLabel>Launch</SectionLabel>

      <MenuItem
        label="Tic-Tac-Toe"
        disabled={!onInviteGame}
        title={onInviteGame ? undefined : 'Games require an active XMPP connection'}
        onClick={act(() => onInviteGame?.(contact, 'ttt'))}
      />
      <MenuItem
        label="Quatro"
        disabled={!onInviteGame}
        title={onInviteGame ? undefined : 'Games require an active XMPP connection'}
        onClick={act(() => onInviteGame?.(contact, 'quatro'))}
      />

      <Separator />

      {/* User ----------------------------------------------------------------
          The original had: Open Saved Files, User's Details, Move To Group,
          Rename, Delete. The per-contact Alert/Accept Modes submenu was
          verified from an ICQ 99 screenshot in docs/ORIGINAL-REFERENCE.md:
          it had four groups (User Alerts, Auto, Accept, Online Status) and
          is worth building, but it is its own feature. */}
      <SectionLabel>User</SectionLabel>

      <MenuItem
        label="User's Details"
        disabled={!onInfo}
        title={onInfo ? undefined : 'User details viewer is not yet implemented'}
        onClick={act(() => onInfo?.(contact))}
      />
      <MenuItem
        label="Alert/Accept Modes…"
        disabled
        title="Per-contact alert modes are not yet implemented"
      />
      <MenuItem
        label="Move To Group"
        disabled
        title="Group management is not yet implemented"
      />
      <MenuItem
        label="Rename"
        disabled={!onRename}
        title={onRename ? undefined : 'Renaming is not yet available'}
        onClick={act(() => onRename?.(contact))}
      />
      <MenuItem
        label="Delete"
        disabled={!onDelete}
        title={onDelete ? undefined : 'Deleting is not yet available'}
        danger
        onClick={act(() => onDelete?.(contact))}
      />
    </div>
  );

  return createPortal(menu, document.body);
}
