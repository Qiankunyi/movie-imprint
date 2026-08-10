# 标签索引 V1 · Implementation Report

## 1. 修改文件

- 新增 `src/tags.js`：标签实体、统一关联、检索、去重、合并、排序与统计。
- 新增 `src/tag-i18n.js`：标签功能的简中、繁中、英文、日文文案。
- 新增 `functions/api/bangumi/persons.js`：读取条目人物并只返回导演。
- 新增 `tests/tags.test.mjs`：标签核心语义、Bangumi 导演与多语言测试。
- 修改 `src/app.js`、`styles/app.css`：一级入口、索引页、详情页、作品页标签编辑与管理。
- 修改 `src/db.js`、同步 Functions、`repair.html`：增加标签存储并接入本地/云端数据生命周期。
- 修改 `src/bangumi.js`、`server.mjs`：人物响应规范化及本地开发端点。
- 修改 `src/export.js`：全量 JSON 备份包含标签实体与关联。
- 修改 `index.html`、`sw.js`：更新静态资源版本与离线缓存。

## 2. 数据结构变化

IndexedDB 版本从 5 升为 6，新增两个 store：

- `tags`：保存稳定内部 ID、source、category、四语 names、aliases、external_refs、隐藏/固定状态。
- `tagAssignments`：保存 `tag_id + target_type(work|viewing) + target_id` 的统一关联。

用户标签按规范化名称复用；结构化导演标签优先按 `bangumi_person_id` 复用。旧 `record.tags` 保留兼容，首次加载时会迁移为 viewing 关联；旧式正文首个 `#片名` 不会被误迁移成标签。

取消关联只删除一条 assignment；删除标签会删除实体及全部 assignment；作品合并会迁移作品标签；删除记录/作品会清理对应关联和失去关联的用户空标签。

## 3. Bangumi 导演标签

作品拥有 Bangumi external ref 后，请求 `/v0/subjects/{subject_id}/persons`，仅保留关系为“导演 / 監督 / director”的人物。内部标签通过 person ID 去重，并把 `name_cn`、原名及可获得的拉丁字母别名放入多语言名称/别名结构。

新绑定、已有作品补充外部来源、刷新资料，以及启动后的历史数据补全都会触发导演关联。外部请求失败不会阻断作品保存，也不会反向删除已有标签关系。

## 4. i18n

标签 UI 文案提供 `zh-Hans`、`zh-Hant`、`en`、`ja` 四套映射。结构化标签按当前 locale 选择名称并按既定顺序 fallback；用户自定义标签始终显示用户原文，不自动翻译。

## 5. 测试结果

- 全量单元测试：525/525 通过。
- 覆盖：名称与 person ID 去重、四语显示、别名搜索、work/viewing 隔离、正文同步、删除与取消关联、手动合并、态度分组、最近观看/上映年代排序、全量导出。
- 浏览器视觉检查：412×915 手机竖屏、1280×800 桌面；light/dark 均通过，无横向溢出、无控制台错误。
- 交互检查：侧边栏入口、索引搜索、标签详情、标签到观影记录导航、作品页标签编辑面板均可用。

## 6. 已知限制

- 项目原有界面尚无全站 i18n 框架，本次只为标签功能建立独立四语层；全站语言切换 UI 仍需后续统一。
- Bangumi 关联人物响应通常可靠提供原名与简中名；英文名只有上游返回拉丁字母别名时才能直接显示，否则按 fallback 显示。
- V1 不做 AI 标签建议、TMDB 人物标签、复杂 category 推断、标签交叉筛选与人物百科信息。

## 7. P1 建议

1. 建立全站统一 locale 设置并迁移现有硬编码文案。
2. 为结构化人物补充按需人物详情抓取，完善英文别名与更多可靠别名来源。
3. 增加轻量的“同时加入作品标签”操作，但保持 viewing 标签默认不升级。
4. 在真实使用数据足够后再评估主题、心情、地点等 category 与标签交叉探索。
