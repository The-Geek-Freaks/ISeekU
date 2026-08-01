/**
 * Tests for the FormatToolbar component and its integration with a composer.
 *
 * These are integration-level tests. A standalone toolbar button that fired
 * onFormat without verifying what happened to the text would not catch the
 * selection-restoration bug — the one where setting value via setState resets
 * selectionStart to zero and the next keystroke lands in the wrong place.
 * So each test uses ComposerWithToolbar, a minimal wrapper that wires the
 * toolbar and a textarea together exactly as ChatWindow does.
 */

import React, { useState, useRef, useEffect } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import FormatToolbar from './FormatToolbar';
import { toggleStyle } from '../../messageStyling';

/**
 * Minimal host that wires FormatToolbar and a textarea together.
 *
 * The toolbar calls onFormat(marker), which reads the current selection from
 * the textarea ref, applies toggleStyle, updates state and queues a selection
 * restore via a ref-guarded effect. This is the same mechanism ChatWindow uses,
 * so the tests catch real bugs rather than testing a simplified stand-in.
 *
 * Keyboard shortcuts (Ctrl+B, Ctrl+I) are also wired here so the shortcut
 * tests can fire keydown on the textarea and observe the same result.
 */
function ComposerWithToolbar({ initialText = '' }) {
  const [text, setText] = useState(initialText);
  const inputRef = useRef(null);
  const pendingSelectionRef = useRef(null);

  useEffect(() => {
    if (!pendingSelectionRef.current) return;
    const { start, end } = pendingSelectionRef.current;
    pendingSelectionRef.current = null;
    if (inputRef.current) {
      inputRef.current.setSelectionRange(start, end);
    }
  }, [text]);

  const applyFormat = (marker) => {
    const el = inputRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    const result = toggleStyle(text, selectionStart, selectionEnd, marker);
    pendingSelectionRef.current = { start: result.start, end: result.end };
    setText(result.text);
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      applyFormat('*');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      applyFormat('_');
    }
  };

  return (
    <>
      <FormatToolbar onFormat={applyFormat} />
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        data-testid="composer"
      />
    </>
  );
}

describe('FormatToolbar — bold button', () => {
  it('wraps a selection in bold markers on first press', () => {
    render(<ComposerWithToolbar initialText="hello world" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 5);

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Bold (Ctrl+B)'));
      fireEvent.click(screen.getByTitle('Bold (Ctrl+B)'));
    });

    expect(textarea.value).toBe('*hello* world');
  });

  it('unwraps bold markers when the selection already wraps them', () => {
    render(<ComposerWithToolbar initialText="*hello* world" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 7); // select "*hello*"

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Bold (Ctrl+B)'));
      fireEvent.click(screen.getByTitle('Bold (Ctrl+B)'));
    });

    expect(textarea.value).toBe('hello world');
  });

  it('unwraps bold markers when the selection is the inner content, not the markers', () => {
    // The user double-clicked on the word "hello" inside "*hello* world", so
    // the selection is positions 1–6 — the bare word, not the asterisks.
    // toggleStyle's second branch detects that before ends with "*" and after
    // starts with "*" and strips both. Without this path the second press would
    // wrap again instead of unwrap.
    render(<ComposerWithToolbar initialText="*hello* world" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(1, 6); // select "hello", markers outside selection

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Bold (Ctrl+B)'));
      fireEvent.click(screen.getByTitle('Bold (Ctrl+B)'));
    });

    expect(textarea.value).toBe('hello world');
  });

  it('places the caret between bold markers when nothing is selected', () => {
    render(<ComposerWithToolbar initialText="" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Bold (Ctrl+B)'));
      fireEvent.click(screen.getByTitle('Bold (Ctrl+B)'));
    });

    expect(textarea.value).toBe('**');
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(1);
  });
});

