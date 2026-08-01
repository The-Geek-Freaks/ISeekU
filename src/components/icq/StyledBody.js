import React from 'react';
import { parseMessage } from '../../messageStyling';

/**
 * Renders a message body with its XEP-0393 styling applied.
 *
 * Builds React elements from the parse tree rather than producing an HTML
 * string. Nothing here goes near innerHTML, so a message containing angle
 * brackets, quotes or a script tag is simply text — there is no escaping step
 * to forget, because there is no unescaped path in the first place.
 *
 * URLs are linkified inside the styled text, so `*see https://x.example*`
 * gives a bold clickable link rather than one or the other.
 */

// Deliberately conservative: a trailing bracket or full stop is almost always
// punctuation around the link rather than part of it.
const URL_PATTERN = /(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}])/g;

function linkify(text, keyPrefix) {
  const out = [];
  let last = 0;
  let match;
  URL_PATTERN.lastIndex = 0;

  while ((match = URL_PATTERN.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const href = match[0];
    out.push(
      <a
        key={`${keyPrefix}-a${match.index}`}
        href={href}
        onClick={(e) => {
          // Never navigate the application window away from itself.
          e.preventDefault();
          window.api?.openExternal?.(href);
        }}
      >
        {href}
      </a>,
    );
    last = match.index + href.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const WRAPPER = { bold: 'strong', italic: 'em', strike: 's', code: 'code' };

function renderNodes(nodes, keyPrefix) {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === 'text') return <React.Fragment key={key}>{linkify(node.text, key)}</React.Fragment>;
    // Code is verbatim: no linkifying, no nesting.
    if (node.type === 'code') return <code key={key}>{node.children[0]?.text ?? ''}</code>;
    const Tag = WRAPPER[node.type];
    return Tag ? <Tag key={key}>{renderNodes(node.children, key)}</Tag> : null;
  });
}

export default function StyledBody({ body }) {
  const blocks = parseMessage(body);

  return (
    <>
      {blocks.map((block, i) => {
        const key = `b${i}`;
        if (block.type === 'pre') {
          return (
            <pre key={key} className="icq-msg-pre">
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={key} className="icq-msg-quote">
              {block.lines.map((line, j) => (
                <div key={`${key}-${j}`}>{renderNodes(parseMessage(line)[0].nodes, `${key}-${j}`)}</div>
              ))}
            </blockquote>
          );
        }
        // A blank line between paragraphs is a line break, not an empty block.
        if (block.nodes.length === 0) return <br key={key} />;
        return (
          <div key={key} className="icq-msg-line">
            {renderNodes(block.nodes, key)}
          </div>
        );
      })}
    </>
  );
}

export { linkify };
