import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import StatusMenu, { HISTORY_KEY, HISTORY_MAX } from './StatusMenu';

beforeEach(() => localStorage.clear());

/**
 * Find a status item by its visible label.
 *
 * The accessible name includes the icon's title and the 'auto' marker, so
 * matching on role+name is ambiguous once labels share words — "Away" is
 * inside "N/A (Extended Away)".
 */
const statusItem = (label) => screen.getAllByRole('menuitemradio')
  .find((b) => b.querySelector('.icq-status-label').textContent === label);


describe('the Status list', () => {
  it('offers all eight Statuses in ICQ order', () => {
    render(<StatusMenu />);
    const labels = screen.getAllByRole('menuitemradio')
      .map((b) => b.querySelector('.icq-status-label').textContent);
    expect(labels).toEqual([
      'Available/Connect', 'Free For Chat', 'Away', 'N/A (Extended Away)',
      'Occupied (Urgent Msgs)', 'DND (Do not Disturb)', 'Privacy (Invisible)', 'Offline/Disconnect',
    ]);
  });

  it('marks the current Status', () => {
    render(<StatusMenu current="away" />);
    expect(statusItem('Away')).toHaveAttribute('aria-checked', 'true');
    expect(statusItem('Available/Connect')).toHaveAttribute('aria-checked', 'false');
  });

  it('flags exactly the Statuses that answer on the Owner behalf', () => {
    render(<StatusMenu />);
    const flagged = screen.getAllByRole('menuitemradio')
      .filter((b) => b.querySelector('.icq-status-auto'))
      .map((b) => b.querySelector('.icq-status-label').textContent);
    // Picking Occupied starting to reply for you should not be a surprise.
    expect(flagged).toEqual(['Away', 'N/A (Extended Away)', 'Occupied (Urgent Msgs)', 'DND (Do not Disturb)']);
  });

  it('reports the chosen Status and the Status Text together', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<StatusMenu onChange={onChange} statusText="Just Vibing" />);
    await user.click(statusItem('Away'));
    expect(onChange).toHaveBeenCalledWith('away', 'Just Vibing');
  });

  it('closes after a choice', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<StatusMenu onClose={onClose} onChange={() => {}} />);
    await user.click(statusItem('DND (Do not Disturb)'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Status Text', () => {
  it('is edited in the menu itself, not somewhere else', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<StatusMenu onChange={onChange} />);
    await user.type(screen.getByLabelText(/Status message/i), 'in a meeting');
    await user.click(statusItem('Occupied (Urgent Msgs)'));
    expect(onChange).toHaveBeenCalledWith('occupied', 'in a meeting');
  });

  it('applies on Enter without changing the Status', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<StatusMenu current="away" onChange={onChange} />);
    await user.type(screen.getByLabelText(/Status message/i), 'brb{Enter}');
    expect(onChange).toHaveBeenCalledWith('away', 'brb');
  });

  it('is trimmed before it is published', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<StatusMenu onChange={onChange} />);
    await user.type(screen.getByLabelText(/Status message/i), '  spaced  ');
    await user.click(statusItem('Available/Connect'));
    expect(onChange).toHaveBeenCalledWith('online', 'spaced');
  });
});

describe('remembering Status Texts', () => {
  it('offers previously used lines', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['Just Vibing', 'in a meeting']));
    render(<StatusMenu />);
    expect(screen.getByRole('button', { name: 'Just Vibing' })).toBeInTheDocument();
  });

  it('fills the field when one is picked, without changing Status', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['Just Vibing']));
    render(<StatusMenu onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Just Vibing' }));
    expect(screen.getByLabelText(/Status message/i)).toHaveValue('Just Vibing');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stores a newly used line, most recent first', async () => {
    const user = userEvent.setup();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['old']));
    render(<StatusMenu onChange={() => {}} />);
    await user.type(screen.getByLabelText(/Status message/i), 'new');
    await user.click(statusItem('Available/Connect'));
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY))).toEqual(['new', 'old']);
  });

  it('does not store the same line twice', async () => {
    const user = userEvent.setup();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['a', 'b']));
    render(<StatusMenu onChange={() => {}} statusText="b" />);
    await user.click(statusItem('Available/Connect'));
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY))).toEqual(['b', 'a']);
  });

  it('does not store an empty line', async () => {
    const user = userEvent.setup();
    render(<StatusMenu onChange={() => {}} />);
    await user.click(statusItem('Available/Connect'));
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('keeps the list from growing without limit', async () => {
    const user = userEvent.setup();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(
      Array.from({ length: HISTORY_MAX }, (_, i) => `line ${i}`),
    ));
    render(<StatusMenu onChange={() => {}} />);
    await user.type(screen.getByLabelText(/Status message/i), 'newest');
    await user.click(statusItem('Available/Connect'));
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY));
    expect(stored).toHaveLength(HISTORY_MAX);
    expect(stored[0]).toBe('newest');
  });

  it('survives a corrupt stored list rather than failing to open', () => {
    localStorage.setItem(HISTORY_KEY, 'not json at all');
    expect(() => render(<StatusMenu />)).not.toThrow();
  });

  it('ignores non-string entries someone else wrote', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(['fine', 42, null, '  ']));
    render(<StatusMenu />);
    expect(screen.getAllByRole('button', { name: 'fine' })).toHaveLength(1);
  });
});

describe('dismissing the menu', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<StatusMenu onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when something else is clicked', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<><StatusMenu onClose={onClose} /><button type="button">elsewhere</button></>);
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open while the Owner is typing in it', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<StatusMenu onClose={onClose} />);
    await user.click(screen.getByLabelText(/Status message/i));
    expect(onClose).not.toHaveBeenCalled();
  });
});
