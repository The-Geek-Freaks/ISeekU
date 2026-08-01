#!/usr/bin/env node
/**
 * Launch the app with the demo fixture loaded: a populated Contact List and a
 * conversation, no server, no sign-in.
 *
 * For working on the interface, and for looking at a change without having an
 * account. The same fixture is what the README screenshots are taken from, so
 * what you see here is what ends up in the pictures.
 *
 *   npm run build && npm run demo
 *
 * Exists as a script rather than an inline npm command because setting an
 * environment variable portably in package.json needs either a dependency or
 * an unreadable one-liner, and this is neither.
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron');

const child = spawn(electron, [path.join(__dirname, '..')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ICQ_DEMO: '1',
    // The WhatsApp and Telegram bridges need a browser and a session; the demo
    // is about the ICQ account, so they stay out of the way.
    ICQ_E2E: '1',
  },
});

child.on('close', (code) => process.exit(code === null ? 1 : code));
