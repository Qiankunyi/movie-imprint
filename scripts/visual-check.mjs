import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const port = 4174;
const baseUrl = `http://127.0.0.1:${port}`;
const testOnly = process.argv.includes("--test-only");
// R3：壁纸已移除，这张图现在只是 /api/bangumi/image 的模拟响应体（用于海报请求 mock），
// 文件本身与展示无关，保留原路径即可。
const mockPosterImage = await readFile(join(root, "docs", "design", "mockups", "assets", "cinema-memory-hero-v1.png"));

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

async function openCapture(page, workTitle, { location = "home", viewedOn = null } = {}) {
  if (!(await page.getByTestId("add-record").count())) await page.getByTestId("fab-toggle").click();
  await page.getByTestId("add-record").click();
  await page.getByTestId("capture-entry").waitFor();
  const entryText = (await page.getByTestId("capture-entry").innerText()) || "";
  if (!entryText.includes("观影信息")) {
    throw new Error("开始记录没有先进入统一的观影信息步骤");
  }
  for (const choice of ["粘贴票务信息", "解析票务信息", "暂时跳过"]) {
    if (!entryText.includes(choice)) throw new Error(`观影信息步骤缺少“${choice}”入口`);
  }
  if (location === "cinema") {
    const ticketDate = (viewedOn || new Date().toISOString().slice(0, 10)).replaceAll("-", "/");
    await page.getByTestId("capture-paste-input").fill(`松竹マルチプレックスシアターズ
作品名：【IMAX】${workTitle}
観賞日：${ticketDate}
開映時間：19:20
終映時間：21:30
劇場：测试电影院
座席：K-11`);
    await page.getByTestId("parse-ticket-info").click();
    await page.getByTestId("ticket-confirm").waitFor();
    await page.getByTestId("confirm-ticket-capture").click();
  } else {
    const titleInput = page.getByTestId("capture-entry-work-title-input");
    if (await titleInput.count()) await titleInput.fill(workTitle);
    await page.getByTestId("skip-viewing-info").click();
  }
  await page.getByTestId("composer").waitFor();
}

async function returnToTimeline(page) {
  if (!(await page.getByTestId("detail-back").count())) await page.getByTestId("fab-toggle").click();
  await page.getByTestId("detail-back").click();
}

async function openSettings(page) {
  await page.getByTestId("open-sidebar").click();
  await page.getByTestId("sidebar-settings").click();
}

async function openDetailFabAction(page, testId) {
  if (!(await page.getByTestId(testId).count())) await page.getByTestId("fab-toggle").click();
  await page.getByTestId(testId).click();
}

async function mockBangumi(page) {
  await page.route("**/public/assets/sidebar-stills/manifest.js*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: 'export const SIDEBAR_STILLS = Object.freeze(["/public/assets/sidebar-stills/sidebar-01", "/public/assets/sidebar-stills/sidebar-02"]); export const SIDEBAR_STILL_EXTENSIONS = Object.freeze([".avif", ".webp", ".png", ".jpg", ".jpeg"]);'
    });
  });
  await page.route("**/public/assets/sidebar-stills/sidebar-*.*", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: mockPosterImage });
  });
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
    const reflection = body.sources?.free_reflection || {
      source_id: "free_reflection_test",
      source_revision_id: "free_reflection_revision_test",
      text: body.rawText || "原文"
    };
    const excerpt = String(reflection.text || "").split("\n").findLast((line) => line.trim() && !line.trim().startsWith("#"))?.trim() || "原文";
    const evidence = [{
      source_type: "free_reflection",
      source_id: reflection.source_id,
      source_revision_id: reflection.source_revision_id,
      question_id: "",
      excerpt,
      basis: "explicit",
      voice: "user",
      claim_mode: "direct_feeling",
      explanation: "测试原文依据",
      confidence: 0.9
    }];
    const analysisId = `analysis_test_${Date.now()}`;
    const cardId = `card_test_${Date.now()}`;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        analysis: {
          analysis_id: analysisId,
          schema_version: "2.1",
          prompt_version: "test-v2.1",
          source_revision_ids: [reflection.source_revision_id, ...(body.sources?.self_interview?.source_revision_ids || [])],
          attitude: { suggested: "like", alternative: null, evidence, confidence: 0.9 },
          emotions: [{ label: "感动", evidence, confidence: 0.9 }],
          memory_cards: [{ temporary_id: cardId, card_id: cardId, memory_cluster_id: "cluster_test", type: "被击中的瞬间", title: "最先留下来的片段", content: excerpt, why_it_matters: null, related_emotions: ["感动"], is_core: true, order: 0, evidence, confidence: 0.9, provenance: "ai_suggested", origin: "ai_generated", status: "draft", user_modified: false, revision_history: [], analysis_id: analysisId }],
          warnings: []
        },
        metadata: { provider: body.provider || "gemini", model: "gemini-test", prompt_version: "test-v2.1", schema_version: "2.1", input_hash: "test", usage: {} }
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
    await route.fulfill({ status: 200, contentType: "image/png", body: mockPosterImage });
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
  await page.route("**/api/tmdb/movie?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        detail: {
          tmdbId: 123,
          title: "档案测试片",
          backdrops: [1, 2, 3, 4].map((index) => ({
            path: `/archivebackdrop${index}.jpg`, width: 1920, height: 1080, aspectRatio: 1.778, voteAverage: 8 - index / 10
          }))
        }
      })
    });
  });
  await page.route("**/api/tmdb/image?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: mockPosterImage });
  });
  await page.route("https://images.example/**", async (route) => {
    if (route.request().url().includes("broken")) {
      await route.fulfill({ status: 404, contentType: "text/plain", body: "missing" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "image/png", body: mockPosterImage });
  });
}

