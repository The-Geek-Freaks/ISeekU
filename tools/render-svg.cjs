/**
 * Renders an SVG to a PNG so it can be looked at.
 *
 * The README's artwork ships as SVG — it scales, it stays sharp on a retina
 * display, and it diffs as text. But an SVG that has never been rendered is a
 * guess: a font that falls back, a glyph that overflows its box, a colour that
 * disappears against the ground. This turns one into a picture so the result
 * can be checked rather than assumed.
 *
 * Uses the Chromium that Playwright already installs for the end-to-end tests,
 * so it costs no new dependency.
 *
 *   node tools/render-svg.cjs docs/hero.svg /tmp/hero.png 1200 340
 */

'use strict';

const path = require('path');
const { chromium } = require('@playwright/test');

async function main() {
  const [input, output, width, height] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node tools/render-svg.cjs <input.svg> <output.png> [width] [height]');
    process.exit(2);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: Number(width) || 1200, height: Number(height) || 340 },
      // Renders at 2x so the result shows what a retina display would, which
      // is where hairlines and small type actually fail.
      deviceScaleFactor: 2,
    });
    const url = 'file:///' + path.resolve(input).split(path.sep).join('/');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: output });
    console.log('rendered ' + output);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
