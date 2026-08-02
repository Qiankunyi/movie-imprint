const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const sharp = require('sharp');

const root = __dirname;
const htmlUrl = pathToFileURL(path.join(root, 'mockups-v2.html')).href;
const outRoot = path.join(root, 'renders');
const screens = ['empty', 'feed', 'compose', 'ticket', 'attitude', 'detail'];
const labels = {
  empty: '01 首次使用',
  feed: '02 日常记录流',
  compose: '03 随手记录',
  ticket: '04 粘贴票务',
  attitude: '05 个人态度与推荐',
  detail: '06 成品与记忆卡片',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function renderSet(browser, width, height, theme) {
  const dir = path.join(outRoot, `${width}x${height}`, theme);
  ensureDir(dir);
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });

  for (const screen of screens) {
    await page.goto(`${htmlUrl}?screen=${screen}&theme=${theme}`, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(dir, `${screen}.png`) });
  }
  await page.close();
  return dir;
}

function labelSvg(width, label, dark) {
  const fill = dark ? '#EAF0F1' : '#182124';
  return Buffer.from(`<svg width="${width}" height="46" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="transparent"/>
    <text x="0" y="30" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="19" font-weight="600" fill="${fill}">${label}</text>
  </svg>`);
}

async function contactSheet(dir, theme, width, height) {
  const gap = 30;
  const top = 54;
  const margin = 36;
  const cols = 3;
  const rows = 2;
  const canvasWidth = margin * 2 + cols * width + (cols - 1) * gap;
  const canvasHeight = margin * 2 + rows * (top + height) + (rows - 1) * gap;
  const composites = [];

  screens.forEach((screen, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const left = margin + col * (width + gap);
    const labelTop = margin + row * (top + height + gap);
    composites.push({ input: labelSvg(width, labels[screen], theme === 'dark'), left, top: labelTop });
    composites.push({ input: path.join(dir, `${screen}.png`), left, top: labelTop + top });
  });

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: theme === 'dark' ? '#080D0F' : '#E9EEED',
    },
  }).composite(composites).png().toFile(path.join(outRoot, `contact-sheet-${theme}-${width}x${height}.png`));
}

async function main() {
  ensureDir(outRoot);
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  try {
    for (const [width, height] of [[412, 915], [360, 800]]) {
      for (const theme of ['light', 'dark']) {
        const dir = await renderSet(browser, width, height, theme);
        await contactSheet(dir, theme, width, height);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
