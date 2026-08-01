import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StyledBody from './StyledBody';

describe('rendering styled text', () => {
  it('renders bold, italic, strikethrough and monospace as real elements', () => {
    const { container } = render(<StyledBody body="*b* _i_ ~s~ `m`" />);
    expect(container.querySelector('strong')).toHaveTextContent('b');
    expect(container.querySelector('em')).toHaveTextContent('i');
    expect(container.querySelector('s')).toHaveTextContent('s');
    expect(container.querySelector('code')).toHaveTextContent('m');
  });

  it('renders quotes and code blocks', () => {
    const { container } = render(<StyledBody body={'> quoted\n```\ncode here\n```'} />);
    expect(container.querySelector('blockquote')).toHaveTextContent('quoted');
    expect(container.querySelector('pre')).toHaveTextContent('code here');
  });

  it('leaves ordinary prose alone', () => {
    const { container } = render(<StyledBody body="some_variable_name and 2 * 3" />);
    expect(container.querySelector('em')).toBeNull();
    expect(container.querySelector('strong')).toBeNull();
    expect(container).toHaveTextContent('some_variable_name and 2 * 3');
  });
});

describe('text that could be markup', () => {
  it('shows a script tag as text rather than running it', () => {
    // The parse tree becomes React elements, never innerHTML — so there is no
    // escaping step that could be forgotten.
    const { container } = render(<StyledBody body={'<script>alert(1)</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(1)</script>');
  });

  it('shows an img tag as text', () => {
    const { container } = render(<StyledBody body={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('does not let markup inside a code span become elements', () => {
    const { container } = render(<StyledBody body={'`<b>x</b>`'} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('code')).toHaveTextContent('<b>x</b>');
  });
});

describe('links', () => {
  it('turns a URL into a link', () => {
    render(<StyledBody body="see https://example.org/x" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.org/x');
  });

  it('links inside styled text, not instead of it', () => {
    const { container } = render(<StyledBody body="*see https://example.org*" />);
    expect(container.querySelector('strong a')).toBeInTheDocument();
  });

  it('leaves trailing punctuation out of the link', () => {
    render(<StyledBody body="go to https://example.org/page." />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.org/page');
  });

  it('does not linkify inside a code span', () => {
    const { container } = render(<StyledBody body="`https://example.org`" />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('opens externally rather than navigating the app window', () => {
    // Navigating the application window to a contact's link would replace the
    // client with a web page and there is no way back.
    const openExternal = jest.fn();
    window.api = { openExternal };
    render(<StyledBody body="https://example.org" />);
    screen.getByRole('link').click();
    expect(openExternal).toHaveBeenCalledWith('https://example.org');
    delete window.api;
  });

  it('does not throw when there is no bridge to open with', () => {
    render(<StyledBody body="https://example.org" />);
    expect(() => screen.getByRole('link').click()).not.toThrow();
  });
});

describe('edge cases', () => {
  it('renders an empty body without throwing', () => {
    expect(() => render(<StyledBody body="" />)).not.toThrow();
    expect(() => render(<StyledBody body={null} />)).not.toThrow();
  });

  it('keeps a blank line between paragraphs', () => {
    const { container } = render(<StyledBody body={'one\n\ntwo'} />);
    expect(container.querySelector('br')).toBeInTheDocument();
  });
});
