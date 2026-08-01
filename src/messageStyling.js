/**
 * Message styling — XEP-0393.
 *
 * ICQ let you pick a font, a size and a colour per message, and sent all of it
 * over the wire. XMPP cannot do that today: the extension that could
 * (XEP-0071 XHTML-IM) was deprecated in 2018 after a run of cross-site
 * scripting problems, and clients are dropping it rather than adding it.
 *
 * What survives is XEP-0393, and its trick is that the markup IS the plain
 * text. A message reading `*hello*` renders as bold here and arrives as
 * `*hello*` — perfectly readable — on a client that has never heard of the
 * spec. Nothing is lost for anyone, which is why it won and XHTML-IM did not.
 *
 * So bold, italic, strikethrough, monospace, code blocks and quotes travel.
 * Font face and colour do not, and are local rendering only. That is a real
 * loss against 2001-era ICQ and a deliberate one.
 *
 * This module turns a body into a tree of spans. It does not produce HTML and
 * never touches innerHTML — the renderer builds React elements from the tree,
 * so a message can carry angle brackets without any escaping question arising.
 */

/** The inline styles, in the order they are tried. */
const INLINE = [
  { char: '`', type: 'code' },   // first: nothing nests inside code
  { char: '*', type: 'bold' },
  { char: '_', type: 'italic' },
  { char: '~', type: 'strike' },
];

const isSpace = (c) => c === undefined || /\s/.test(c);

/**
 * Find the span a directive opens, if it is a valid one.
 *
 * XEP-0393's rules exist to stop ordinary prose from turning into markup.
 * A snake_case_name should not go italic, and `2 * 3 * 4` should not go bold.
 * So an opening marker must be preceded by whitespace or the start of the
 * text, must not be followed by whitespace, and its closing partner must not
 * be preceded by whitespace. Markers also never span a line break.
 */
function findSpan(text, start, char) {
  if (text[start] !== char) return null;
  // Must not open mid-word.
  if (start > 0 && !isSpace(text[start - 1])) return null;
  // Must not be followed by whitespace: `* text*` is not bold.
  if (isSpace(text[start + 1])) return null;

  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === '\n') return null;      // never spans lines
    if (text[i] !== char) continue;
    if (isSpace(text[i - 1])) continue;     // closer must not follow a space
    if (i === start + 1) return null;       // `**` is not an empty bold
    return { end: i, body: text.slice(start + 1, i) };
  }
  return null;
}

/**
 * Parse the inline styles of one line into nodes.
 *
 * Code spans are opaque: their contents are returned verbatim, because the
 * whole point of monospace is that the characters inside mean nothing.
 */
function parseInline(text) {
  const nodes = [];
  let plain = '';

  const flush = () => {
    if (plain) { nodes.push({ type: 'text', text: plain }); plain = ''; }
  };

  for (let i = 0; i < text.length;) {
    const directive = INLINE.find((d) => d.char === text[i]);
    const span = directive ? findSpan(text, i, directive.char) : null;

    if (!span) { plain += text[i]; i += 1; continue; }

    flush();
    nodes.push({
      type: directive.type,
      // Nothing is parsed inside a code span.
      children: directive.type === 'code'
        ? [{ type: 'text', text: span.body }]
        : parseInline(span.body),
    });
    i = span.end + 1;
  }

  flush();
  return nodes;
}

/**
 * Parse a whole message body.
 *
 * Returns a flat list of blocks: paragraphs, quotes and preformatted blocks.
 * Blocks carry inline nodes; a preformatted block carries raw text.
 */
function parseMessage(body) {
  const text = String(body == null ? '' : body);
  const lines = text.split('\n');
  const blocks = [];

  let quote = null;
  const closeQuote = () => {
    if (quote) { blocks.push({ type: 'quote', lines: quote }); quote = null; }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // A fenced block runs until its closing fence, or to the end if it never
    // closes — an unterminated fence should not swallow the message silently,
    // but it should also not be re-parsed as markup.
    if (line.trimStart().startsWith('```')) {
      closeQuote();
      const collected = [];
      let closed = false;
      for (i += 1; i < lines.length; i += 1) {
        if (lines[i].trimStart().startsWith('```')) { closed = true; break; }
        collected.push(lines[i]);
      }
      blocks.push({ type: 'pre', text: collected.join('\n'), closed });
      continue;
    }

    // Quotes stack up until a non-quote line ends them.
    if (line.startsWith('>')) {
      const content = line.slice(1).replace(/^ /, '');
      quote = quote ? [...quote, content] : [content];
      continue;
    }

    closeQuote();
    blocks.push({ type: 'paragraph', nodes: parseInline(line) });
  }

  closeQuote();
  return blocks;
}

/** Whether a body contains anything this module would style. */
function hasStyling(body) {
  return parseMessage(body).some((b) => b.type !== 'paragraph'
    || b.nodes.some((n) => n.type !== 'text'));
}

/**
 * Wrap a selection in a directive, or unwrap it if it is already wrapped.
 *
 * Returns the new text and where the selection should sit afterwards, so the
 * caller can restore it — a formatting button that loses your cursor is worse
 * than no button.
 */
function toggleStyle(text, selectionStart, selectionEnd, char) {
  const before = text.slice(0, selectionStart);
  const selected = text.slice(selectionStart, selectionEnd);
  const after = text.slice(selectionEnd);

  // Already wrapped, just inside the selection: unwrap.
  if (selected.length >= 2 && selected.startsWith(char) && selected.endsWith(char)) {
    const inner = selected.slice(1, -1);
    return { text: before + inner + after, start: selectionStart, end: selectionStart + inner.length };
  }

  // Already wrapped, just outside the selection: unwrap those too.
  if (before.endsWith(char) && after.startsWith(char)) {
    return {
      text: before.slice(0, -1) + selected + after.slice(1),
      start: selectionStart - 1,
      end: selectionEnd - 1,
    };
  }

  // Nothing selected: insert the pair and sit between them.
  if (selectionStart === selectionEnd) {
    return { text: `${before}${char}${char}${after}`, start: selectionStart + 1, end: selectionStart + 1 };
  }

  return {
    text: `${before}${char}${selected}${char}${after}`,
    start: selectionStart + 1,
    end: selectionEnd + 1,
  };
}

export { parseMessage, parseInline, hasStyling, toggleStyle, INLINE };
