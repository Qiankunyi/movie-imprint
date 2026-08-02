const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const sharp = require('sharp');

const root = __dirname;
const htmlUrl = pathToFileURL(path.join(root, 'mockups.html')).href;
const renderRoot = path.join(root, 'renders');
const screens = ['home', 'new', 'ticket', 'confirm', 'cards', 'preview'];
const sizes = [{ width: 412, height: 915 }, { width: 360, height: 800 }];
const themes = ['light', 'dark'];

const contrastPairs = [
  ['light primary button', '#FFFFFF', '#0B57D0', 4.5],
  ['light main text', '#1F1F1F', '#F8FAFD', 4.5],
  ['light secondary text', '#444746', '#F8FAFD', 4.5],
  ['light selected text', '#041E49', '#D3E3FD', 4.5],
  ['light success banner', '#083B18', '#C4EED0', 4.5],
  ['light warning banner', '#2B2200', '#F8E6A0', 4.5],
  ['light error banner', '#410E0B', '#F9DEDC', 4.5],
  ['dark primary button', '#062E6F', '#A8C7FA', 4.5],
  ['dark main text', '#E3E3E3', '#111318', 4.5],
  ['dark secondary text', '#C4C7C5', '#111318', 4.5],
  ['dark selected text', '#D3E3FD', '#0842A0', 4.5],
  ['dark success banner', '#B7F5C5', '#0F5223', 4.5],
  ['dark warning banner', '#FFE995', '#574500', 4.5],
  ['dark error banner', '#FFDAD6', '#8C1D18', 4.5],
];

function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const values = rgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function main() {
  const failures = [];
  const results = [];

  for (const [name, foreground, background, minimum] of contrastPairs) {
    const ratio = contrast(foreground, background);
    results.push({ check: name, ratio: Number(ratio.toFixed(2)), minimum });
    if (ratio < minimum) failures.push(`${name}: ${ratio.toFixed(2)} < ${minimum}`);
  }

  const css = fs.readFileSync(path.join(root, 'mockups.css'), 'utf8') + fs.readFileSync(path.join(root, '..', 'tokens.css'), 'utf8');
  if (/gradient\s*\(/i.test(css)) failures.push('CSS contains a gradient');
  if (/#(?:6750a4|625b71|7d5260|d0bcff|eaddff|ffd8e4)/i.test(css)) failures.push('CSS contains a Material baseline purple palette value');

  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });

  try {
    for (const size of sizes) {
      const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      for (const theme of themes) {
        for (const screen of screens) {
          await page.goto(`${htmlUrl}?screen=${screen}&theme=${theme}`, { waitUntil: 'load' });
          const layout = await page.evaluate(() => {
            const bottom = document.querySelector('.bottom-action');
            const bottomRect = bottom?.getBoundingClientRect();
            const wide = [...document.querySelectorAll('.field-box,.ticket-card,.record-row,.preview-title,.ai-panel')]
              .filter((element) => element.scrollWidth > element.clientWidth + 1)
              .map((element) => element.className);
            const targets = [...document.querySelectorAll('.primary-button,.icon-button,.back-button,.attitude-grid .chip,.location-row .chip')]
              .map((element) => {
                const rect = element.getBoundingClientRect();
                return { className: element.className, width: rect.width, height: rect.height };
              });
            return {
              viewport: [innerWidth, innerHeight],
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
              bottomVisible: !bottomRect || (bottomRect.top >= 0 && bottomRect.bottom <= innerHeight + 0.5),
              wide,
              targets,
            };
          });
          const key = `${size.width}x${size.height}/${theme}/${screen}`;
          if (layout.horizontalOverflow) failures.push(`${key}: horizontal overflow`);
          if (!layout.bottomVisible) failures.push(`${key}: bottom action not visible`);
          if (layout.wide.length) failures.push(`${key}: clipped content in ${layout.wide.join(', ')}`);
          for (const target of layout.targets) {
            if (target.width < 48 || target.height < 48) failures.push(`${key}: touch target under 48px (${target.className} ${target.width}x${target.height})`);
          }

          const imagePath = path.join(renderRoot, `${size.width}x${size.height}`, theme, `${screen}.png`);
          const metadata = await sharp(imagePath).metadata();
          if (metadata.width !== size.width || metadata.height !== size.height) failures.push(`${key}: screenshot size mismatch`);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ ok: failures.length === 0, contrast: results, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
