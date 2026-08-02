const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const sharp = require('sharp');

const root = __dirname;
const out = path.join(root, 'renders');
const html = pathToFileURL(path.join(root, 'revision-01.html')).href;
const screens = ['home-empty', 'home-feed', 'composer-empty', 'composer-writing'];
const labels = ['A 首次打开', 'B 已有记录', 'C 开始输入', 'D 正在长写'];

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    for (const screen of screens) {
      await page.goto(`${html}?screen=${screen}`, { waitUntil: 'load' });
      await page.screenshot({ path: path.join(out, `${screen}.png`) });
    }
    await page.close();
  } finally {
    await browser.close();
  }

  const margin = 36;
  const gap = 30;
  const labelHeight = 52;
  const width = 412;
  const height = 915;
  const sheetWidth = margin * 2 + width * 2 + gap;
  const sheetHeight = margin * 2 + (labelHeight + height) * 2 + gap;
  const composites = [];
  for (let index = 0; index < screens.length; index += 1) {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const left = margin + col * (width + gap);
    const top = margin + row * (labelHeight + height + gap);
    const label = Buffer.from(`<svg width="${width}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><text x="0" y="32" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="21" font-weight="600" fill="#24231f">${labels[index]}</text></svg>`);
    composites.push({ input: label, left, top });
    composites.push({ input: path.join(out, `${screens[index]}.png`), left, top: top + labelHeight });
  }
  await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 4, background: '#e6e0d5' } }).composite(composites).png().toFile(path.join(out, 'revision-01-contact-sheet.png'));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
