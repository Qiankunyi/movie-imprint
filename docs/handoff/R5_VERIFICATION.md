# R5 · 回归验收与文档同步

**前置：R1–R4 全部完成。**

**前置阅读：**
1. `docs/RESTRUCTURE_PLAN_R1-R5.md`（尤其第 10 节整体验收条件）
2. `docs/IMPLEMENTATION_STATUS_R1.md` ~ `R4.md`
3. `docs/DEVELOPMENT_HANDOFF_V2.md`

**本窗口不实现新功能。** 只做验证、修复验证中发现的问题、同步文档。

---

## 1. 端到端场景验证

用**合成测试数据**（不使用真实私人感想）走完以下四条完整路径，每条都截图留证：

| # | 场景 | 预期数据结果 |
|---|---|---|
| 1 | ＋ → 粘贴票务 → 确认 → 写感想 → 完成 | Work×1、ViewingEvent(cinema, first, index 1)×1、Record(viewing)×1 |
| 2 | ＋ → 跳过 → 在家 → 同一部作品 → 完成 | Work 复用（仍为 1 个）、ViewingEvent(home, rewatch, index 2)×1、Record(viewing)×1 |
| 3 | 作品页 → ＋补充记录 → 完成 | Work 仍为 1 个、**无新 ViewingEvent**、Record(supplement)×1 |
| 4 | ＋ → 跳过 → 在影院（手填）→ 另一部作品 | Work×1（新）、ViewingEvent(cinema, first, source: manual) |
| 5 | ＋ → 粘贴含舞台挨拶的票务 → 补填特典备注 → 完成 | `format` 与 `event_types` 分流正确、`bonus_note` 已保存、首页卡与作品页各自按规则显示活动徽章 |
| 6 | **另一部作品：先记「在家」→ 再记「影院」** | **在家那次 `first/1`、影院那次 `rewatch/2`**。这条专门验证「影院≠初看」 |
| 7 | **在场景 6 之上，补录一次时间更早的在家观看** | 三个事件整体重排：新补录的成为 `first/1`，原在家变 `rewatch/2`，影院变 `rewatch/3` |
| 8 | **同一部作品累计记满 7 次观看** | `watch_index` 1..7 完整无跳号；首页卡「重看 · 第7次」不撑破布局；作品页履历与评价变迁链完整可横向滚动 |

场景 1–3 完成后检查作品页：履历 2 项、感想 3 项、评价变迁 1 条链。
场景 6–8 是本次调整**最容易写错的地方**：任何「影院＝初看」的隐含假设都会在这三条里暴露。

---

## 2. 迁移验证

在**真实存量数据的副本**上执行：

- [ ] 迁移前 JSON 备份已生成，可完整解析
- [ ] 记录条数：迁移前 = 迁移后
- [ ] 重复 work 已合并，`merged_from` 记录完整
- [ ] 所有 record 的 `work_id` 都能查到对应 work
- [ ] `viewing_relation` / `watch_index` 无空洞、无重复序号
- [ ] 迁移重复执行 3 次，结果一致
- [ ] 用备份 JSON 可以还原到迁移前状态（回滚演练）

---

## 3. 数据完整性检查

写一个一次性检查脚本 `scripts/check-integrity.mjs`（不进生产路径）：

```
- 存在孤儿 record（work_id 查不到 work）→ 报错
- 存在孤儿 viewingEvent（work_id 查不到 work）→ 报错
- 同一 work 下 watch_index 有重复或跳号 → 报错
- 同一 work 下有多个 viewing_relation === "first" → 报错
- viewing_relation 与时间顺序矛盾且未标 relation_locked → 报错（说明重排漏了）
- 源码里出现「location_type 参与 first/rewatch 判定」的痕迹 → 人工复核 `assignViewingRelations`
- record_kind === "supplement" 但 viewing_event_id 非空 → 报错
- record_kind === "viewing" 但 viewing_event_id 为空 → 警告（迁移数据可能有）
- 两个 work 的 normalizeTitle 相同 → 警告（漏合并）
- viewing_context.format 里出现活动关键词（舞台挨拶／応援上映 等）→ 警告（分流漏了）
- bonus_note 非空但 event_types 不含 bonus_distribution → 警告
- event_types 出现未定义的 key → 报错
- 任何 ViewingEvent 里出现邮箱、手机号、取票码模式 → 严重错误
```

---

## 4. 安全回归

- [ ] 票价：正确解析并显示，**可导出**（本次红线变更）
- [ ] 姓名、邮箱、手机号、订单号、取票码、二维码令牌：仍被移除
- [ ] 支付方式、卡号后四位：仍被移除
- [ ] 票务原文：不持久化（检查 IndexedDB 与 D1 均无原文）
- [ ] AI 请求体：不含票价、不含任何票务敏感字段（抓请求体检查）
- [ ] API 密钥、访问密码：不在前端代码、不在导出内容、不在 git 历史
- [ ] 导出的 Markdown / JSON / TXT 三种格式内容完整、无敏感字段

