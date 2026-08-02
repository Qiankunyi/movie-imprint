const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const root = __dirname;
const htmlUrl = pathToFileURL(path.join(root, 'mockups-v2.html')).href;
const screens = ['empty', 'feed', 'compose', 'ticket', 'attitude', 'detail'];
const themes = ['light', 'dark'];
const sizes = [[412, 915], [360, 800]];

function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const values = rgb(hex).map((value) => {
    const c = value / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}

async function main() {
  const failures = [];
  const pairs = [
    ['light body', '#182124', '#F7F8F6', 4.5],
    ['light soft', '#536166', '#F7F8F6', 4.5],
    ['light action', '#FFFFFF', '#0B6674', 4.5],
    ['dark body', '#EAF0F1', '#0C1214', 4.5],
    ['dark soft', '#A9B7BA', '#0C1214', 4.5],
    ['dark action', '#00363D', '#75D1DD', 4.5],
  ];
  const ratios = pairs.map(([name, fg, bg, minimum]) => {
    const ratio = contrast(fg, bg);
    if (ratio < minimum) failures.push(`${name}: ${ratio.toFixed(2)} < ${minimum}`);
    return { name, ratio: Number(ratio.toFixed(2)), minimum };
  });

  const css = fs.readFileSync(path.join(root, 'mockups-v2.css'), 'utf8') + fs.readFileSync(path.join(root, '..', 'tokens-v2.css'), 'utf8');
  if (/gradient\s*\(/i.test(css)) failures.push('CSS contains a gradient');
  if (/#(?:6750a4|625b71|7d5260|d0bcff|eaddff|ffd8e4)/i.test(css)) failures.push('CSS contains Material baseline purple');

  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  try {
    for (const [width, height] of sizes) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      for (const theme of themes) {
        for (const screen of screens) {
          await page.goto(`${htmlUrl}?screen=${screen}&theme=${theme}`, { waitUntil: 'load' });
          const result = await page.evaluate(() => {
            const interactive = [...document.querySelectorAll('button')].map((element) => {
              const rect = element.getBoundingClientRect();
              return { label: element.getAttribute('aria-label') || element.textContent.trim(), width: rect.width, height: rect.height };
            });
            return {
              overflowX: document.documentElement.scrollWidth > innerWidth + 1,
              overflowY: document.documentElement.scrollHeight > innerHeight + 1,
              interactive,
            };
          });
          const key = `${width}x${height}/${theme}/${screen}`;
          if (result.overflowX) failures.push(`${key}: horizontal overflow`);
          if (result.overflowY) failures.push(`${key}: vertical overflow`);
          result.interactive.forEach((target) => {
            if (target.width < 44 || target.height < 44) failures.push(`${key}: small target ${target.label} (${target.width}x${target.height})`);
          });
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ ok: failures.length === 0, contrast: ratios, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
