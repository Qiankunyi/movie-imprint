# 电影印记：C4 票务粘贴与本地脱敏进度

日期：2026-08-02  
状态：C4 核心实现完成，待浏览器端验证

## 已完成

- `src/ticket.js`：C4 核心模块，纯客户端，不依赖任何外部服务
  - `redactSensitiveInfo`：本地脱敏，按顺序移除 QR URL、邮箱、手机号、订单号、票价、姓名称呼、会员登录 URL；脱敏发生在解析之前
  - `splitEmails`：多邮件边界检测，优先按标准邮件头（From:/Subject:）拆分，其次按分隔线，最后按 SMT 固有发件方标识重复出现拆分
  - `extractFormatAndTitle`：移除片名中的 `【制式】` 前缀，单独保存制式字段；前篇／后篇等区分词不被系列名吞掉
  - `parseScreeningSegment`：从脱敏后的单段邮件提取片名、观影日期、开始/结束时间（支持同行区间 `HH:MM～HH:MM` 和独立 `開映時間`/`終映時間` 两种格式）、影院名（精确匹配 `劇場：` 标签，避免误匹配 `劇場版`/`シアターズ`）、城市（从影院名推断）、放映制式、座位（数组）、票务提供商
  - `parseTicketText`：主入口，拆分 → 脱敏 → 逐段解析 → 按放映时间升序排列，`rawTicketTextSaved: false` 始终为假
  - `draftViewingEvent`：从解析结果生成 ViewingEvent 草稿，`location_type: "cinema"`，`viewing_relation: null`（不擅自设定首看/重看）

- `src/db.js`：IndexedDB 从 v2 升级至 v3，新增 `viewingEvents` store
  - `db.putViewingEvents(events)`：批量写入场次
  - `db.getViewingEventsByWork(workId)`：按作品 ID 查询全部场次

- `src/app.js`：票务粘贴入口与确认 UI
  - 编辑器工具栏票务按钮启用；确认了场次后显示数字角标
  - `ticketPasteOverlay()`：两阶段界面——粘贴输入 → 场次确认卡片
  - 操作链：`open-ticket-paste` → `parse-ticket` → `confirm-all-tickets` → `close-ticket-overlay` 返回编辑器
  - `state.ticketParseResult` 保存解析结果；`state.pendingViewingEvents` 保存用户确认的场次
  - 隐私提示始终可见："姓名、邮箱、QR 取票码已本地移除，原始邮件不保存"

- `styles/app.css`：票务 UI 的样式（`.ticket-sheet`、`.ticket-card`、`.ticket-badge` 等）

## 已验证

- 39 条票务专项单元测试全部通过（新增，加入 `tests/ticket.test.mjs`）
  - 脱敏：QR URL、邮箱、姓名称呼、票价移除；片名与影院名保留
  - 拆分：单封返回 1 段；SMT 双封拆分为 2 段
  - 制式前缀：`【DolbyCinema】` 移除，前篇/后篇保留，前后篇片名不同
  - 单封解析：片名、日期、开始/结束时间含 +09:00 时区、影院名含 MOVIX、制式含 Dolby、座位 K-11/K-12、提供商 SMT
  - 双封解析：2 场、按时间排序（前篇在前）、不合并、座位分属 K 行和 J 行
  - ViewingEvent 工厂：ID 前缀、work_id 关联、状态待确认、full_movie、viewing_relation 为 null、座位数 2
- 原有 40 条测试（C1–C3）继续通过，共 79/79 通过

## 安全执行保证

| 保证 | 实现方式 |
|---|---|
| 脱敏先于解析 | `redactSensitiveInfo` 在 `parseScreeningSegment` 之前调用 |
| 票务原文不保存 | `rawTicketTextSaved: false`；overlay 关闭时文本不写入 DB |
| 敏感字段不进入 AI | C4 解析路径与 AI 接口完全独立；只有非敏感 `screenings` 字段写入 IndexedDB |
| 多邮件不错误合并 | 拆分在解析之前；相同日期、影院、制式不构成合并理由 |
| 前篇/后篇不被归一化 | `extractFormatAndTitle` 只移除 `【...】` 前缀，不触碰片名内容 |

## C4 待完成（下一阶段或 Android 验收）

1. 浏览器端验证票务 UI 流程（粘贴 → 解析 → 确认 → 返回编辑器）
2. 场次与感想记录的关联：`finishCompose` 中将 `pendingViewingEvents` 的 `work_id` 更新为正式 Work ID
3. 详情页显示已关联场次（影院名、日期、制式、座位）
4. 多个票务提供商模板（当前主要支持 SMT；TOHO/AEON 框架已留）
5. 用户逐项检查（当前只有"确认全部"，逐项编辑属于 C5）

## C4 不属于遗漏的排期项

- 票务原文粘贴后 AI 辅助补充非敏感字段（仅在模板解析失败时）：属于 C4 后期或 C5
- 多场次详情编辑（关联场次、删除场次）：C5
- 影院特别放映的集数范围字段填写：C5
