import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const port = 4174;
const baseUrl = `http://127.0.0.1:${port}`;
const testOnly = process.argv.includes("--test-only");
const mockWallpaper = await readFile(join(root, "docs", "design", "mockups", "assets", "cinema-memory-hero-v1.png"));

async function loadPlaywright() {
  if (process.env.PLAYWRIGHT_MODULE) {
    return import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  }
  try {
    return await import("playwright");
  } catch {
    throw new Error("视觉检查需要 Playwright。请先执行 pnpm add -D playwright && pnpm exec playwright install chromium。");
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("本地预览服务未能启动");
}

async function ensureVisible(locator, viewport, label) {
  const box = await locator.boundingBox();
  if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) {
    throw new Error(`${label} 未完整显示在 ${viewport.width}×${viewport.height} 视口内：${JSON.stringify(box)}`);
  }
}

async function mockBangumi(page) {
  await page.route("**/api/ai/providers", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        active: "gemini",
        providers: [
          { id: "gemini", label: "Gemini", configured: true, model: "gemini-test" },
          { id: "openai", label: "ChatGPT / OpenAI", configured: false, model: "gpt-test" },
          { id: "anthropic", label: "Claude", configured: false, model: "claude-test" },
          { id: "deepseek", label: "DeepSeek", configured: false, model: "deepseek-test" },
          { id: "kimi", label: "Kimi", configured: false, model: "kimi-test" }
        ]
      })
    });
  });
  await page.route("**/api/ai/analyze", async (route) => {
    const body = route.request().postDataJSON();
    const excerpt = String(body.rawText || "").split("\n").findLast((line) => line.trim() && !line.trim().startsWith("#"))?.trim() || "原文";
    const evidence = [{ excerpt, basis: "explicit", voice: "user", claim_mode: "direct_feeling", explanation: "测试原文依据", confidence: 0.9 }];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        analysis: {
          schema_version: "0.2",
          attitude: { suggested: "like", alternative: null, evidence, confidence: 0.9 },
          emotions: [{ label: "被触动", evidence, confidence: 0.9 }],
          memory_cards: [{ card_id: `card_test_${Date.now()}`, type: "被击中的瞬间", title: "最先留下来的片段", content: excerpt, why_it_matters: null, is_core: true, order: 0, evidence, confidence: 0.9, provenance: "ai_suggested" }],
          warnings: []
        },
        metadata: { provider: body.provider || "gemini", model: "gemini-test", prompt_version: "test", schema_version: "0.2", input_hash: "test", usage: {} }
      })
    });
  });
  await page.route("**/api/ai/recommendation", async (route) => {
    const body = route.request().postDataJSON();
    const excerpt = String(body.rawText || "").split("\n").findLast((line) => line.trim() && !line.trim().startsWith("#"))?.trim() || "原文";
    const evidence = [{ excerpt, basis: "explicit", voice: "user", claim_mode: "direct_feeling", explanation: "测试原文依据", confidence: 0.84 }];
    const field = body.recommendation === "no" ? "noReasons" : "audiences";
    const value = body.recommendation === "no" ? "更适合保留为个人记录" : "喜欢安静画面的人";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        recommendation: { suggestions: [{ suggestion_id: "recommendation_test", field, value, evidence, confidence: 0.84, status: "pending", provenance: "ai_suggested" }], warnings: [] },
        metadata: { provider: body.provider || "gemini", model: "gemini-test", prompt_version: "test", schema_version: "0.2-recommendation", input_hash: "test", usage: {} }
      })
    });
  });
  await page.route("**/api/bangumi/image?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: mockWallpaper });
  });
  await page.route("**/api/bangumi/search?**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    const candidates = query.includes("云之王国")
      ? [{
          subjectId: 451,
          title: "哆啦A梦：大雄与云之王国",
          originalTitle: "ドラえもん のび太と雲の王国",
          type: "anime",
          releaseDate: "1992-03-07",
          image: null,
          url: "https://bangumi.tv/subject/451"
        }]
      : [
          {
            subjectId: 900001,
            title: "夏日列车",
            originalTitle: "夏の列車",
            type: "anime",
            releaseDate: "2024-08-01",
            image: null,
            url: "https://bangumi.tv/subject/900001"
          },
          {
            subjectId: 900002,
            title: "夏日列车 特别篇",
            originalTitle: null,
            type: "anime",
            releaseDate: "2025-08-01",
            image: null,
            url: "https://bangumi.tv/subject/900002"
          }
        ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query,
        source: "test",
        candidates
      })
    });
  });
}

