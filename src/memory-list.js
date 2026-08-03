/**
 * R3 · 记忆卡片竖向连续流动。
 *
 * 废止横向分页/轮播（DEVELOPMENT_HANDOFF_V2.md §5、§3 的旧规则）：
 * 全部卡片一次渲染，竖向排列，role="list"/"listitem"，不做 scroll-snap，自由滚动。
 * 单张卡片内部结构（编辑按钮、证据折叠、AI 建议保留/删除按钮）与之前完全一致。
 *
 * R3 补丁 1（用户反馈第二轮）：非 AI 建议卡片的删除入口不放在卡片上（和首页记录卡的
 * 删除一样，走"编辑"这个二级入口，而不是在卡片正面摆一个显眼的删除按钮）——具体做法
 * 见 src/app.js 的 cardEditorOverlay()：编辑界面右下角"保存修改"，左下角"删除"。
 *
 * 纯渲染函数：icon 参数是可选注入的 SVG 图标渲染器（app.js 的 icon()），
 * 不传时编辑按钮不带图标，方便在 Node 测试里直接断言字符串。
 */

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function memoryCardMarkup(card, { icon } = {}) {
  const isAiSuggestion = card.provenance === "ai_suggested";
  return `<article class="memory-card ${card.is_core ? "core" : ""}" role="listitem" data-testid="memory-card">
    <div class="memory-card-top"><span>${escapeHtml(card.type)}${isAiSuggestion ? " · 整理建议" : card.provenance === "user_accepted" ? " · 已保留" : ""}</span><button class="text-action" type="button" data-action="edit-card" data-card-id="${escapeHtml(card.card_id)}">${typeof icon === "function" ? icon("edit") : ""}编辑</button></div>
    <h3>${escapeHtml(card.title || "没有标题")}</h3>
    <p>${escapeHtml(card.content)}</p>
    ${card.evidence?.length ? `<details class="evidence-details"><summary>查看原文依据</summary>${card.evidence.map((item) => `<blockquote>${escapeHtml(item.excerpt)}</blockquote>`).join("")}</details>` : ""}
    ${isAiSuggestion ? `<div class="suggestion-actions"><button type="button" data-action="accept-ai-card" data-card-id="${escapeHtml(card.card_id)}">保留这张</button><button type="button" data-action="remove-ai-card" data-card-id="${escapeHtml(card.card_id)}">删除建议</button></div>` : ""}
  </article>`;
}

/**
 * @param {object[]} cards
 * @param {{icon?: (name: string) => string}} [options]
 */
export function memoryListMarkup(cards, options = {}) {
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) {
    return `<div class="memory-empty"><p>还没有记忆卡片。</p><button class="text-action" type="button" data-action="add-card">＋ 添加第一张</button></div>`;
  }
  return `<div class="memory-list" role="list" aria-label="记忆卡片，共 ${list.length} 张" data-testid="memory-list">
    ${list.map((card) => memoryCardMarkup(card, options)).join("")}
  </div>`;
}