async function runArchiveUiPath(browser) {
  const viewport = { width: 412, height: 915 };
  const context = await browser.newContext({ viewport, colorScheme: "light", serviceWorkers: "block" });
  const page = await context.newPage();
  await mockBangumi(page);
  await page.goto(`${baseUrl}/?archive-ui=1`);
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("movie-imprint-local", 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const works = [
      { id: "work_archive", title: "这是一个足够长用来验证两行网格整齐的电影标题", work_type: "live_action_film", aliases: [], release_year: 2026, release_dates: { entries: [] }, external_refs: [{ source: "tmdb", id: "123" }], primary_source: "tmdb", poster: null, stills: [], genres: [], related_refs: [], tagline: { text: "一段真正属于档案正文的简介。", source: "manual", updated_at: new Date().toISOString() }, identity_status: "matched", merged_from: [], first_recorded_at: new Date().toISOString(), match: { status: "confirmed", candidates: [] } },
      { id: "work_short", title: "短片名", work_type: "live_action_film", aliases: [], release_year: 2025, release_dates: { entries: [] }, external_refs: [], poster: null, stills: [], genres: [], related_refs: [], tagline: null, identity_status: "local_only", merged_from: [], first_recorded_at: new Date().toISOString(), match: { status: "idle", candidates: [] } }
    ];
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("works", "readwrite");
      for (const work of works) transaction.objectStore("works").put(work);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  });
  await page.reload();

  await page.getByTestId("open-sidebar").click();
  const artBox = await page.getByTestId("sidebar-artwork").boundingBox();
  const firstItemBox = await page.getByTestId("sidebar-home").boundingBox();
  if (!artBox || Math.abs(artBox.width / artBox.height - 4 / 3) > 0.02) throw new Error("侧栏视觉区不是 4:3");
  if (!firstItemBox || firstItemBox.y < 280 || firstItemBox.y > 650) throw new Error(`侧栏菜单没有下移到单手区：${JSON.stringify(firstItemBox)}`);
  if (await page.locator(".sidebar-artwork-dots, .sidebar-artwork button").count()) throw new Error("侧栏视觉区仍有轮播控件");
  const dailyArtworkSrc = await page.locator(".sidebar-artwork-img").getAttribute("src");
  await page.getByTestId("sidebar-home").click();
  await page.getByTestId("open-sidebar").click();
  if (await page.locator(".sidebar-artwork-img").getAttribute("src") !== dailyArtworkSrc) throw new Error("同一天再次打开侧栏时图片发生变化");
  await page.getByTestId("sidebar-shelf").click();
  await page.getByTestId("shelf-watch-status").selectOption("all");

  const longTitle = page.getByTestId("shelf-item-work_archive").locator(".shelf-item-title");
  const titleStyle = await longTitle.evaluate((element) => ({
    align: getComputedStyle(element).textAlign,
    height: element.getBoundingClientRect().height,
    lines: getComputedStyle(element).webkitLineClamp
  }));
  if (titleStyle.align !== "center" || titleStyle.height < 35 || titleStyle.lines !== "2") {
    throw new Error(`影库长标题没有固定两行居中：${JSON.stringify(titleStyle)}`);
  }
  await page.getByTestId("shelf-item-work_archive").click();
  await page.getByTestId("work").waitFor();
  if (await page.getByTestId("work-start-record").count()) throw new Error("作品页仍有重复的底部长条记录按钮");
  const browseText = await page.locator(".work-content").innerText();
  for (const forbidden of ["编辑", "管理", "添加系列", "私人剧照", "主展示图", "真人电影"]) {
    if (browseText.includes(forbidden)) throw new Error(`作品浏览态仍显示操作或后台文字：${forbidden}`);
  }
  for (const testId of ["edit-tagline", "edit-release-dates", "edit-series", "edit-collections"]) {
    const entry = page.getByTestId(testId);
    if (!await entry.count() || !await entry.evaluate((element) => element.classList.contains("archive-pressable"))) {
      throw new Error(`作品信息区没有统一的内容点击入口：${testId}`);
    }
  }
  if (!await page.getByTestId("add-first-still").isVisible()) throw new Error("剧照空状态没有显示");

  await page.getByTestId("add-first-still").click();
  await page.getByTestId("tmdb-still-0").waitFor();
  if (await page.locator(".tmdb-still-candidate").count() !== 4) throw new Error("TMDB 候选没有完整展示");
  const urls = [
    "https://images.example/one.jpg",
    "https://images.example/broken.jpg",
    "https://images.example/three.jpg",
    "https://images.example/four.jpg"
  ];
  for (const [index, url] of urls.entries()) {
    await page.getByTestId("still-url-input").fill(url);
    await page.locator("#still-url-form").getByRole("button", { name: "添加剧照", exact: true }).click();
    await page.waitForFunction((count) => document.querySelectorAll(".still-manager-row").length === count, index + 1);
  }
  if (!await page.getByTestId("still-url-input").isDisabled()) throw new Error("达到 4 张后仍可继续添加外链");
  if (await page.locator(".tmdb-still-candidate:not(:disabled)").count()) throw new Error("达到 4 张后 TMDB 候选仍可保存");
  await page.getByTestId("stills-editor").locator(".sheet-title-row .icon-button").click();

  const track = page.getByTestId("work-stills-track");
  if (await track.locator(".work-still").count() !== 4) throw new Error("作品页没有展示 4 张已保存剧照");
  if ((await page.locator(".work-stills-section").innerText()).includes("主展示图")) throw new Error("剧照浏览态仍显示主展示图标识");
  if (await page.locator("[data-still-dot]").count() !== 4) throw new Error("多图分页指示数量不正确");
  await page.waitForFunction(() => document.querySelectorAll(".work-still.image-failed").length === 1);
  await track.evaluate((element) => element.scrollTo({ left: element.clientWidth, behavior: "instant" }));
  await page.waitForTimeout(100);
  if (!await page.locator("[data-still-dot='1']").evaluate((dot) => dot.classList.contains("active"))) throw new Error("横向滑动后分页指示没有更新");

  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const fabBox = await page.getByTestId("fab-toggle").boundingBox();
  const historyBox = await page.getByTestId("work-history").boundingBox();
  if (!fabBox || !historyBox || historyBox.y + historyBox.height > fabBox.y - 4) {
    throw new Error(`页面滚到底时 FAB 遮挡最后内容：fab=${JSON.stringify(fabBox)} history=${JSON.stringify(historyBox)}`);
  }

  await page.getByTestId("fab-toggle").click();
  await page.getByRole("button", { name: "深色模式", exact: true }).click();
  if (await page.evaluate(() => document.documentElement.dataset.theme) !== "dark") throw new Error("作品档案深色主题没有生效");
  await page.locator(".fab-scrim").click();
  await page.waitForTimeout(200);

  await page.setViewportSize({ width: 1024, height: 800 });
  const contentWidth = await page.locator(".work-content").evaluate((element) => element.getBoundingClientRect().width);
  if (contentWidth > 681 || await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("PC Web 作品页响应式溢出");
  await page.locator(".work-stills-shell").hover();
  if (!await page.locator(".work-still-arrow.next").isVisible()) throw new Error("桌面端悬停时没有剧照箭头辅助");

  // 片单详情只保留 FAB 内的添加入口，不再在页面顶部重复放大按钮。
  await page.getByTestId("fab-toggle").click();
  await page.getByTestId("work-back").click();
  await page.getByTestId("fab-toggle").click();
  await page.getByTestId("shelf-back").click();
  await page.getByTestId("open-sidebar").click();
  await page.getByTestId("sidebar-collections").click();
  await page.getByTestId("fab-toggle").click();
  await page.getByTestId("open-create-collection").click();
  await page.getByTestId("new-collection-input").fill("FAB 入口回归片单");
  await page.locator("#collection-create-form").getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: /FAB 入口回归片单/ }).click();
  if (await page.locator(".collection-add-button").count()) throw new Error("片单详情仍保留顶部大号添加作品按钮");
  await page.getByTestId("fab-toggle").click();
  if (await page.getByTestId("collection-add-work").count() !== 1 || !await page.getByTestId("collection-add-work").isVisible()) {
    throw new Error("片单详情 FAB 没有唯一的添加作品入口");
  }
  await context.close();
}