async function runFunctionalPath(browser) {
  const viewport = { width: 360, height: 800 };
  const context = await browser.newContext({ viewport, colorScheme: "light", serviceWorkers: "block" });
  const page = await context.newPage();
  await mockBangumi(page);
  await page.goto(`${baseUrl}/?clean=1`);
  await page.getByTestId("add-record").click();
  const input = page.getByTestId("composer-input");
  await input.fill("#列表测试\n");
  await page.getByRole("button", { name: "列表格式", exact: true }).click();
  await page.getByRole("button", { name: "1. 有序", exact: true }).click();
  await input.type("第一点");
  await input.press("Enter");
  await input.type("第二点");
  await input.press("Enter");
  await input.press("Enter");
  await page.getByRole("button", { name: "列表格式", exact: true }).click();
  await page.getByRole("button", { name: "- 无序", exact: true }).click();
  await input.type("补充一点");
  const listText = await input.inputValue();
  if (!listText.includes("1. 第一点\n2. 第二点\n- 补充一点")) throw new Error("列表快捷输入或自动续号失败");
  await input.fill("#哆啦A梦/大雄与动物行星 看完以后想到了小时候。");
  const seriesHint = page.getByTestId("series-hint");
  if (!(await seriesHint.isVisible())) throw new Error("斜线系列速记没有显示识别提示");
  if (!((await seriesHint.textContent()) || "").includes("哆啦A梦") || !((await seriesHint.textContent()) || "").includes("大雄与动物行星")) {
    throw new Error("系列与作品提示内容不完整");
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("系列提示造成了横向溢出");
  await input.fill("#夏日列车 #电影院\n最后一幕还是很击中我。雨停以后，车窗外的光也变得很安静。");
  await page.waitForFunction(() => document.querySelector("[data-testid='save-status']")?.textContent === "已存于本机");
  await page.waitForTimeout(250);
  await ensureVisible(page.getByTestId("finish-record"), viewport, "记录完成按钮");
  if (!(await input.evaluate((element) => element === document.activeElement))) throw new Error("真实文本输入没有获得焦点");

  await page.reload();
  await page.getByRole("button", { name: /未完成的记录/ }).click();
  await page.getByTestId("composer-input").waitFor();
  const restored = await page.getByTestId("composer-input").inputValue();
  if (!restored.includes("#夏日列车")) throw new Error("IndexedDB 草稿刷新恢复失败");
  await page.getByTestId("finish-record").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-status']")?.textContent?.includes("待确认作品"));
  await page.getByRole("heading", { name: "夏日列车" }).click();
  await page.getByTestId("work-match-panel").waitFor();
  await page.locator("[data-action='confirm-work-match'][data-subject-id='900001']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("作品已确认"));
  if (!(await page.getByTestId("work-match-panel").innerText()).includes("作品已确认")) throw new Error("Bangumi 候选确认状态没有显示");
  await page.getByRole("button", { name: "修改匹配", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("请选择正确条目"));
  await page.getByRole("button", { name: "保留当前匹配", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("作品已确认"));
  if (!(await page.getByTestId("work-match-panel").innerText()).includes("作品已确认")) throw new Error("取消重新匹配后没有保留当前作品");
  const linkedWork = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("movie-imprint-local", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const request = database.transaction("records", "readonly").objectStore("records").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const record = records.find((item) => item.title === "夏日列车");
    if (!record?.workId) return null;
    return new Promise((resolve, reject) => {
      const request = database.transaction("works", "readonly").objectStore("works").get(record.workId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
  if (!linkedWork || linkedWork.identity_status !== "matched" || linkedWork.external_refs?.[0]?.id !== "900001") {
    throw new Error("记录没有保存已确认的 Bangumi 作品身份");
  }
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("movie-imprint-local", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("works", "readwrite");
      transaction.objectStore("works").put({
        id: "work_second_wallpaper",
        work_id: "work_second_wallpaper",
        title: "第二张壁纸",
        original_title: null,
        work_type: "animation_movie",
        aliases: [],
        release_year: 2025,
        external_refs: [{ source: "bangumi", id: "900002", url: "https://bgm.tv/subject/900002" }],
        identity_status: "matched",
        match: { status: "confirmed", candidates: [] }
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  });
  await page.getByRole("button", { name: "返回记录流" }).click();
  await page.reload();
  await page.getByTestId("daily-wallpaper").waitFor();
  if (!(await page.getByTestId("wallpaper-credit").innerText()).includes("今日壁纸")) throw new Error("按日壁纸来源没有显示");
  const firstWallpaperSrc = await page.getByTestId("daily-wallpaper").getAttribute("src");
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  await page.locator("[data-action='change-wallpaper']").click();
  await page.waitForFunction((previous) => document.querySelector("[data-testid='daily-wallpaper']")?.getAttribute("src") !== previous, firstWallpaperSrc);
  const changedWallpaperSrc = await page.getByTestId("daily-wallpaper").getAttribute("src");
  if (firstWallpaperSrc === changedWallpaperSrc) throw new Error("换一张没有改变壁纸作品");
  await page.locator("[data-action='fix-wallpaper']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='wallpaper-mode']")?.textContent?.includes("已固定"));
  if (!(await page.getByTestId("wallpaper-mode").innerText()).includes("已固定")) throw new Error("壁纸固定状态没有显示");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  if ((await page.getByTestId("daily-wallpaper").getAttribute("src")) !== changedWallpaperSrc) throw new Error("固定壁纸刷新后发生变化");
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  await page.locator("[data-action='use-daily-wallpaper']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='wallpaper-mode']")?.textContent?.includes("每天稳定"));
  await page.locator("[data-action='toggle-wallpaper']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='wallpaper-mode']")?.textContent?.includes("已关闭"));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  if (await page.getByTestId("daily-wallpaper").count()) throw new Error("关闭壁纸后图片仍然存在");
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  await page.locator("[data-action='toggle-wallpaper']").click();
  await page.getByTestId("daily-wallpaper").waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("heading", { name: "夏日列车" }).click();
  await page.getByTestId("detail").waitFor();

  await page.getByRole("button", { name: "保留这张", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-testid='memory-card']")?.textContent?.includes("已保留"));
  if (!((await page.getByTestId("memory-card").innerText()) || "").includes("已保留")) throw new Error("AI 记忆卡片没有经过用户明确保留");

  await page.getByTestId("attitude-summary").click();
  const recommendationChoices = page.locator(".recommend-choice");
  if (await recommendationChoices.count()) throw new Error("尚未选择态度时不应提前开放推荐判断");
  await page.getByRole("button", { name: "无感", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".recommend-choice").length === 1);
  if ((await recommendationChoices.count()) !== 1 || !(await page.getByRole("button", { name: "不会", exact: true }).count())) {
    throw new Error("无感时应只允许确认不会推荐");
  }
  await page.getByRole("button", { name: "喜欢", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".recommend-choice").length === 3);
  if ((await recommendationChoices.count()) !== 3) throw new Error("喜欢时应开放三种推荐判断");
  const attitudeDescription = await page.locator(".attitude-description").innerText();
  if (!attitudeDescription.includes("整体仍然愿意把它记作喜欢")) throw new Error("态度评判标准没有随选择出现");
  await page.getByRole("button", { name: "看对象", exact: true }).click();
  await page.getByRole("button", { name: "喜欢同类题材的人", exact: true }).click();
  await page.getByRole("button", { name: "主题表达打动人", exact: true }).click();
  await page.getByRole("button", { name: "从原文整理条件", exact: true }).click();
  await page.getByRole("button", { name: "+ 喜欢安静画面的人", exact: true }).click();
  await page.getByTestId("recommendation-note").fill("喜欢安静青春片的人");
  await page.getByTestId("recommendation-note").blur();
  await page.locator(".judgement-sheet > .sheet-done").click();

  await page.getByRole("button", { name: /添加卡片/ }).click();
  await page.locator("#card-form select").selectOption({ label: "配乐" });
  await page.locator("#card-form input[name='title']").fill("雨停后的旋律");
  await page.locator("#card-form textarea[name='content']").fill("片尾的旋律让车窗外的光更安静了。");
  await page.getByRole("button", { name: "添加卡片", exact: true }).click();
  await page.getByRole("heading", { name: "雨停后的旋律" }).waitFor();

  await page.reload();
  for (let swipe = 0; swipe < 2; swipe += 1) {
    const carousel = page.getByTestId("memory-carousel");
    await carousel.scrollIntoViewIfNeeded();
    const box = await carousel.boundingBox();
    await page.mouse.move(box.x + box.width * 0.82, box.y + box.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.42, { steps: 6 });
    await page.mouse.up();
  }
  await page.getByRole("heading", { name: "雨停后的旋律" }).waitFor();
  const summary = await page.getByTestId("attitude-summary").innerText();
  if (!summary.includes("喜欢") || !summary.includes("看对象") || !summary.includes("喜欢同类题材的人")) {
    throw new Error("态度、推荐或快捷条件刷新恢复失败");
  }
  await page.getByTestId("attitude-summary").click();
  if ((await page.getByTestId("recommendation-note").inputValue()) !== "喜欢安静青春片的人") throw new Error("推荐自定义补充刷新恢复失败");
  if ((await page.getByRole("button", { name: "✓ 喜欢同类题材的人", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("推荐快捷条件选中状态刷新恢复失败");
  if ((await page.getByRole("button", { name: "✓ 喜欢安静画面的人", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("AI 推荐条件没有经过用户确认并持久化");
  await page.locator(".judgement-sheet > .sheet-done").click();
  await page.getByRole("button", { name: "返回记录流" }).click();
  await page.getByRole("button", { name: "偏好设置", exact: true }).click();
  await page.locator("[data-action='toggle-auto-analysis']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='recording-mode']")?.textContent?.includes("当前关闭"));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await page.getByTestId("add-record").click();
  await page.getByTestId("composer-input").fill("#只保存原文\n这一刻先不整理，只把原来的话留下来。");
  await page.getByTestId("finish-record").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-status']")?.textContent?.includes("仅保存原文"));
  await page.getByRole("heading", { name: "只保存原文", exact: true }).click();
  await page.getByTestId("raw-only-status").waitFor();
  await page.getByRole("button", { name: "稍后整理", exact: true }).click();
  await page.getByTestId("attitude-summary").waitFor();
  await page.getByRole("button", { name: "返回记录流" }).click();
  await page.getByTestId("add-record").click();
  await page.getByTestId("composer-input").fill("#哆啦A梦/大雄与云之王国\n小时候留下来的印象，现在想重新记下来。");
  await page.getByTestId("finish-record").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-status']")?.textContent?.includes("待确认作品"));
  if (await page.getByRole("heading", { name: "哆啦A梦/大雄与云之王国", exact: true }).count()) throw new Error("斜线系列速记被错误显示为本地作品标题");
  await page.getByRole("heading", { name: "大雄与云之王国", exact: true }).click();
  await page.locator("[data-action='confirm-work-match'][data-subject-id='451']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("作品已确认"));
  const canonicalTitle = page.locator(".detail-title-row h1");
  if ((await canonicalTitle.innerText()) !== "《哆啦A梦：大雄与云之王国》") throw new Error("成品标题没有采用 Bangumi 标准中文名");
  if ((await canonicalTitle.locator("a").getAttribute("href")) !== "https://bangumi.tv/subject/451") throw new Error("成品标题没有链接到正式 Bangumi 条目");
  await page.getByRole("button", { name: "稍后整理", exact: true }).click();
  await page.getByRole("button", { name: "删除建议", exact: true }).waitFor();
  await page.getByRole("button", { name: "删除建议", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".memory-empty")?.textContent?.includes("还没有记忆卡片"));
  if (!((await page.locator(".impression").innerText()) || "").includes("小时候留下来的印象")) throw new Error("删除 AI 建议时错误改动了原文");
  await context.close();
}

async function runOfflineWallpaperPath(browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: "light", serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(async ({ imageBase64 }) => {
    const bytes = Uint8Array.from(atob(imageBase64), (character) => character.charCodeAt(0));
    const cache = await caches.open("movie-imprint-wallpapers-v1");
    await cache.put("/api/bangumi/image?subjectId=449", new Response(bytes, { headers: { "content-type": "image/png", "x-movie-imprint-cached-at": String(Date.now()) } }));
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("movie-imprint-local", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("works", "readwrite");
      transaction.objectStore("works").put({
        id: "work_offline_wallpaper",
        work_id: "work_offline_wallpaper",
        title: "哆啦A梦：大雄与动物行星",
        original_title: "ドラえもん のび太とアニマル惑星",
        work_type: "animation_movie",
        aliases: [],
        release_year: 1990,
        external_refs: [{ source: "bangumi", id: "449", url: "https://bgm.tv/subject/449" }],
        identity_status: "matched",
        match: { status: "confirmed", candidates: [] }
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }, { imageBase64: mockWallpaper.toString("base64") });
  await page.reload();
  await page.getByTestId("daily-wallpaper").waitFor();
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId("daily-wallpaper").waitFor();
  const loaded = await page.getByTestId("daily-wallpaper").evaluate((image) => image.complete && image.naturalWidth > 0);
  if (!loaded) throw new Error("离线刷新后没有从本地缓存恢复按日壁纸");
  await context.close();
}

async function captureVariants(browser) {
  const variants = [
    { name: "412x915", viewport: { width: 412, height: 915 } },
    { name: "360x800", viewport: { width: 360, height: 800 } }
  ];
  for (const { name, viewport } of variants) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ viewport, colorScheme: theme, serviceWorkers: "block" });
      await context.addInitScript((selectedTheme) => localStorage.setItem("movie-imprint-theme", selectedTheme), theme);
      const page = await context.newPage();
      await mockBangumi(page);
      await page.goto(baseUrl);
      const output = join(root, "artifacts", "screenshots", name, theme);
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: join(output, "home.png") });
      await ensureVisible(page.getByTestId("add-record"), viewport, "首页记录按钮");

      await page.getByTestId("add-record").click();
      await page.getByTestId("composer-input").fill("#夏日列车 #电影院\n最后一幕还是很击中我。雨停以后，车窗外的光也变得很安静。");
      await page.waitForTimeout(250);
      await ensureVisible(page.getByTestId("finish-record"), viewport, "记录完成按钮");
      await page.screenshot({ path: join(output, "compose.png") });
      await page.getByTestId("finish-record").click();
      await page.waitForFunction(() => document.querySelector("[data-testid='work-match-status']")?.textContent?.includes("待确认作品"));
      await page.getByRole("heading", { name: "夏日列车" }).click();
      await page.screenshot({ path: join(output, "detail.png") });
      await page.locator("[data-action='confirm-work-match'][data-subject-id='900001']").click();
      await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("作品已确认"));
      await page.getByRole("button", { name: "返回记录流" }).click();
      await page.getByTestId("daily-wallpaper").waitFor();
      await page.screenshot({ path: join(output, "wallpaper.png") });
      await page.getByRole("button", { name: "偏好设置", exact: true }).click();
      await page.getByTestId("wallpaper-settings").waitFor();
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(output, "wallpaper-settings.png") });
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("heading", { name: "夏日列车" }).click();
      await page.getByTestId("attitude-summary").click();
      await page.getByRole("button", { name: "喜欢", exact: true }).click();
      await page.getByRole("button", { name: "看对象", exact: true }).click();
      await page.getByRole("button", { name: "喜欢同类题材的人", exact: true }).click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(output, "attitude.png") });
      await context.close();
    }
  }
}

const server = spawn(process.execPath, [join(root, "server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer();
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  try {
    await runFunctionalPath(browser);
    await runOfflineWallpaperPath(browser);
    if (!testOnly) await captureVariants(browser);
  } finally {
    await browser.close();
  }
  console.log(testOnly ? "E2E 主路径与恢复测试通过" : "E2E 测试通过，截图已生成");
} finally {
  server.kill();
}
