import { readFileSync, existsSync } from "node:fs";

const src = readFileSync("src/app.js", "utf8");
const uniq = (a) => [...new Set(a)].sort();
const grab = (re, s = src) => uniq([...s.matchAll(re)].map((m) => m[1]));

let problems = 0;
const fail = (msg) => { console.log("✗ " + msg); problems++; };

// ── 1. 未定义的函数调用（这次 ensureWorkLinks 事故的直接防线）─────────────────
// 旧版本只扫 render|open|close|... 这几个前缀，`ensure*` 不在名单里，
// 所以「删种子数据时把夹在中间的 ensureWorkLinks 一起切掉了」没被拦住。
// 现在改成全量：把所有能确定"已定义"的名字收齐，剩下被调用的一律报出来。
const defined = new Set([
  ...grab(/(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g),
  ...grab(/(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g),
  ...grab(/(?:^|\s)class\s+([A-Za-z_$][\w$]*)/g),
  // import { a, b as c } / import x from
  ...[...src.matchAll(/import\s*\{([^}]+)\}/g)]
    .flatMap((m) => m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop().trim()))
    .filter(Boolean),
  ...grab(/import\s+([A-Za-z_$][\w$]*)\s+from/g)
]);

const GLOBALS = new Set([
  // 语言与运行时
  "Array", "Object", "String", "Number", "Boolean", "Math", "JSON", "Date", "RegExp",
  "Map", "Set", "WeakMap", "WeakSet", "Promise", "Error", "Symbol", "Proxy", "Reflect",
  "BigInt", "Intl", "URL", "URLSearchParams", "TextDecoder", "TextEncoder", "AbortController",
  "AbortSignal", "Blob", "File", "FormData", "Headers", "Request", "Response", "Event",
  "CustomEvent", "DOMParser", "Image", "Notification", "Worker", "Element", "Node",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "encodeURI", "decodeURI", "structuredClone", "queueMicrotask", "atob", "btoa",
  // 浏览器
  "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
  "caches", "fetch", "console", "alert", "confirm", "prompt", "matchMedia", "getComputedStyle",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
  "cancelAnimationFrame", "scrollTo", "scrollBy", "indexedDB", "crypto", "performance",
  "IntersectionObserver", "ResizeObserver", "MutationObserver", "getSelection",
  // 关键字/语法噪音（正则会把它们当调用）
  "if", "for", "while", "switch", "catch", "return", "typeof", "new", "await", "function",
  "super", "this", "import", "require", "yield", "of", "in", "do", "else", "try"
]);