---

## 5. 移动端验收

四种组合截图，每种覆盖 6 个界面（首页 / 场景识别层 / 确认卡 / 书写层 / 书架 / 作品页）：

| 尺寸 | 主题 |
|---|---|
| 412×915 | 浅色 |
| 412×915 | 深色 |
| 360×800 | 浅色 |
| 360×800 | 深色 |

重点检查：

- [ ] 键盘弹出时不遮挡「完成」按钮与当前输入行
- [ ] 履历卡在 360 宽下不换行错乱、制式徽章与活动徽章不溢出
- [ ] 书架网格在两种宽度下都成立
- [ ] **记忆卡片竖向滚动手感自然，卡片边界清晰、不像通用笔记列表**
- [ ] **首页无壁纸残留**（无 scrim、无「今日壁纸」署名、设置无壁纸选项）；**海报正常显示**
- [ ] **无记录时首页是设计过的空状态，不是白屏**
- [ ] 单手可完成主路径

---

## 6. 离线与恢复

- [ ] 断网状态下可完成完整记录流程（Bangumi 匹配失败不阻塞）
- [ ] 断网状态下海报走缓存，书架与作品页无破图（确认 R3 删壁纸时没有误删图片代理）
- [ ] 书写中切后台 / 刷新 / 关闭标签页 → 「继续写」可恢复，`captureContext` 完整
- [ ] 云端同步断开时，本地路径完全可用

---

## 7. 全量测试

```bash
npm test
```

- [ ] 全部通过
- [ ] 无 skip、无 only
- [ ] 测试总数核对：R1 前基线 107 条，**减去 R3 删除的壁纸用例（约 5 条），加上 R1–R4 新增**。R3 报告里应有「删除 N + 新增 M = 净变化」的说明；核对是否吻合，避免把正常删除误判为测试丢失
- [ ] 源码全局搜索 `wallpaper`、`activeCardIndex` 应无残留（文档除外）

---

## 8. 文档同步

需要更新的文件：

| 文件 | 更新内容 |
|---|---|
| `docs/DEVELOPMENT_HANDOFF_V2.md` | 复核三条红线变更是否都已落地（§9 票价、§7 壁纸整节废止、§5 记忆卡片竖向）；§3「六个关键状态」已更新，复核是否与实现一致；§6 的 C4/C5 描述补充 R 阶段成果 |
| `docs/VISUAL_DESIGN_DIRECTION_V1.md` | 壁纸相关方向标注废止（R3 应已改，此处复核） |
| `docs/IMPLEMENTATION_STATUS_C2.md` | 追加说明：壁纸功能已于 R3 移除，作品匹配与 Bangumi 图片接口保留 |
| `docs/DEPLOYMENT_AND_RELEASE_PLAN.md` | 「当前进度」勾选 R1–R5；窗口序列按主方案 §8.2 更新 |
| `docs/FIELD_AND_TAXONOMY_FREEZE_V1.md` | 补入 `work_type`、`ticket_price`、`duration_minutes`、`record_kind`、`viewing_event_id`、`source`、`merged_from`、`event_types`、`bonus_note` 等新字段；活动分类表（11 项）需正式冻结进本文件 |
| `docs/RESTRUCTURE_PLAN_R1-R5.md` | 在文末加「执行结果」章节，记录实际与计划的偏差 |
| `docs/IMPLEMENTATION_STATUS_R5.md` | **新建**：本窗口验收报告 |
| `docs/NEXT_WINDOW_START_PROMPT_V2.md` | 替换为 W6 的启动指令（见下） |

---

## 9. 交付 W6 的启动指令

在 `docs/NEXT_WINDOW_START_PROMPT_W6.md` 写清楚：

- W6 要做 46 个情绪标签（清单在 `FIELD_AND_TAXONOMY_FREEZE_V1.md`）
- 情绪标签挂在 **Record** 上，不是 Work，也不是 ViewingEvent（因为同一部电影不同次观看的情绪可以不同——这正是 R1 重构换来的能力）
- 标签由 AI 建议、用户确认；AI 不得自动写入
- 提醒 W6 窗口：数据模型已在 R1 变更，不要参照 R1 之前的代码假设

---

## 10. 交付清单

1. 四条端到端场景的执行报告 + 截图
2. 迁移验证报告（含回滚演练结果）
3. `scripts/check-integrity.mjs` 输出
4. 安全回归检查表（逐项打勾）
5. 24 张移动端截图（4 组合 × 6 界面）
6. 全量测试结果
7. 已更新的六份文档
8. **未完成事项清单**：验证中发现但不属于 R1–R5 范围的问题，明确记录并归入后续窗口
