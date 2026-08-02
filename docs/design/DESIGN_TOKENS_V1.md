# 电影印记：Design Tokens v1

> **已由用户反馈后的 [Design Tokens v2](DESIGN_TOKENS_V2.md) 覆盖。** v1 仅保留用于对照，不应继续作为新样张或前端实现依据。

- 状态：阶段 B 视觉基线
- 基准：412×915 Android 竖屏；同时检查 360×800
- 方向：2023 Chrome Material You 的克制蓝灰 + 当前 Material Design 3
- 禁止：baseline 紫色、紫色渐变、玻璃拟态、霓虹、通用 AI SaaS 模板

## 使用原则

1. 蓝色只用于主操作、选中状态、焦点和关键链接；一屏通常只有一个高强调动作。
2. 页面层级主要依靠 surface、留白、细边界和排版，不依赖重阴影。
3. 原始感想正文固定使用 16/25，不能为了塞入更多内容缩小。
4. 状态必须同时使用图标／形状／文字与颜色中的至少两项。
5. `primary` 不是装饰色；大面积背景使用 surface 系列。
6. 深色不是反转浅色，而是独立的 surface 层级与对比度组合。

## 色彩

| 角色 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| primary | `#0B57D0` | `#A8C7FA` | 主操作、选中、焦点 |
| on-primary | `#FFFFFF` | `#062E6F` | primary 上内容 |
| primary-container | `#D3E3FD` | `#0842A0` | 低强调选中容器 |
| on-primary-container | `#041E49` | `#D3E3FD` | 容器上内容 |
| surface | `#F8FAFD` | `#111318` | 页面背景 |
| surface-low | `#F1F4F8` | `#191C20` | 输入区、轻分组 |
| surface-container | `#E9EEF6` | `#202328` | 卡片、底栏、面板 |
| surface-high | `#DEE5EF` | `#2A2D32` | 高层内容 |
| on-surface | `#1F1F1F` | `#E3E3E3` | 主文字 |
| on-surface-variant | `#444746` | `#C4C7C5` | 次要文字 |
| outline | `#747775` | `#8E918F` | 必要边界 |
| outline-variant | `#C4C7C5` | `#444746` | 弱分隔 |
| success | `#146C2E` | `#89D89D` | 已保存、已同步 |
| warning | `#755A00` | `#E8C547` | 注意、待检查 |
| error | `#B3261E` | `#FFB4AB` | 错误、危险 |

完整机器可读值见 `tokens.css`。未定义任何紫色角色和装饰渐变。

## 字体

字体栈：`Roboto, "Noto Sans SC", "Noto Sans JP", system-ui, sans-serif`。

| token | 字号/行高 | 字重 | 用途 |
|---|---|---|---|
| title-large | 22/29 | 600 | 页面标题 |
| title-medium | 18/25 | 600 | 区块标题 |
| body-large | 16/25 | 400 | 原文与长内容 |
| body-medium | 14/21 | 400 | 说明与元数据 |
| label-large | 14/20 | 600 | 按钮、chip |
| label-small | 12/18 | 500 | 最低层说明 |

## 间距与尺寸

- 基础网格：8dp；允许 4dp 微调。
- 页面水平边距：16dp；紧凑小屏仍保持 16dp。
- 区块间距：24–32dp。
- 触控目标：最小 48×48dp。
- 顶部 app bar：64dp 内容高度，另加系统状态栏 inset。
- 底部操作区：最小 88dp，另加手势区 inset。

## 形状

- 输入框／普通内容块：12px。
- 可独立操作的卡片／底部面板：16px。
- 主按钮：20px；高度 56px。
- chip：全圆角；高度至少 40px，外部触控区达到 48px。
- 图标按钮：12px 或圆形，触控区 48px。

## 阴影与层级

- 默认内容块无阴影。
- 底部粘性操作区使用一条弱分隔线，不使用漂浮玻璃效果。
- 只有 bottom sheet/dialog 使用 `shadow-2`；普通卡片最多使用 `shadow-1`。
- 所有 surface 均为实色，无透明模糊和渐变。

## 状态

- hover（桌面增强）：颜色轻微变深/变浅；手机不依赖 hover。
- pressed：叠加 10% on-surface state layer，并保持文字可读。
- focus-visible：3px primary focus ring + 2px surface offset。
- selected：primary-container + 2px primary 边界 + check 图标/明确文字。
- disabled：38% 内容透明度、12% 容器透明度，同时禁止点击。
- success/error/offline：图标 + 状态文案 + 语义色容器，绝不只改颜色。

## 动效

- 快速反馈：150ms；常规层级：200ms；面板：250ms。
- easing：标准 `cubic-bezier(.2, 0, 0, 1)`。
- 遵循 `prefers-reduced-motion`；关闭非必要位移和缩放。

## 样张内容约定

- 不使用海报占位图、评分、排行榜或 AI 形象。
- AI 只以“AI 倾向／查看依据／等待确认”出现。
- 样张覆盖中文／日文长标题、正常、选中、警告、错误和离线状态。
- 六个页面均制作浅色与深色；首页、新建电影、确认工作台另外作为深色重点审查页。
