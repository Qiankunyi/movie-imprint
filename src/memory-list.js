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

function evidenceLabel(item) {
  if (item.source_type === "self_interview") return `自我采访 · ${item.question_id || "回答"}`;
  if (item.source_type === "free_reflection") return "原始感想";
  return "旧版原文依据";
}

function memoryCardMarkup(card, { icon, mode = "formal", index = 0, count = 1, currentSourceRevisionIds = null } = {}) {
  const isDraft = mode === "draft";
  const isAiSuggestion = isDraft || card.provenance === "ai_suggested";
  const id = card.card_id || card.temporary_id;
  return `<article class="memory-card ${card.is_core ? "core" : ""}" role="listitem" data-testid="memory-card">
    <div class="memory-card-top"><span>${escapeHtml(card.type || "自动判断")}${isDraft ? " · AI 草稿" : card.origin === "user_created" ? " · 我添加的" : card.user_modified ? " · 已修改" : ""}</span><button class="text-action" type="button" data-action="edit-card" data-card-id="${escapeHtml(id)}" data-card-source="${isDraft ? "draft" : "formal"}">${typeof icon === "function" ? icon("edit") : ""}编辑</button></div>
    <h3>${escapeHtml(card.title || "没有标题")}</h3>
    <p>${escapeHtml(card.content)}</p>
    ${card.why_it_matters ? `<p class="memory-why"><b>为什么想留下</b>${escapeHtml(card.why_it_matters)}</p>` : ""}
    ${card.evidence?.length ? `<details class="evidence-details"><summary>查看原文依据</summary>${card.evidence.map((item) => {
      const isHistorical = item.source_revision_id && Array.isArray(currentSourceRevisionIds) && !currentSourceRevisionIds.includes(item.source_revision_id);
      return `<div class="evidence-item"><small>${escapeHtml(evidenceLabel(item))}${item.source_revision_id ? ` · ${isHistorical ? "历史来源版本" : "来源版本"}` : ""}</small><blockquote>${escapeHtml(item.excerpt)}</blockquote></div>`;
    }).join("")}</details>` : ""}
    ${isDraft ? `<div class="suggestion-actions"><button type="button" data-action="accept-draft-card" data-card-id="${escapeHtml(id)}">加入正式记录</button><button type="button" data-action="remove-draft-card" data-card-id="${escapeHtml(id)}">删除建议</button></div>` : isAiSuggestion ? `<div class="suggestion-actions"><button type="button" data-action="accept-ai-card" data-card-id="${escapeHtml(id)}">保留这张</button><button type="button" data-action="remove-ai-card" data-card-id="${escapeHtml(id)}">删除建议</button></div>` : `<div class="memory-card-controls"><button type="button" data-action="toggle-core-card" data-card-id="${escapeHtml(id)}">${card.is_core ? "取消核心" : "设为核心"}</button><button type="button" data-action="move-card" data-card-id="${escapeHtml(id)}" data-direction="up" ${index === 0 ? "disabled" : ""} aria-label="上移">↑</button><button type="button" data-action="move-card" data-card-id="${escapeHtml(id)}" data-direction="down" ${index === count - 1 ? "disabled" : ""} aria-label="下移">↓</button></div>`}
  </article>`;
}

/**
 * @param {object[]} cards
 * @param {{icon?: (name: string) => string}} [options]
 */
export function memoryListMarkup(cards, options = {}) {
  const list = Array.isArray(cards) ? cards : [];
  if (!list.length) {
    if (options.mode === "draft") return `<div class="memory-empty"><p>这次没有内容达到卡片化门槛。原始资料仍已完整保留。</p></div>`;
    return `<div class="memory-empty"><p>还没有记忆卡片。</p><button class="text-action" type="button" data-action="add-card">＋ 添加第一条</button></div>`;
  }
  return `<div class="memory-list" role="list" aria-label="记忆卡片，共 ${list.length} 张" data-testid="memory-list">
    ${list.map((card, index) => memoryCardMarkup(card, { ...options, index, count: list.length })).join("")}
  </div>`;
}