describe('FormatToolbar — italic button', () => {
  it('wraps a selection in italic markers', () => {
    render(<ComposerWithToolbar initialText="hello world" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(6, 11); // select "world"

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Italic (Ctrl+I)'));
      fireEvent.click(screen.getByTitle('Italic (Ctrl+I)'));
    });

    expect(textarea.value).toBe('hello _world_');
  });

  it('unwraps italic markers on second press', () => {
    render(<ComposerWithToolbar initialText="_world_" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 7);

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Italic (Ctrl+I)'));
      fireEvent.click(screen.getByTitle('Italic (Ctrl+I)'));
    });

    expect(textarea.value).toBe('world');
  });

  it('places the caret between italic markers when nothing is selected', () => {
    render(<ComposerWithToolbar initialText="" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Italic (Ctrl+I)'));
      fireEvent.click(screen.getByTitle('Italic (Ctrl+I)'));
    });

    expect(textarea.value).toBe('__');
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(1);
  });
});

describe('FormatToolbar — strikethrough button', () => {
  it('wraps a selection in strikethrough markers', () => {
    render(<ComposerWithToolbar initialText="hello" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 5);

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Strikethrough'));
      fireEvent.click(screen.getByTitle('Strikethrough'));
    });

    expect(textarea.value).toBe('~hello~');
  });

  it('unwraps strikethrough markers on second press', () => {
    render(<ComposerWithToolbar initialText="~hello~" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 7);

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Strikethrough'));
      fireEvent.click(screen.getByTitle('Strikethrough'));
    });

    expect(textarea.value).toBe('hello');
  });
});

describe('FormatToolbar — monospace button', () => {
  it('wraps a selection in monospace markers', () => {
    render(<ComposerWithToolbar initialText="code" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 4);

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Monospace'));
      fireEvent.click(screen.getByTitle('Monospace'));
    });

    expect(textarea.value).toBe('`code`');
  });

  it('unwraps monospace markers on second press', () => {
    render(<ComposerWithToolbar initialText="`code`" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 6);

    act(() => {
      fireEvent.mouseDown(screen.getByTitle('Monospace'));
      fireEvent.click(screen.getByTitle('Monospace'));
    });

    expect(textarea.value).toBe('code');
  });
});

describe('FormatToolbar — keyboard shortcuts', () => {
  it('Ctrl+B wraps the selection in bold markers', () => {
    render(<ComposerWithToolbar initialText="hello world" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 5);

    act(() => {
      fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });
    });

    expect(textarea.value).toBe('*hello* world');
  });

  it('Ctrl+I wraps the selection in italic markers', () => {
    render(<ComposerWithToolbar initialText="hello world" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(6, 11);

    act(() => {
      fireEvent.keyDown(textarea, { key: 'i', ctrlKey: true });
    });

    expect(textarea.value).toBe('hello _world_');
  });

  it('Ctrl+B with no selection inserts a bold pair and sits inside it', () => {
    render(<ComposerWithToolbar initialText="" />);
    const textarea = screen.getByTestId('composer');
    textarea.focus();
    textarea.setSelectionRange(0, 0);

    act(() => {
      fireEvent.keyDown(textarea, { key: 'b', ctrlKey: true });
    });

    expect(textarea.value).toBe('**');
    expect(textarea.selectionStart).toBe(1);
  });
});

describe('FormatToolbar — button accessibility', () => {
  it('all four buttons are present and have title attributes', () => {
    render(<ComposerWithToolbar />);
    expect(screen.getByTitle('Bold (Ctrl+B)')).toBeInTheDocument();
    expect(screen.getByTitle('Italic (Ctrl+I)')).toBeInTheDocument();
    expect(screen.getByTitle('Strikethrough')).toBeInTheDocument();
    expect(screen.getByTitle('Monospace')).toBeInTheDocument();
  });

  it('all four buttons are reachable by keyboard (type="button", not submit)', () => {
    render(<ComposerWithToolbar />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute('type', 'button');
    });
  });
});
