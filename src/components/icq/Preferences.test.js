import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import Preferences from './Preferences';

const SKINS = [
  { id: 'icq99', name: 'ICQ Classic (2001)', swatch: '#00FF00' },
  { id: 'msn-blue', name: 'MSN Messenger', swatch: '#2E86DE' },
];

beforeEach(() => localStorage.clear());

const open = (props = {}) => render(
  <Preferences skins={SKINS} currentSkin="icq99" onClose={() => {}} {...props} />,
);

describe('the pages', () => {
  it('offers only pages whose controls actually do something', () => {
    open();
    // No SMS, no ICQ Phone, no Web Aware. A dialog full of dead controls
    // would look more complete and be a promise the client cannot keep.
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'General', 'Contact List', 'Events', 'Status', 'Connection', 'About',
    ]);
  });

  it('opens on General', () => {
    open();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches pages', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('tab', { name: 'Status' }));
    expect(screen.getByLabelText(/Away message/i)).toBeInTheDocument();
  });
});

describe('General', () => {
  it('changes the skin through the owner, not by itself', async () => {
    const user = userEvent.setup();
    const onChooseSkin = jest.fn();
    open({ onChooseSkin });
    await user.selectOptions(screen.getByRole('combobox'), 'msn-blue');
    expect(onChooseSkin).toHaveBeenCalledWith('msn-blue');
  });

  it('reflects the sound setting it was given', () => {
    open({ soundEnabled: false });
    expect(screen.getByLabelText(/Play sounds/i)).not.toBeChecked();
  });

  it('persists the startup sound setting', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByLabelText(/startup sound/i));
    expect(localStorage.getItem('icq-startup-sound')).toBe('off');
  });
});

describe('Status', () => {
  it('reports the Away message when the field is left', async () => {
    const user = userEvent.setup();
    const onAwayMessage = jest.fn();
    open({ onAwayMessage });
    await user.click(screen.getByRole('tab', { name: 'Status' }));
    await user.type(screen.getByLabelText(/Away message/i), '  bin gleich zurueck  ');
    await user.tab();
    expect(onAwayMessage).toHaveBeenCalledWith('bin gleich zurueck');
  });

  it('says plainly that an empty Away message sends nothing', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('tab', { name: 'Status' }));
    expect(screen.getByText(/Left empty, nothing is sent/i)).toBeInTheDocument();
  });

  it('persists the idle thresholds', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('tab', { name: 'Status' }));
    const away = screen.getByLabelText(/Away after/i);
    await user.clear(away);
    await user.type(away, '5');
    await user.tab();
    expect(localStorage.getItem('icq-idle-away-min')).toBe('5');
  });

  it('clamps an absurd idle threshold instead of storing it', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('tab', { name: 'Status' }));
    const away = screen.getByLabelText(/Away after/i);
    await user.clear(away);
    await user.type(away, '9999');
    await user.tab();
    expect(Number(localStorage.getItem('icq-idle-away-min'))).toBeLessThanOrEqual(120);
  });

  it('disables the thresholds when automatic status is off', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('tab', { name: 'Status' }));
    await user.click(screen.getByLabelText(/automatically when I am idle/i));
    expect(screen.getByLabelText(/Away after/i)).toBeDisabled();
  });
});

describe('Connection', () => {
  it('shows the unencrypted state as a warning, not as a value', async () => {
    const user = userEvent.setup();
    open({ connection: { secure: false, account: { server: '132.145.202.182', uin: '265019842' } } });
    await user.click(screen.getByRole('tab', { name: 'Connection' }));
    expect(screen.getByText(/readable form/i)).toBeInTheDocument();
  });

  it('says Encrypted when the connection is', async () => {
    const user = userEvent.setup();
    open({ connection: { secure: true, account: { server: 'example.org', uin: '1' } } });
    await user.click(screen.getByRole('tab', { name: 'Connection' }));
    expect(screen.getByText('Encrypted')).toBeInTheDocument();
  });

  it('copes with not being connected', async () => {
    const user = userEvent.setup();
    open({ connection: null });
    await user.click(screen.getByRole('tab', { name: 'Connection' }));
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
  });
});

describe('dismissing', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    open({ onClose });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on the Close button', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    open({ onClose });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('commits a pending Away message on close rather than losing it', async () => {
    const user = userEvent.setup();
    const onAwayMessage = jest.fn();
    open({ onAwayMessage, onClose: () => {} });
    await user.click(screen.getByRole('tab', { name: 'Status' }));
    await user.type(screen.getByLabelText(/Away message/i), 'brb');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onAwayMessage).toHaveBeenCalledWith('brb');
  });
});
