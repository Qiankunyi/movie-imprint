const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const sharp = require('sharp');

const root = __dirname;
const htmlUrl = pathToFileURL(path.join(root, 'mockups.html')).href;
const outRoot = path.join(root, 'renders');
const screens = ['home', 'new', 'ticket', 'confirm', 'cards', 'preview'];
const labels = {
  home: '01 首页',
  new: '02 新建电影',
  ticket: '03 票务确认',
  confirm: '04 AI 确认工作台',
  cards: '05 卡片类型库',
  preview: '06 最终预览',
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function renderSet(browser, width, height, theme, dirName) {
  const dir = path.join(outRoot, dirName, theme);
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
  const fill = dark ? '#E3E3E3' : '#1F1F1F';
  return Buffer.from(`<svg width="${width}" height="44" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="transparent"/>
    <text x="0" y="29" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="20" font-weight="600" fill="${fill}">${label}</text>
  </svg>`);
}

async function contactSheet(dir, theme, width, height, outputName) {
  const dark = theme === 'dark';
  const gap = 32;
  const top = 58;
  const margin = 40;
  const cols = 3;
  const rows = 2;
  const canvasWidth = margin * 2 + cols * width + (cols - 1) * gap;
  const canvasHeight = margin * 2 + rows * (top + height) + (rows - 1) * gap;
  const composites = [];

  for (let index = 0; index < screens.length; index += 1) {
    const screen = screens[index];
    const col = index % cols;
    const row = Math.floor(index / cols);
    const left = margin + col * (width + gap);
    const labelTop = margin + row * (top + height + gap);
    const imageTop = labelTop + top;
    composites.push({ input: labelSvg(width, labels[screen], dark), left, top: labelTop });
    composites.push({ input: path.join(dir, `${screen}.png`), left, top: imageTop });
  }

  await sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
      background: dark ? '#0B0D11' : '#EEF2F7',
    },
  }).composite(composites).png().toFile(path.join(outRoot, outputName));
}

async function main() {
  ensureDir(outRoot);
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  try {
    const light412 = await renderSet(browser, 412, 915, 'light', '412x915');
    const dark412 = await renderSet(browser, 412, 915, 'dark', '412x915');
    const light360 = await renderSet(browser, 360, 800, 'light', '360x800');
    const dark360 = await renderSet(browser, 360, 800, 'dark', '360x800');
    await contactSheet(light412, 'light', 412, 915, 'contact-sheet-light-412x915.png');
    await contactSheet(dark412, 'dark', 412, 915, 'contact-sheet-dark-412x915.png');
    await contactSheet(light360, 'light', 360, 800, 'contact-sheet-light-360x800.png');
    await contactSheet(dark360, 'dark', 360, 800, 'contact-sheet-dark-360x800.png');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
