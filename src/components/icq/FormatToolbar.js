/**
 * The formatting toolbar that lives above the composer textarea.
 *
 * ICQ 2001 let you choose a font face, size and colour per message. XMPP
 * cannot carry any of that today — XEP-0071 XHTML-IM was deprecated in 2018
 * after proving to be a persistent cross-site scripting vector — but
 * XEP-0393 survives, and its winning idea is that the markup IS the plain
 * text. A message reading `*hello*` looks bold here and arrives as `*hello*`
 * on a client that has never heard of the spec. Nothing is lost. This toolbar
 * surfaces the four inline styles that travel: bold, italic, strikethrough
 * and monospace.
 *
 * The selection-preservation problem is the reason buttons use onMouseDown
 * with preventDefault rather than onClick for the work. In a real browser a
 * click first moves focus to the button, which fires blur on the textarea and
 * clears its selectionStart / selectionEnd before the handler could read them.
 * Consuming the mousedown event stops the focus move, so the selection is
 * still intact when the parent's applyFormat runs. A separate onClick handler
 * then covers keyboard activation — Tab to a button, then Space or Enter —
 * where blur is not the problem (the textarea was already out of focus) and
 * the event sequence is different. Both paths call onFormat, so the button
 * is genuinely reachable from the keyboard.
 */

import React from 'react';
import './FormatToolbar.css';

const BUTTONS = [
  { label: 'B', marker: '*', title: 'Bold (Ctrl+B)',   className: 'fmt-btn-bold' },
  { label: 'I', marker: '_', title: 'Italic (Ctrl+I)', className: 'fmt-btn-italic' },
  { label: 'S', marker: '~', title: 'Strikethrough',   className: 'fmt-btn-strike' },
  { label: 'M', marker: '`', title: 'Monospace',       className: 'fmt-btn-mono' },
];

export default function FormatToolbar({ onFormat }) {
  return (
    <span className="format-toolbar" role="toolbar" aria-label="Text formatting">
      {BUTTONS.map(({ label, marker, title, className }) => (
        <button
          key={marker}
          type="button"
          className={`format-btn ${className}`}
          title={title}
          aria-label={title}
          onMouseDown={(e) => {
            // Prevent the browser from moving focus here, which would fire blur
            // on the textarea and wipe its selection before applyFormat reads it.
            e.preventDefault();
          }}
          onClick={() => {
            onFormat(marker);
          }}
        >
          {label}
        </button>
      ))}
    </span>
  );
}