// 被调用的标识符：形如 `name(` 且前面不是 `.` 或 `?.`（那是方法调用，不查）
const called = uniq([...src.matchAll(/(?<![.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
// 正则扫描会误伤的几类：函数形参、注释里提到的旧函数名、模板串里的 CSS、
// "O(1) 查表" 这种写法。逐个人工确认过，列在这里而不是放宽正则——
// 放宽正则会连真正的漏网之鱼一起放过。
const KNOWN_NOISE = new Set([
  "O",                      // 注释 "O(1) 查表"
  "async", "var",           // 箭头函数与声明关键字
  "mutate", "mutator",      // updateCurrentWork / updateRecord 的形参
  "preventDefault",         // .preventDefault() 跨行时前瞻没挡住
  "resolveDailyWallpaper",  // 只出现在注释里（R3 已删除的函数）
  "translateX",             // 模板串里的 CSS transform
  "Work",                   // 中文注释里「Work（可能来自…）」这类写法
  "closest"                 // 注释里反引号引用的 closest("[data-action]")
]);
const undefinedCalls = called.filter((n) => !defined.has(n) && !GLOBALS.has(n) && !KNOWN_NOISE.has(n));
if (undefinedCalls.length) fail(`可能未定义就被调用：${undefinedCalls.join(", ")}`);
else console.log("✓ 没有未定义的函数调用");

// ── 2. import 对得上导出 ─────────────────────────────────────────────────────
for (const [, names, path] of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(\.\/[^"?]+)(?:\?[^"]*)?"/g)) {
  const mod = await import(new URL(path.replace("./", "./src/"), `file://${process.cwd()}/`).href);
  for (const raw of names.split(",").map((n) => n.trim()).filter(Boolean)) {
    const name = raw.split(/\s+as\s+/)[0].trim();
    if (!(name in mod)) fail(`${path} 没有导出 ${name}`);
  }
}
console.log("✓ import / export 对得上");

// ── 3. 事件接线 ──────────────────────────────────────────────────────────────
const emitted = uniq([...grab(/data-action="([a-z-]+)"/g), ...grab(/\baction:\s*"([a-z-]+)"/g)]);
const handled = grab(/action === "([a-z-]+)"/g);
const unwired = emitted.filter((a) => !handled.includes(a));
if (unwired.length) fail(`未接线的 data-action：${unwired.join(", ")}`);
const overlayOrphan = grab(/state\.overlay = "([a-z-]+)"/g).filter((o) => !grab(/state\.overlay === "([a-z-]+)"/g).includes(o));
if (overlayOrphan.length) fail(`设置了但没渲染分支的 overlay：${overlayOrphan.join(", ")}`);
const formOrphan = grab(/<form id="([a-z-]+)"/g).filter((f) => !grab(/event\.target\.id === "([a-z-]+)"/g).includes(f));
if (formOrphan.length) fail(`没有提交处理器的 form：${formOrphan.join(", ")}`);
console.log("✓ 事件接线完整");

// ── 4. API 端点生产 / 本地两侧都在 ──────────────────────────────────────────
const server = readFileSync("server.mjs", "utf8");
for (const path of uniq([...src.matchAll(/["`](\/api\/[a-z/-]+)/g)].map((m) => m[1]))) {
  const hasFn = existsSync(`functions${path}.js`) || path.startsWith("/api/sync");
  const hasDev = server.includes(`"${path}"`) || path.startsWith("/api/sync");
  if (!hasFn || !hasDev) fail(`${path} 生产:${hasFn ? "有" : "缺"} 本地:${hasDev ? "有" : "缺"}`);
}
console.log("✓ API 端点两侧齐全");

// ── 5. 清库入口 ──────────────────────────────────────────────────────────────
const db = readFileSync("src/db.js", "utf8");
const clearFn = db.slice(db.indexOf("export async function clearAllData")).slice(0, 1200);
const resetChecks = [
  ["已移除 ?reset URL 触发", !src.includes('has("reset")')],
  ["偏好设置有入口", src.includes('data-action="open-reset-data"')],
  ["有确认词门槛", src.includes("!== RESET_CONFIRM_PHRASE")],
  ["clearAllData 不走 cloudOp", !clearFn.includes("cloudOp")],
  ["本地无条件清", clearFn.includes("await idb.clear()")],
  ["云端走 /api/sync/clear", clearFn.includes("/api/sync/clear")],
  ["清完重载到干净地址", src.includes("location.replace(location.origin + location.pathname)")]
];
for (const [label, ok] of resetChecks) if (!ok) fail(`reset：${label}`);
console.log("✓ 清库入口符合预期");

// ── 6. 静态资源与版本号 ─────────────────────────────────────────────────────
if (!existsSync("index.html")) fail("index.html 缺失 —— Cloudflare Pages 的 / 会 404");
const html = existsSync("index.html") ? readFileSync("index.html", "utf8") : "";
const sw = readFileSync("sw.js", "utf8");
for (const m of html.matchAll(/(?:href|src)="(\/(?:src|styles|docs|public)\/[^"?]+)(\?v=\d+)?"/g)) {
  if (!existsSync("." + m[1])) fail(`index.html 引用了不存在的 ${m[1]}`);
}
for (const m of sw.matchAll(/"(\/(?:src|styles|docs|public)\/[^"?]+)(\?v=\d+)?"/g)) {
  if (!existsSync("." + m[1])) fail(`sw.js SHELL 引用了不存在的 ${m[1]}`);
  else if (m[2] && html.includes(m[1]) && !html.includes(m[1] + m[2])) {
    fail(`版本号不一致：sw.js SHELL 是 ${m[1]}${m[2]}，index.html 不是`);
  }
}
console.log("✓ 静态资源与版本号一致");

// ── 7. 状态 class 必须真的有 CSS 规则 ───────────────────────────────────────
// 补丁 11 的根因：模板里给候选加了 `selected` class，但 .work-candidate.selected
// 这条规则**从来没写过**，于是"选中了却看不出来"。这类错误语法检查和单元测试
// 都抓不到——模板照常渲染，class 照常加上，只是没有任何视觉效果。
const css = readFileSync("styles/app.css", "utf8");
const STATE_CLASS_PAIRS = [
  ["work-candidate", "selected"],
  ["work-search-item", "selected"],
  ["source-chip", "active"],
  ["collection-entry", "watched"],
  ["collection-entry", "unwatched"],
  ["shelf-chip", "selected"],
  ["shelf-sort", "selected"]
];
for (const [base, state] of STATE_CLASS_PAIRS) {
  // 模板里确实在用这个组合才检查
  const usedInTemplate = new RegExp(`${base}[^"\`]*\\$\\{[^}]*"${state}"`).test(src)
    || new RegExp(`class="[^"]*${base}[^"]*${state}`).test(src);
  if (!usedInTemplate) continue;
  // 中间可能还夹着别的 class（例如 .source-chip.filter.active），两个方向都认
  const hasRule = new RegExp(`\\.${base}[\\w.-]*\\.${state}\\b`).test(css)
    || new RegExp(`\\.${state}[\\w.-]*\\.${base}\\b`).test(css);
  if (!hasRule) fail(`模板用了 .${base}.${state}，但 styles/app.css 里没有对应规则（会"加了 class 却没效果"）`);
}
console.log("✓ 状态 class 都有对应的 CSS 规则");

console.log(problems ? `\n共 ${problems} 处问题` : "\n全部通过");
process.exit(problems ? 1 : 0);
