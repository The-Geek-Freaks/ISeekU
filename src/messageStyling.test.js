/**
 * XEP-0393's rules are mostly about what must NOT become markup. Ordinary
 * prose is full of asterisks and underscores, and a styling parser that turns
 * snake_case into italics is worse than no styling at all — so most of these
 * tests are about text staying plain.
 */

import { parseMessage, parseInline, hasStyling, toggleStyle } from './messageStyling';

/** Flatten a parse back to a readable shape for assertions. */
const shape = (nodes) => nodes.map((n) => (n.type === 'text' ? n.text : { [n.type]: shape(n.children) }));

const inline = (text) => shape(parseInline(text));

describe('the four inline styles', () => {
  it('reads bold, italic, strikethrough and monospace', () => {
    expect(inline('*b*')).toEqual([{ bold: ['b'] }]);
    expect(inline('_i_')).toEqual([{ italic: ['i'] }]);
    expect(inline('~s~')).toEqual([{ strike: ['s'] }]);
    expect(inline('`m`')).toEqual([{ code: ['m'] }]);
  });

  it('keeps the text around them', () => {
    expect(inline('say *this* now')).toEqual(['say ', { bold: ['this'] }, ' now']);
  });

  it('nests', () => {
    expect(inline('*_both_*')).toEqual([{ bold: [{ italic: ['both'] }] }]);
  });

  it('parses nothing inside monospace, which is the point of monospace', () => {
    expect(inline('`*not bold*`')).toEqual([{ code: ['*not bold*'] }]);
  });
});

describe('what must stay plain text', () => {
  it('leaves snake_case alone', () => {
    // The single most important case: a marker cannot open mid-word.
    expect(inline('some_variable_name')).toEqual(['some_variable_name']);
  });

  it('leaves arithmetic alone', () => {
    expect(inline('2 * 3 * 4')).toEqual(['2 * 3 * 4']);
  });

  it('does not open on a marker followed by a space', () => {
    expect(inline('* not a list')).toEqual(['* not a list']);
  });

  it('does not close on a marker preceded by a space', () => {
    expect(inline('*open and never *closed')).toEqual(['*open and never *closed']);
  });

  it('leaves an unmatched marker alone', () => {
    expect(inline('half *open')).toEqual(['half *open']);
  });

  it('does not treat a doubled marker as empty styling', () => {
    expect(inline('**')).toEqual(['**']);
  });

  it('leaves a file path alone', () => {
    expect(inline('C:\\temp\\a_b\\c')).toEqual(['C:\\temp\\a_b\\c']);
  });

  it('leaves a bare URL alone', () => {
    // Underscores in URLs are common and must survive.
    expect(inline('https://x.example/a_b_c')).toEqual(['https://x.example/a_b_c']);
  });
});

describe('blocks', () => {
  it('treats each line as its own paragraph', () => {
    const blocks = parseMessage('one\ntwo');
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('never lets a style span a line break', () => {
    // Otherwise one stray asterisk turns the rest of a message bold.
    const blocks = parseMessage('*start\nend*');
    expect(shape(blocks[0].nodes)).toEqual(['*start']);
    expect(shape(blocks[1].nodes)).toEqual(['end*']);
  });

  it('collects consecutive quote lines into one quote', () => {
    const blocks = parseMessage('> first\n> second\nafter');
    expect(blocks[0]).toEqual({ type: 'quote', lines: ['first', 'second'] });
    expect(blocks[1].type).toBe('paragraph');
  });

  it('reads a fenced block verbatim', () => {
    const blocks = parseMessage('```\n*not bold*\n```');
    expect(blocks[0]).toMatchObject({ type: 'pre', text: '*not bold*', closed: true });
  });

  it('marks an unclosed fence rather than swallowing the message silently', () => {
    const blocks = parseMessage('```\nstill going');
    expect(blocks[0]).toMatchObject({ type: 'pre', text: 'still going', closed: false });
  });

  it('copes with an empty body', () => {
    expect(parseMessage('')).toEqual([{ type: 'paragraph', nodes: [] }]);
    expect(parseMessage(null)).toEqual([{ type: 'paragraph', nodes: [] }]);
  });
});

describe('detecting styling', () => {
  it('says no for ordinary text', () => {
    expect(hasStyling('just a message')).toBe(false);
    expect(hasStyling('some_variable_name')).toBe(false);
  });

  it('says yes for anything styled', () => {
    expect(hasStyling('*bold*')).toBe(true);
    expect(hasStyling('> quoted')).toBe(true);
    expect(hasStyling('```\ncode\n```')).toBe(true);
  });
});

describe('the formatting buttons', () => {
  it('wraps a selection and keeps it selected', () => {
    const r = toggleStyle('hello world', 6, 11, '*');
    expect(r.text).toBe('hello *world*');
    expect(r.text.slice(r.start, r.end)).toBe('world');
  });

  it('unwraps when the markers are inside the selection', () => {
    const r = toggleStyle('hello *world*', 6, 13, '*');
    expect(r.text).toBe('hello world');
    expect(r.text.slice(r.start, r.end)).toBe('world');
  });

  it('unwraps when the markers are just outside the selection', () => {
    const r = toggleStyle('hello *world*', 7, 12, '*');
    expect(r.text).toBe('hello world');
    expect(r.text.slice(r.start, r.end)).toBe('world');
  });

  it('inserts an empty pair and sits between them when nothing is selected', () => {
    // A button that leaves the cursor outside the markers means the next
    // thing typed lands in the wrong place.
    const r = toggleStyle('hello ', 6, 6, '*');
    expect(r.text).toBe('hello **');
    expect(r.start).toBe(7);
    expect(r.end).toBe(7);
  });

  it('round-trips: wrapping then unwrapping restores the original', () => {
    const once = toggleStyle('hello world', 6, 11, '_');
    const twice = toggleStyle(once.text, once.start, once.end, '_');
    expect(twice.text).toBe('hello world');
  });

  it('produces text the parser then reads back as styled', () => {
    const r = toggleStyle('hello world', 6, 11, '*');
    expect(shape(parseMessage(r.text)[0].nodes)).toEqual(['hello ', { bold: ['world'] }]);
  });
});
