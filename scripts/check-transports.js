#!/usr/bin/env node
/**
 * Check that every transport is still wired end to end.
 *
 * ISeekU carries three: the native ICQ account over XMPP, and the WhatsApp and
 * Telegram bridges inherited from the project it was forked from. The ICQ work
 * touched main.js, preload.js and every renderer component that dispatches on
 * service, so it is entirely possible to break WhatsApp or Telegram without a
 * single test failing — the bridges themselves are untouched, but the wiring
 * around them is not.
 *
 * This walks the three seams and reports what is present, so "the other two
 * still work" is something checked rather than assumed.
 *
 *   node scripts/check-transports.js
 *
 * Exits non-zero if a transport has lost a seam.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const TRANSPORTS = [
  { id: 'icq', label: 'ICQ (XMPP)', bridge: 'electron/icq/bridge.js' },
  { id: 'wa', label: 'WhatsApp', bridge: 'electron/whatsapp-bridge.js', service: 'whatsapp' },
  { id: 'tg', label: 'Telegram', bridge: 'electron/telegram-bridge.js', service: 'telegram' },
];

const main = read('electron/main.js');
const preload = read('electron/preload.js');
const app = read('src/App.js');
const chat = read('src/ChatApp.js');
const sidebar = read('src/components/Sidebar.js');

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

let failed = false;
const rows = [];

for (const t of TRANSPORTS) {
  const service = t.service || t.id;

  const bridgeExists = fs.existsSync(path.join(root, t.bridge));
  const handlers = countOf(main, `ipcMain.handle('${t.id}:`);
  const exposed = preload.includes(`  ${t.id}: {`);
  const invokes = countOf(preload, `ipcRenderer.invoke('${t.id}:`);
  const inApp = countOf(app, `'${service}'`);
  const inChat = countOf(chat, `'${service}'`);
  const inSidebar = countOf(sidebar, `'${service}'`);

  const problems = [];
  if (!bridgeExists) problems.push('bridge file missing');
  if (handlers === 0) problems.push('no IPC handlers in main.js');
  if (!exposed) problems.push('not exposed on window.api');
  if (invokes === 0) problems.push('no invoke methods in preload');
  if (inApp === 0) problems.push('never referenced in App.js');
  if (inChat === 0) problems.push('never referenced in ChatApp.js');
  if (inSidebar === 0) problems.push('no tab in Sidebar.js');

  if (problems.length) failed = true;
  rows.push({ label: t.label, handlers, invokes, inApp, inChat, inSidebar, problems });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('transport', 14)}${pad('ipc', 6)}${pad('preload', 9)}${pad('App', 5)}${pad('Chat', 6)}${pad('Side', 6)}status`);
console.log('-'.repeat(58));
for (const r of rows) {
  const status = r.problems.length ? `BROKEN: ${r.problems.join('; ')}` : 'ok';
  console.log(
    pad(r.label, 14) + pad(r.handlers, 6) + pad(r.invokes, 9)
    + pad(r.inApp, 5) + pad(r.inChat, 6) + pad(r.inSidebar, 6) + status,
  );
}

if (failed) {
  console.error('\nAt least one transport has lost a connection. See above.');
  process.exit(1);
}
console.log('\nAll three transports are wired end to end.');
