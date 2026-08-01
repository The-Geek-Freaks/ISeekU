/**
 * Cutting a TCP byte stream into XMPP stanzas.
 *
 * XMPP over TCP is a continuous stream with no length-prefix or delimiter.
 * The protocol defines where one stanza ends by the XML structure itself: a
 * stanza is a complete top-level child of the stream root, so it ends when
 * its closing tag brings the nesting depth back to one (the stream root sits
 * at depth one, its children start at depth two and end back at one). A
 * stream in the other direction — bytes from an RFC 7395 WebSocket client —
 * arrives one complete stanza per message, so the framing there is done for
 * us; this class is for the TCP side.
 *
 * The special case that requires the most care is `<stream:stream ...>`. It
 * is the very first element, it sits at depth one, and it is never
 * self-closing — yet the matching `</stream:stream>` only arrives at logout.
 * Waiting for it would mean never forwarding any data. So the rule is: the
 * stream opener is forwarded immediately on receipt, without waiting for a
 * close. Everything else at depth one is a complete stanza and is forwarded
 * when its close tag arrives (or immediately if it is self-closing).
 *
 * The parser is intentionally not a full XML parser. It looks for `<`, `/`,
 * `>`, `"`, and `'` to track tag boundaries and quote spans. Attributes
 * containing a `>` inside a quoted value — whether double- or single-quoted —
 * are handled by entering a quote state that skips characters until the
 * matching delimiter is seen. Without both quote styles, a server using
 * single-quoted attributes (which XML allows and icqr.net uses in its stream
 * opener) could smuggle a `>` past the framer, causing a premature tag close
 * and a corrupted depth counter from which recovery is not possible.
 *
 * Two pointers into the internal buffer are maintained:
 *
 *   `_stanzaStart` — byte offset where the current in-progress stanza begins.
 *   `_scanPos`     — byte offset where the next `feed()` call resumes scanning.
 *
 * The separation matters because TCP delivers data in arbitrary chunks. Without
 * `_scanPos`, a second `feed()` call would restart scanning from `_stanzaStart`
 * and re-parse bytes already seen, mis-counting depth and producing wrong
 * stanza boundaries. `_scanPos` ensures each byte is visited exactly once
 * across all `feed()` calls.
 *
 * The parser is kept free of I/O so it can be tested with plain Buffers.
 * `feed()` returns complete stanzas as Buffers, or null when the size limit
 * is exceeded. It never logs or emits events.
 */

'use strict';

const S_TEXT         = 0; // between tags
const S_TAG          = 1; // inside < ... > before hitting >
const S_QUOTE        = 2; // inside a double-quoted attribute value "..."
const S_QUOTE_SINGLE = 3; // inside a single-quoted attribute value '...'

class FrameParser {
  /**
   * @param {number} maxStanzaBytes — drop the connection if a single stanza
   *   accumulates more than this many bytes before completing. Guards against
   *   a server sending an unbounded blob.
   */
  constructor(maxStanzaBytes) {
    this._max        = maxStanzaBytes;
    this._buf        = Buffer.alloc(0);
    this._depth      = 0;
    this._state      = S_TEXT;
    this._tagBytes   = [];
    this._stanzaStart = 0; // start of the current in-progress stanza in _buf
    this._scanPos    = 0;  // where to resume scanning on the next feed()
  }

  /**
   * Accept new bytes from the TCP socket.
   *
   * Returns an array of complete stanzas (as Buffers) ready to send over
   * WebSocket, or null if the stanza size limit was exceeded. An empty array
   * means no stanza completed yet.
   */
  feed(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    const stanzas = [];
    let i = this._scanPos;

    while (i < this._buf.length) {
      // Size guard: if we have accumulated more than the limit without
      // completing a stanza, the stanza is too large and the connection must
      // be dropped. This fires incrementally so an over-limit stanza is
      // caught as soon as it crosses the threshold rather than only at the
      // closing tag — which might never arrive for malformed input.
      if (i - this._stanzaStart > this._max) return null;

      const ch = this._buf[i];

      if (this._state === S_QUOTE) {
        if (ch === 0x22 /* " */) this._state = S_TAG;
        i++;
        continue;
      }

      if (this._state === S_QUOTE_SINGLE) {
        if (ch === 0x27 /* ' */) this._state = S_TAG;
        i++;
        continue;
      }

      if (this._state === S_TAG) {
        if (ch === 0x22 /* " */) {
          this._state = S_QUOTE;
          i++;
          continue;
        }
        if (ch === 0x27 /* ' */) {
          this._state = S_QUOTE_SINGLE;
          i++;
          continue;
        }
        if (ch === 0x3e /* > */) {
          this._state = S_TEXT;
          const tagStr = Buffer.from(this._tagBytes).toString('ascii');
          this._tagBytes = [];
          i++;
          const r = this._handleTag(tagStr, i, stanzas);
          if (r === null) return null;
          continue;
        }
        this._tagBytes.push(ch);
        i++;
        continue;
      }

      // S_TEXT
      if (ch === 0x3c /* < */) {
        this._state = S_TAG;
        this._tagBytes = [];
      }
      i++;
    }

    // Remember where to resume on the next call. Each byte is visited exactly
    // once: we pick up here rather than re-scanning from _stanzaStart.
    this._scanPos = i;

    // Compact: drop bytes before the current stanza start. They have already
    // been extracted and sent; keeping them would make the buffer grow without
    // bound on long connections.
    const drop = this._stanzaStart;
    if (drop > 0) {
      this._buf = this._buf.slice(drop);
      this._scanPos -= drop;
      this._stanzaStart = 0;
    }

    return stanzas;
  }

  /**
   * Classify a tag (the content between `<` and `>`) and decide whether a
   * stanza just completed.
   *
   * `endOffset` is the position in `this._buf` immediately after the `>`.
   * Mutates `this._depth`. Returns null on oversize, true otherwise.
   */
  _handleTag(tagStr, endOffset, stanzas) {
    const trimmed = tagStr.trim();
    if (trimmed.startsWith('?') || trimmed.startsWith('!')) return true;

    const isClose    = trimmed.startsWith('/');
    const isSelfClose = !isClose && trimmed.endsWith('/');

    if (isClose) {
      const prevDepth = this._depth;
      this._depth = Math.max(0, this._depth - 1);

      if (prevDepth === 1) {
        // The closing </stream:stream> — forward it and we are done.
        return this._emit(endOffset, stanzas);
      }
      if (this._depth === 1) {
        // A top-level stanza just closed.
        return this._emit(endOffset, stanzas);
      }
      return true;
    }

    if (isSelfClose) {
      // Self-closing tag does not change depth.
      if (this._depth === 1) {
        return this._emit(endOffset, stanzas);
      }
      return true;
    }

    // Opening tag.
    this._depth++;
    if (this._depth === 1) {
      // The <stream:stream> opener. Forward it immediately — it has no
      // matching close until logout, so we cannot wait for one.
      return this._emit(endOffset, stanzas);
    }
    return true;
  }

  /** Slice out a completed stanza and advance `_stanzaStart`. */
  _emit(endOffset, stanzas) {
    const len = endOffset - this._stanzaStart;
    if (len > this._max) return null;
    stanzas.push(this._buf.slice(this._stanzaStart, endOffset));
    this._stanzaStart = endOffset;
    return true;
  }
}

module.exports = { FrameParser };