async function runFunctionalPath(browser) {
  const viewport = { width: 360, height: 800 };
  const context = await browser.newContext({ viewport, colorScheme: "light", serviceWorkers: "block" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.stack || error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });
  await mockBangumi(page);
  const initialResponse = await page.goto(`${baseUrl}/?clean=1`);
  await page.waitForTimeout(500);
  if (!(await page.getByTestId("fab-toggle").count())) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    throw new Error(`首屏没有挂载：status=${initialResponse?.status()} url=${page.url()} body=${bodyText.slice(0, 500)}`);
  }
  await openCapture(page, "夏日列车", { location: "cinema", viewedOn: "2017-09-10" });
  const input = page.getByTestId("composer-input");
  await input.fill("");
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
  if (!listText.includes("1. 第一点\n2. 第二点\n- 补充一点")) throw new Error(`列表快捷输入或自动续号失败：${JSON.stringify(listText)}`);
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
  // 草稿恢复会把流程状态置为 capture:compose。此时点“开始记录”也必须重启到
  // 观影信息，而不能第一次直达感想、关闭后第二次才出现票务入口。
  await page.getByTestId("fab-toggle").click();
  await page.getByTestId("add-record").click();
  await page.getByTestId("capture-entry").waitFor();
  if (!((await page.getByTestId("capture-entry").innerText()) || "").includes("观影信息")) {
    throw new Error("草稿恢复后首次开始记录绕过了观影信息步骤");
  }
  // 重新加载恢复原草稿上下文，再继续原有的草稿恢复回归路径。
  await page.reload();
  await page.getByRole("button", { name: /未完成的记录/ }).click();
  await page.getByTestId("composer-input").waitFor();
  const restored = await page.getByTestId("composer-input").inputValue();
  if (!restored.includes("#夏日列车")) throw new Error("IndexedDB 草稿刷新恢复失败");
  await page.getByTestId("finish-record").click();
  await page.getByTestId("interview-invite").waitFor();
  await page.getByRole("button", { name: "直接生成电影印记", exact: true }).click();
  await openDetailFabAction(page, "detail-ai-draft");
  await page.getByTestId("analysis-draft").waitFor();
  await page.getByRole("button", { name: "确认这次电影印记", exact: true }).click();
  await openDetailFabAction(page, "detail-work-match");
  await page.getByTestId("work-match-panel").waitFor();
  const summerCandidate = page.locator("[data-action='confirm-work-match']").filter({ hasText: "夏日列车" }).first();
  await summerCandidate.waitFor();
  await summerCandidate.click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("作品条目"));
  await page.getByTestId("work-match-panel").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("请选择正确条目"));
  await page.getByRole("button", { name: "保留当前匹配", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("作品条目"));
  await page.getByTestId("work-match-sheet").getByRole("button", { name: "关闭", exact: true }).click();
  const linkedWork = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("movie-imprint-local", 4);
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
  await returnToTimeline(page);
  await page.reload();
  // R3：壁纸已移除，首页改为鉴赏履历卡——回归检查卡片正确展示海报、没有任何壁纸残留元素、
  // 设置面板已改名且不再有壁纸选项。
  if (await page.locator(".wallpaper, .wallpaper-image, .wallpaper-scrim, .wallpaper-credit, .detail-wallpaper").count()) {
    throw new Error("首页或详情页仍残留壁纸相关元素");
  }
  const summerTrainCard = page.locator(".record-card", { hasText: "夏日列车" });
  await summerTrainCard.waitFor();
  const summerTrainCardText = await summerTrainCard.innerText();
  if (!summerTrainCardText.includes("IMAX") || !summerTrainCardText.includes("2017/09/10")) {
    throw new Error(`影院补录的辨识度徽章或实际日期没有显示在时间线：${summerTrainCardText}`);
  }
  if (/测试电影院|在家观看|电影院观看/.test(summerTrainCardText)) {
    throw new Error(`时间线仍在常驻展示基础观看方式或影院名：${summerTrainCardText}`);
  }
  const posterImg = summerTrainCard.locator(".record-poster-img");
  await posterImg.waitFor();
  const posterLoaded = await posterImg.evaluate((image) => image.complete && image.naturalWidth > 0);
  if (!posterLoaded) throw new Error("履历卡海报没有正常加载");
  await openSettings(page);
  await page.getByTestId("settings").waitFor();
  if (await page.locator("[data-action='toggle-wallpaper'], [data-action='change-wallpaper']").count()) {
    throw new Error("设置面板里仍残留壁纸选项");
  }
  if (!(await page.getByTestId("settings").innerText()).includes("云端同步")) throw new Error("设置面板改名后同步区块丢失");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("heading", { name: "夏日列车" }).click();
  await page.getByTestId("detail").waitFor();
  await page.getByTestId("viewing-events").waitFor();
  if (!((await page.locator(".detail-date").innerText()) || "").includes("2017年9月10日")) {
    throw new Error("详情页仍在显示记录创建日期，而不是实际观看日期");
  }
  if (!((await page.getByTestId("viewing-events").innerText()) || "").includes("测试电影院")) {
    throw new Error("无票务 + 电影院观看没有保存为影院场次");
  }
  await page.reload();
  await page.getByTestId("viewing-events").waitFor();
  if (!((await page.locator(".detail-date").innerText()) || "").includes("2017年9月10日")) {
    throw new Error("刷新感想详情后真实观影日期丢失");
  }
  if (!((await page.getByTestId("viewing-events").innerText()) || "").includes("测试电影院")) {
    throw new Error("刷新感想详情后正式观影场次丢失");
  }
  const detailSectionOrder = await page.locator(".detail-content").evaluate((root) => {
    const selectors = [".viewing-events-section", ".memory-heading", "[data-testid='interview-archive']", ".reflection-archive"];
    return selectors.map((selector) => [...root.children].findIndex((child) => child.matches(selector)));
  });
  if (detailSectionOrder.some((index) => index < 0) || detailSectionOrder.some((index, i) => i > 0 && index <= detailSectionOrder[i - 1])) {
    throw new Error(`详情内容顺序没有收敛为观影场次→正式卡片→自我采访→原始感想：${detailSectionOrder.join(",")}`);
  }
  if (!(await page.locator(".reflection-letter").count())) throw new Error("原始感想没有使用独立信笺式阅读容器");
  if (await page.locator(".detail-content > .judgement-summary, .detail-content > .work-match-panel, .detail-content > .analysis-draft").count()) {
    throw new Error("后台操作入口仍混在感想详情正文里");
  }
  await page.getByTestId("edit-record-viewing-info").click();
  await page.getByTestId("history-viewed-on").fill("2018-10-11");
  await page.getByTestId("history-location-home").check();
  await page.locator("#history-event-form").getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".detail-date")?.textContent?.includes("2018年10月11日"));
  const editedDetailDate = (await page.locator(".detail-date").innerText()) || "";
  if (!editedDetailDate.includes("2018年10月11日")) {
    throw new Error(`成型记录修改实际观看日期后详情页没有更新：${editedDetailDate}`);
  }
  if (!((await page.getByTestId("viewing-events").innerText()) || "").includes("在家／线上观看")) {
    throw new Error("成型记录修改观看方式后没有更新");
  }
  await returnToTimeline(page);
  const editedTimelineCard = page.locator(".record-card", { hasText: "夏日列车" });
  await editedTimelineCard.waitFor();
  const editedTimelineText = (await editedTimelineCard.innerText()) || "";
  if (!editedTimelineText.includes("2018/10/11")) {
    throw new Error(`修改实际观影日期后时间线没有同步：${editedTimelineText}`);
  }
  if (/在家观看|电影院观看|测试电影院|IMAX/.test(editedTimelineText)) {
    throw new Error(`普通观看方式仍占用时间线徽章位，或修改后保留了旧影院信息：${editedTimelineText}`);
  }
  await editedTimelineCard.getByRole("heading", { name: "夏日列车" }).click();
  await page.getByTestId("detail").waitFor();

  await page.getByRole("heading", { name: "最先留下来的片段" }).waitFor();
  if (await page.getByTestId("analysis-draft").count()) throw new Error("AI 草稿确认后仍停留在待确认区");
  if (!(await page.getByRole("button", { name: "取消核心", exact: true }).count())) throw new Error("AI 草稿没有经过用户明确确认进入正式记录");

  await openDetailFabAction(page, "detail-attitude");
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

  await page.getByRole("button", { name: /添加一条记忆/ }).click();
  await page.locator("#card-form select").selectOption({ label: "配乐" });
  await page.locator("#card-form input[name='title']").fill("雨停后的旋律");
  await page.locator("#card-form textarea[name='content']").fill("片尾的旋律让车窗外的光更安静了。");
  await page.getByRole("button", { name: "添加卡片", exact: true }).click();
  await page.getByRole("heading", { name: "雨停后的旋律" }).waitFor();

  await page.reload();
  // R3：记忆卡片竖向连续流动，全部一次渲染——不再需要横向滑动就能看到全部卡片。
  const memoryList = page.getByTestId("memory-list");
  await memoryList.waitFor();
  if (await page.locator(".memory-pagination, .swipe-hint").count()) {
    throw new Error("记忆卡片仍残留横向分页/滑动提示控件");
  }
  await page.getByRole("heading", { name: "雨停后的旋律" }).waitFor();
  if (!((await page.locator(".attitude-badge").innerText()) || "").includes("喜欢")) throw new Error("个人态度刷新恢复失败");
  await openDetailFabAction(page, "detail-attitude");
  if ((await page.getByTestId("recommendation-note").inputValue()) !== "喜欢安静青春片的人") throw new Error("推荐自定义补充刷新恢复失败");
  if ((await page.getByRole("button", { name: "✓ 喜欢同类题材的人", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("推荐快捷条件选中状态刷新恢复失败");
  if ((await page.getByRole("button", { name: "✓ 喜欢安静画面的人", exact: true }).getAttribute("aria-pressed")) !== "true") throw new Error("AI 推荐条件没有经过用户确认并持久化");
  await page.locator(".judgement-sheet > .sheet-done").click();
  await returnToTimeline(page);
  await page.getByTestId("open-sidebar").click();
  await page.getByTestId("sidebar-shelf").click();
  await page.locator(".shelf-item", { hasText: "夏日列车" }).click();
  await page.getByTestId("work").waitFor();
  const latestAttitudeLabel = await page.getByTestId("work-latest-attitude").getAttribute("aria-label");
  if (!latestAttitudeLabel?.includes("喜欢")) throw new Error(`作品页没有显示最新个人态度图标：${latestAttitudeLabel}`);
  await page.locator("[data-testid^='work-impression-']").first().click();
  await page.getByTestId("detail").waitFor();
  await openDetailFabAction(page, "detail-ai-draft");
  await page.getByTestId("analysis-draft").waitFor();
  await page.getByRole("button", { name: "把建议加入正式记录", exact: true }).waitFor();
  await page.getByRole("button", { name: "用这次结果替换正式卡片", exact: true }).waitFor();
  await page.getByRole("button", { name: "保留正式记录并收起草稿", exact: true }).click();
  await page.getByRole("heading", { name: "雨停后的旋律" }).waitFor();
  await returnToTimeline(page);
  if (!(await page.getByTestId("open-sidebar").count())) {
    await page.getByTestId("fab-toggle").click();
    await page.getByTestId("work-back").click();
    await page.getByTestId("fab-toggle").click();
    await page.getByTestId("shelf-back").click();
  }
  await openSettings(page);
  await page.locator("[data-action='toggle-auto-analysis']").click();
  await page.waitForFunction(() => document.querySelector("[data-testid='recording-mode']")?.textContent?.includes("当前关闭"));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await openCapture(page, "只保存原文");
  await page.getByTestId("composer-input").fill("#只保存原文\n这一刻先不整理，只把原来的话留下来。");
  await page.waitForFunction(() => document.querySelector("[data-testid='save-status']")?.textContent === "已存于本机");
  await page.getByTestId("finish-record").click();
  await page.getByTestId("interview-invite").waitFor();
  await page.getByRole("button", { name: "稍后再说", exact: true }).click();
  await page.getByTestId("interview-archive").waitFor();
  if (!((await page.locator(".reflection-archive").innerText()) || "").includes("这一刻先不整理")) throw new Error("关闭采访邀请时没有保留原始感想");
  await returnToTimeline(page);
  await openCapture(page, "哆啦A梦/大雄与云之王国");
  await page.getByTestId("composer-input").fill("#哆啦A梦/大雄与云之王国\n小时候留下来的印象，现在想重新记下来。");
  await page.waitForFunction(() => document.querySelector("[data-testid='save-status']")?.textContent === "已存于本机");
  await page.getByTestId("finish-record").click();
  await page.getByTestId("interview-invite").waitFor();
  await page.getByRole("button", { name: "稍后再说", exact: true }).click();
  if (await page.getByRole("heading", { name: "哆啦A梦/大雄与云之王国", exact: true }).count()) throw new Error("斜线系列速记被错误显示为本地作品标题");
  await openDetailFabAction(page, "detail-work-match");
  const doraemonCandidate = page.locator("[data-action='confirm-work-match']").filter({ hasText: "大雄与云之王国" }).first();
  await doraemonCandidate.waitFor();
  await doraemonCandidate.click();
  await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("作品条目"));
  await page.getByTestId("work-match-sheet").getByRole("button", { name: "关闭", exact: true }).click();
  const canonicalTitle = page.locator(".detail-title-row h1");
  if ((await canonicalTitle.innerText()) !== "《哆啦A梦：大雄与云之王国》") throw new Error("成品标题没有采用 Bangumi 标准中文名");
  if ((await canonicalTitle.locator("a").getAttribute("href")) !== "https://bangumi.tv/subject/451") throw new Error("成品标题没有链接到正式 Bangumi 条目");
  await openDetailFabAction(page, "detail-ai-draft");
  await page.getByTestId("analysis-draft").waitFor();
  await page.getByRole("button", { name: "删除建议", exact: true }).waitFor();
  await page.getByRole("button", { name: "删除建议", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".memory-empty")?.textContent?.includes("还没有记忆卡片"));
  if (!((await page.locator(".impression").innerText()) || "").includes("小时候留下来的印象")) throw new Error("删除 AI 建议时错误改动了原文");
  await context.close();
}

/**
 * R3：壁纸移除后，海报缓存（C2 建立的策略）复用同一个 /api/bangumi/image 端点与
 * Service Worker 缓存实现，只是缓存名从 movie-imprint-wallpapers-v1 改成了
 * movie-imprint-posters-v1。这里验证断网时首页履历卡的海报仍能从缓存加载，不破图。
 */
async function runOfflinePosterPath(browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: "light", serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(async ({ imageBase64 }) => {
    const bytes = Uint8Array.from(atob(imageBase64), (character) => character.charCodeAt(0));
    const cache = await caches.open("movie-imprint-posters-v1");
    await cache.put("/api/bangumi/image?subjectId=449", new Response(bytes, { headers: { "content-type": "image/png", "x-movie-imprint-cached-at": String(Date.now()) } }));
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("movie-imprint-local", 4);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = new Date().toISOString();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(["works", "records"], "readwrite");
      transaction.objectStore("works").put({
        id: "work_offline_poster",
        work_id: "work_offline_poster",
        title: "哆啦A梦：大雄与动物行星",
        original_title: "ドラえもん のび太とアニマル惑星",
        work_type: "animation_movie",
        aliases: [],
        release_year: 1990,
        poster: { source: "bangumi", subject_id: 449 },
        external_refs: [{ source: "bangumi", id: "449", url: "https://bgm.tv/subject/449" }],
        identity_status: "matched",
        match: { status: "confirmed", candidates: [] },
        first_recorded_at: now
      });
      transaction.objectStore("records").put({
        id: "record_offline_poster",
        schema_version: "0.1-local",
        title: "哆啦A梦：大雄与动物行星",
        rawText: "断网海报缓存回归测试用记录。",
        tags: [],
        inputHints: { seriesPath: [], workTitle: null },
        createdAt: now,
        updatedAt: now,
        status: "confirmed",
        attitude: "like",
        recommendation: null,
        recommendationNote: "",
        cards: [],
        work_id: "work_offline_poster",
        workId: "work_offline_poster",
        record_kind: "viewing",
        viewing_event_id: null
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }, { imageBase64: mockPosterImage.toString("base64") });
  await page.reload();
  const posterImg = page.locator(".record-card", { hasText: "哆啦A梦：大雄与动物行星" }).locator(".record-poster-img");
  await posterImg.waitFor();
  await context.setOffline(true);
  await page.reload();
  await posterImg.waitFor();
  const loaded = await page.waitForFunction(() => {
    const image = document.querySelector(".record-poster-img");
    return Boolean(image?.complete && image.naturalWidth > 0);
  }, null, { timeout: 5000 }).then(() => true).catch(() => false);
  if (!loaded) {
    const diagnostics = await page.evaluate(async () => ({
      controlled: Boolean(navigator.serviceWorker.controller),
      src: document.querySelector(".record-poster-img")?.getAttribute("src"),
      cacheKeys: (await (await caches.open("movie-imprint-posters-v1")).keys()).map((item) => item.url)
    }));
    throw new Error(`离线刷新后履历卡海报没有从本地缓存恢复：${JSON.stringify(diagnostics)}`);
  }
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
      await ensureVisible(page.getByTestId("fab-toggle"), viewport, "首页记录按钮");

      await openCapture(page, "夏日列车", { location: "cinema" });
      await page.getByTestId("composer-input").fill("#夏日列车 #电影院\n最后一幕还是很击中我。雨停以后，车窗外的光也变得很安静。");
      await page.waitForFunction(() => document.querySelector("[data-testid='save-status']")?.textContent === "已存于本机");
      await page.waitForTimeout(250);
      await ensureVisible(page.getByTestId("finish-record"), viewport, "记录完成按钮");
      await page.screenshot({ path: join(output, "compose.png") });
      await page.getByTestId("finish-record").click();
      await page.getByTestId("interview-invite").waitFor();
      await page.getByRole("button", { name: "直接生成电影印记", exact: true }).click();
      await openDetailFabAction(page, "detail-ai-draft");
      await page.getByTestId("analysis-draft").waitFor();
      await page.screenshot({ path: join(output, "detail.png") });
      await page.getByRole("button", { name: "确认这次电影印记", exact: true }).click();
      await openDetailFabAction(page, "detail-work-match");
      await page.locator("[data-action='confirm-work-match']").filter({ hasText: "夏日列车" }).first().waitFor();
      await page.locator("[data-action='confirm-work-match']").filter({ hasText: "夏日列车" }).first().click();
      await page.waitForFunction(() => document.querySelector("[data-testid='work-match-panel']")?.textContent?.includes("作品条目"));
      await page.getByTestId("work-match-sheet").getByRole("button", { name: "关闭", exact: true }).click();
      await returnToTimeline(page);
      // R3：壁纸移除后，首页鉴赏履历卡（含制式/活动徽章、金属描边）替代了原来的壁纸截图。
      await page.locator(".record-card.cinema").first().waitFor();
      await page.screenshot({ path: join(output, "record-cards.png") });
      await openSettings(page);
      await page.getByTestId("settings").waitFor();
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(output, "settings.png") });
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page.locator(".record-card", { hasText: "夏日列车" }).click();
      await page.getByTestId("detail").waitFor();
      await openDetailFabAction(page, "detail-attitude");
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
    await runOfflinePosterPath(browser);
    await runArchiveUiPath(browser);
    if (!testOnly) await captureVariants(browser);
  } finally {
    await browser.close();
  }
  console.log(testOnly ? "E2E 主路径与恢复测试通过" : "E2E 测试通过，截图已生成");
} finally {
  server.kill();
}
