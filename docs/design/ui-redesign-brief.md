# Résumé Studio 界面重构设计简报

> 用途：把当前真实实现的结构、约束与改造方向一次性交代清楚，交给设计工具产出可落地的高保真效果图。
> 版本：2026-09-11，对应代码 `main` 上编辑器与助手面板的现状。
> 写法约定：第 5 节是**现状**（照着代码写的，不要当成建议），第 8 节是**改造方向**（要设计的东西）。两节不要混看。

## 如何使用这份文档

给设计工具的提示可以这样说：

> 这是一款 AI 简历编辑器的现有界面结构说明与改造需求。请按第 8 节的改造方向，重新设计第 5 节列出的屏幕。遵守第 9 节的硬约束（技术栈、令牌、字体、图标、断点），文案用第 5 节与附录 A 里的原文，不要改写措辞。交付物按第 10 节。

设计时请特别注意：

- 这是一个**生产工具**，不是落地页。信息密度是特性，不是缺点。
- 界面的主体是**一份文档**（简历），不是卡片流。所有装饰要让位于内容可读性。
- 唯一的差异化交互是**AI 提议 → 用户逐条接受**。这一段是设计重点，不是聊天窗口的附属品。

---

## 1. 产品与用户

Résumé Studio 是一款 AI 简历编辑器。用户手里有一份结构化简历（JSON，不是富文本），在左侧表单里编辑，右侧实时看 PDF 成品，需要改进时把 AI 助手叫出来提建议。

目标用户：正在找工作、需要针对不同岗位反复改简历的人。使用场景往往是连续 30 到 90 分钟的高强度编辑，期间会反复在「改文字」和「看排版」之间来回。

核心约束（决定了界面形态）：

- 简历是**结构化文档**，每个节点有 id，可以精确定位到某一句话。
- AI **从不直接改简历**，它只产出「补丁」（patch），由用户接受或拒绝，接受后落成一个不可变版本。
- 排版结果是**真实 PDF**（react-pdf 渲染），不是 HTML 模拟，所见即最终导出物。

## 2. 核心交互模型

四步循环，整个界面都围绕它：

1. 用户在表单里改字，右侧预览在 300ms 防抖后重新渲染。
2. 用户选中某个字段或某条经历（`selectedNodeId`），这决定了 AI 的作用域。
3. 用户在助手面板发消息或点一个「技能」（如 Impact bullets、Match a posting），AI 返回若干条建议。
4. 每条建议以卡片呈现，显示改动前后的差异。用户逐条 Accept / Dismiss，或一次 Accept all（结构性改动除外）。接受后简历落为新版本。

无人操作时的状态也要设计：自动保存中、已保存、冲突、保存失败重试。

## 3. 信息架构

```text
/                        → 重定向到 /dashboard
/login                   → 登录
/dashboard               → 简历列表
/r/:resumeId/edit        → 主编辑屏（本文档重点）
/r/:resumeId/edit?view=versions  → 同一屏，中列换成版本历史
/r/:resumeId/export      → 导出
/r/:resumeId/interview   → 面试准备（目前是静态演示内容）
/r/:resumeId/history     → 重定向到 edit?view=versions
```

所有 `/r/:resumeId/*` 屏幕共享同一层：`ResumeSessionProvider` + `PreviewProvider`，所以在这三个屏之间切换时，编辑状态与已渲染的 PDF 都不重建。

## 4. 当前视觉语言

### 4.1 颜色

令牌定义在 `packages/ui/src/styles/globals.css`，用 oklch 书写。浅色值：

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--canvas` | `oklch(0.985 0 0)` | 最外层背景、右列面板底 |
| `--paper` | `oklch(1 0 0)` | 「纸」：顶栏、表单列、卡片、PDF 页 |
| `--ink` | `oklch(0.205 0 0)` | 最深文字、深色胶囊的底 |
| `--foreground` | `oklch(0.145 0 0)` | 正文 |
| `--muted-foreground` | `oklch(0.556 0 0)` | 次要文字（全站用了 102 次，是最主要的降噪手段） |
| `--border` | `oklch(0.922 0 0)` | 1px 描边（用了 39 次） |
| `--muted` | `oklch(0.97 0 0)` | hover 底、内嵌块底 |
| `--primary` | `oklch(0.5 0.134 242.749)` | 蓝色，主操作与选中 |
| `--primary-strong` | `oklch(0.443 0.11 240.79)` | 选中态文字 |
| `--primary-deep` | `oklch(0.35 0.09 242)` | 侧栏选中文字 |
| `--ok` | 同 `--primary` | 「已保存」的对勾（蓝，不是绿） |
| `--flag` / `--flag-foreground` | `oklch(0.72 0.15 70)` / `oklch(0.5 0.13 65)` | 琥珀色，标记「这条还能更好」 |
| `--destructive` | `oklch(0.577 0.245 27.325)` | 删除、校验错误 |

面板背景只有两种，这是当前分层的全部手段：`bg-paper` 白（导航、表单、卡片）与 `bg-canvas` 近白（外围、右列）。

强调色只用透明度副调，只有三档：`/6`、`/8`、`/9`（选中底），加上 `bg-flag/15`、`bg-flag/14`（角标）。

已定义 `.dark` 全套令牌，但**代码里没有任何主题切换或系统偏好判断**。当前只有浅色会被渲染。

一处刻意的例外：登录页的 Google 按钮用了品牌硬编码色 `#747775` / `#fff` / `#1f1f1f`。

### 4.2 字体与字号

- `--font-sans` = Figtree Variable（UI 正文）
- `--font-heading` = Inter Variable（标题、卡片标题、按钮、模式标签）
  注意这个命名是反的：`font-heading` 用的是 Inter。
- 字号全部为硬编码像素值，没有阶梯变量。实际使用频次（高到低）：
  `12.5px`(34) `12px`(26) `11px`(26) `11.5px`(22) `10.5px`(19) `10px`(12) `13.5px`(6) `13px`(4) `19px`(4) `14.5px` `17px` `20px` `14px`
- 语义映射：屏幕标题 19px，面板标题 17px，卡片标题 13.5px，正文与输入 12.5px，次要说明 11.5px 至 12px，元信息与角标 10px 至 10.5px，全大写分组标签 10px 加 `tracking-[0.07em]` 与 `uppercase`。
- 行高常用 `leading-[1.45]` / `[1.5]` / `[1.55]`；标题字距为负（`-0.01em` 至 `-0.015em`）。
- 字重：`font-semibold`(39) 最多，其次 `font-heading`(17)、`font-medium`(15)、`font-bold`(10)。

### 4.3 圆角、间距、描边、阴影

- 圆角四档混用：5px（角标、数字徽章）、7px（导航项、输入框、图标按钮）、9px（侧栏卡片、面板、虚线占位）、10px（大卡片、消息气泡、版本行）。另有 `rounded-full` 用于模式胶囊、技能胶囊、字号胶囊。
- 间距：以 4 的倍数为主，但存在 `gap-[9px]`、`gap-[7px]`、`mt-[3px]`、`px-[26px]`、`pt-[22px]`、`pb-[76px]`、`pb-[110px]` 这类任意值。
- 描边：几乎全部是 1px `border-border`；虚线描边（`border-dashed`，用了 12 次）专门表示「这里可以新增」。
- 阴影只有三处：PDF 页 `0 10px 30px -18px oklch(0.145 0 0 / 30%)`、flag 小圆点的 1.5px 纸色描边环、一处分隔条上的 `shadow-sm`。整体是「无阴影、靠描边分层」的克制路线。
- 动效只有两个 keyframes：`preview-scan`（渲染中的不定进度条）、`soft-pulse`（助手建议卡上的小圆点）。其余是 `transition-colors`。

### 4.4 图标与交互基元

- 图标库：`@phosphor-icons/react`，尺寸 `size-3` 至 `size-5`，线宽默认，少数用 `weight="bold"` / `"fill"`。
- 开关是真正的 `Switch` 组件，用 `label htmlFor` 关联，整行是命中区。
- 面板可拖拽（react-resizable-panels 封装），拖拽结果写入 localStorage。
- 唯一的键盘绑定：`Cmd/Ctrl+Z` 撤销，`Shift+Cmd/Ctrl+Z` 重做，`Esc` 清除选中节点。没有命令面板。

### 4.5 可用的基础组件

`packages/ui/src/components/` 已封装（shadcn on Base UI，非 Radix）：
alert-dialog、avatar、badge、button、calendar、card、checkbox、collapsible、dialog、dropdown-menu、empty、field、input-group、input、item、kbd、label、popover、progress、resizable、scroll-area、select、separator、skeleton、sonner、spinner、switch、textarea、tooltip。

设计可以自由使用上述任意组件，不必新增依赖。

---

## 5. 当前屏幕结构

### 5.1 全局壳

根布局是全屏固定高度（`h-svh`，无页面滚动），内部再分块滚动。

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ [R] Résumé Studio            ( Editor │ Export │ Interview )        [ avatar ] │ 56px, bg-paper
├──────────────────┬────────────────────────────────────────────────────────────┤
│ MY RESUMES   12  │                                                            │
│ ┌──────────────┐ │                                                            │
│ │ resume card  │ │                     <Outlet />                             │
│ └──────────────┘ │                                                            │
│ ┌──────────────┐ │                                                            │
│ │ resume card  │ │                                                            │
│ └──────────────┘ │                                                            │
│ ┌ ─ ─ ─ ─ ─ ─ ┐  │                                                            │
│    + Create new  │                                                            │
│ └ ─ ─ ─ ─ ─ ─ ┘  │                                                            │
│ 252px, bg-canvas │                        剩余宽度, bg-canvas                 │
└──────────────────┴────────────────────────────────────────────────────────────┘
```

**顶栏（56px，`bg-paper`，底部 1px 描边）**：左侧是 26×26 的圆角方块 logo（底色 primary，白字 `R`）加产品名（14.5px，Inter，semibold）；中间偏右是模式切换；右侧是用户头像菜单。左内边距 18px。

**模式切换**：一个 `rounded-full bg-paper p-1` 的胶囊容器，里面三个 30px 高的胶囊按钮（Editor / Export / Interview），12.5px semibold。选中项是 primary 实底加白字，未选中是灰字加 hover 底。只有打开某份简历时出现。

**简历导航栏（`ResumeRail`，252px，`bg-canvas`，右侧 1px 描边）**：顶部是 `MY RESUMES` 全大写小标签加一个数量角标；下面是可滚动的卡片列表，每张卡有彩色缩略图（按模板主题色）、标题（12.5px Inter semibold）、副标题（11px 灰）、时间元信息（10.5px 灰）；hover 时右上角浮出一个 20×20 的 `⋯` 菜单（Rename / Duplicate / Tailor for a job / Delete）。列表末尾是虚线描边的 `Create new` 卡片。加载时是三张 76px 高的骨架卡。

### 5.2 Dashboard

居中单列，最大宽 880px，左右内边距 26px，底部留白 110px。

```text
        My resumes                                             19px Inter semibold
        One document per role you are chasing...                12.5px muted

┌──────────────┐ ┌──────────────┐ ┌ ─ ─ ─ ─ ─ ─ ─ ┐
│  ▨ thumb     │ │  ▨ thumb     │    +  Create a
│  Senior PM   │ │  Growth Eng  │      new resume
│  2 days ago  │ │  yesterday   │    (dashed, 104px tall)
└──────────────┘ └──────────────┘ └ ─ ─ ─ ─ ─ ─ ─ ┘
自适列网格，每格最小 240px，卡片 bg-paper

┌───────────────────────────────────────────────┐
│ GETTING STARTED        10.5px 全大写           │
│ 1. Open a resume and fill in Contact...        │
│ 2. Watch the live preview...                   │
│ 3. Turn on the Assistant panel...              │
│ 4. Export a PDF once Preflight is clean.       │
│ [ Start a resume ]                             │
└───────────────────────────────────────────────┘
```

### 5.3 主编辑屏（`/r/:resumeId/edit`）

三栏，全部可拖拽，拖拽位置与面板开关状态写入 localStorage。

```text
┌──────────────┬──────────────────────────────────┬────────────────────────────┐
│ SECTIONS     │ Contact            ✓Saved ⟲ ⟳ ⛭ │ Live preview 1 page  − 100%+  │ 44px
│              │ Senior Product Designer · 12 r.  │                            │
│ Contact      │ What you do, at what scale...    │  ┌──────────────────────┐  │
│ Summary      │ ──────────────────────────────   │  │                      │  │
│ Experience 3 │                                  │  │      PDF page        │  │
│ Education    │ FULL NAME                        │  │      (420px base)    │  │
│ Projects     │ [____________________________]   │  │                      │  │
│ Skills  2    │                                  │  │                      │  │
│              │ HEADLINE                         │  └──────────────────────┘  │
│ + Add section│ [____________________________]   │                            │
│ ──────────   │                                  │  ┌──────────────────────┐  │
│ SIDE PANELS  │ LINKS                            │  │  Assistant           │  │
│ Preview  (o) │ [Label____] [https://____]  🗑   │  │  ┌────────────────┐  │  │
│ Assistant(o) │ + Add link                       │  │  │ user bubble    │  │  │
│ Versions     │                                  │  │  └────────────────┘  │  │
│              │                                  │  │  ┌────────────────┐  │  │
│ 200px        │        表单列, bg-paper          │  │  │ suggestion card│  │  │
│ collapsed:   │        min 300px                 │  │  └────────────────┘  │  │
│ 50px 首字母  │        px-24 pt-22 pb-76         │  │  [ skill chips ]     │  │
│              │                                  │  │  [ Ask about ...  ↑ ]│  │
└──────────────┴──────────────────────────────────┴────────────────────────────┘
                                                   右列 bg-canvas, 默认 520/400px, min 360/320px
                                                   两个面板都在时上下分栏 60/40
```

**左栏（`SectionRail`，200px，`bg-paper`）**：顶部 `SECTIONS` 标签；下面是导航项，每项 34px 高、7px 圆角、12.5px 字号，激活项是 `bg-primary/9` 加 `text-primary-deep` semibold。有问题的 section 右侧带一个琥珀角标显示条数（如 `Experience 3`），折叠态（宽度小于 980px，栏宽缩到 50px）时角标变成一个贴在小圆点上的 6px 琥珀点，并改用 tooltip。导航项下面是一个虚线描边的 `+ Add section` 按钮（32px 高），再往下是分隔线、`SIDE PANELS` 标签、两个开关行（Preview 与 Assistant，图标加文字加开关，整行可点）、以及一个常驻按钮 `Versions`。

**中列**：可滚动容器，内边距 `24px 22px 76px`。顶部是 `PaneHeader`：左侧是栏目标题（17px Inter semibold）加一条右对齐的元信息（11.5px 灰，如 `12 roles`），右侧是操作区，也就是保存状态条。标题下面是一行 12.5px 的灰色提示语。

保存状态条的内容依次是：状态文字加图标（`Saving` 转圈 / `Saved` 蓝色对勾 / `Retrying` 琥珀警告 / `Conflict` 琥珀警告 / `Fix errors to save`）、撤销按钮、重做按钮、`Save version` 按钮。当简历有校验错误时，状态显示为 `Fix errors to save` 且自动保存暂停。

表单字段（Contact / Summary / 各 section）统一样式：标签在上（11px medium 灰色），输入框在下（12.5px，1px 描边，7px 圆角），错误信息在下方（destructive 色）。输入框没有本地状态，每次击键直接写进文档。

`ItemCard`（一条经历 / 一段教育 / 一个项目）是折叠卡：头部一行显示标题（13.5px Inter semibold）、副标题（12px 灰）、可选的琥珀角标、删除图标按钮（hover 才显红）、展开箭头；展开后主体是 2 列网格表单，顶部有一条分隔线。

**右列**：`bg-canvas`。预览面板与助手面板上下排列（都在时 60/40，可拖拽），各自也能「最大化」占满中列加右列的全部宽度。

预览面板：44px 工具栏，左侧 `Live preview` 标签加可点击的纸张尺寸（Two-column / Single-column）、页数角标（如 `1 page`）；右侧是缩放控件（减号、百分比数字、加号，范围 50% 到 150%，五档）、模板选择按钮（显示当前模板名，如 `Lisbon` 加下拉箭头）、最大化、关闭。渲染中时工具栏顶端有一条 2px 的不定进度条在扫。工具栏下方是可滚动区域，居中摆放 PDF 页面，页面有 3px 圆角、1px 描边、一层柔和阴影。点开模板按钮会在工具栏下方展开一块 `bg-canvas` 区域：`SWITCH TEMPLATE` 小标签加六张模板缩略图（自适列网格，每格最小 84px，选中项 primary 描边加淡蓝底），下面一行 `Text size` 加三个胶囊（S / M / L，选中项是深墨实底）。

助手面板：44px 标题栏，左侧一个 6px 的圆点加 `Assistant` 字样；旁边显示当前作用域，选中了节点时是一个可关闭的胶囊（如 `Experience > Acme > bullet 2`），没选中时是一行灰色提示（`Select text or a field to focus the next turn.`）；右侧是清空对话、最大化、关闭三个图标按钮。中段是消息流：用户消息是右对齐的 88% 宽 primary 实底白字气泡，助手消息是左对齐的 88% 宽 `bg-muted` 气泡，两者都是 10px 圆角、12.5px 字号；工具与计划以灰色小胶囊形式出现（如 `Plan.` 加若干步骤胶囊，或转圈的 `Working`）；拟合检查的结果是一个带描边的浅灰卡片。底部是输入区：技能胶囊行（如 `Impact bullets`）、可选的「允许删除与重构」开关行、圆角输入框（placeholder 为 `Ask about this resume…`）、右侧发送或停止按钮。

建议卡是三处里最需要细看的地方。它包含：类型标签（如 `Suggested rewrite`，带一个脉冲小圆点）加作用域路径（10.5px 灰，如 `Experience > Acme > bullet 2`）、右上角的补丁类型角标；正文按补丁类型呈现不同形态（`replace_text` 显示划掉原文加新文的词级 diff，`update_fields` 显示两列表格，插入/删除/移动显示摘要）；如果有结构性改动，卡片会变成破坏性处理并显示一句说明；如果补丁引入了简历里没有的数字，会有一条琥珀色的提示说明这是估算值；底部是 `Accept` 与 `Dismiss` 两个按钮。

**冲突横幅**：当别的会话改动了同一份简历，中列顶部出现一条提示 `This resume changed somewhere else`，配 `Reload theirs` 与 `Keep mine` 两个动作。

### 5.4 Versions 视图（`?view=versions`）

中列换成版本历史，右列不变。单列布局，最大宽同中列。

```text
Versions                                         19px Inter semibold
Every save, and every accepted suggestion.       12.5px muted

┌──────────────────────────────────────────────────────┐
│ #12  Tightened three bullets           [agent]       │ 10px 圆角
│      2 hours ago · 4 changes                         │
├──────────────────────────────────────────────────────┤ ← 展开时与上一行连体
│ CHANGES SINCE THIS VERSION      [ Restore ]          │
│   ▸ experience  Acme                                  │
│       • Led the migration → Cut latency 40%           │
│   ▸ summary                                           │
│       Skills → …                                      │
└──────────────────────────────────────────────────────┘
```

版本行显示序号、一段自动生成的摘要、来源角标（`agent` 或 `user`）、相对时间与改动条数。点击展开后，下方出现一个上边框相连的浅色区块，里面是分组后的差异列表（字段级改动显示为划掉的旧值加箭头加新值），右上角有 `Restore`。空态是虚线框，写 `No versions yet`。若某版本与当前内容一致，会有一行 `Identical to what is open now.`。

### 5.5 Export

居中单列，最大宽 880px，与 Dashboard 一致。

```text
Export                                           19px Inter semibold
Download the same file the preview is showing.    12.5px muted

┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ ▤  PDF         │ │ ▤  DOCX        │ │ ▤  TXT / JSON  │
│ Live. Download │ │ Not in this    │ │ Not in this    │
│ the current... │ │ release        │ │ release        │
│ [ Download PDF]│ │ [ disabled ]   │ │ [ disabled ]   │
└────────────────┘ └────────────────┘ └────────────────┘
三列自适应网格，每格最小 240px

┌───────────────────────────────────────────────┐
│ PREFLIGHT                                     │
│ ✓ Two-column layout                           │
│ ✓ Fonts embedded as real text                 │
│ ⚠ Every bullet carries a figure               │
│ ⚠ Page count not measured yet                 │
└───────────────────────────────────────────────┘
```

### 5.6 Interview

居中单列，最大宽 820px。顶部有一句虚线框住的说明，说明这是演示内容；下面是一排分类胶囊；再下面是可展开的问题卡片，展开后显示「问题 / 要点 / 你可以这样回答」三段，左侧用 58px 宽的大写小标签标注段落名。

### 5.7 浮层清单

导入对话框（PDF 或 DOCX 导入，含进度与任务分页）、删除简历确认、重命名、清空对话确认、简历卡片上的 `⋯` 菜单、模板下拉、月份选择弹层、技能胶囊。所有浮层都是浅色纸底加 1px 描边，不使用大阴影。

---

## 6. 现状问题清单

按可改进的收益排序。每条都标注了依据，便于设计时判断。

**P1 三栏全是白的，只有 1px 描边在分栏。**
`SectionRail` 是 `bg-paper`，中列也是 `bg-paper`，左栏与中列之间只有一条描边。视觉上两个区域糊成一块，用户很难一眼分清「导航」与「内容」。右列是 `bg-canvas`，是全局唯一一处靠底色分层的例子。

**P2 编辑区与预览区之间没有空间对应关系。**
用户选中某条经历时，预览里没有任何标记；用户看到预览里某段想改，也点不过去。这是同一份文档的两视图，却像两个独立应用。数据层已经具备条件（每个节点有 id，`selectedNodeId` 已存在）。

**P3 AI 建议的差异只存在于聊天卡里。**
悬停建议卡会让预览短暂显示改动效果，但移开鼠标就消失。用户要判断「这条改得好不好」，得反复悬停与移开，而正确的做法是让改动直接落在文档与预览上。

**P4 缺少待审队列的全局视图。**
AI 一次可能返回 5 条建议，散落在消息流里。用户容易漏掉，也无法知道「还有几条没处理」。目前只有一个 `Accept all`（且结构性改动被排除在外）。

**P5 面板开关的权重过高。**
左栏底部有三个开关行（Preview / Assistant / Versions），占据约 96px 高度，与真正的内容导航争夺注意力。专业软件通常把面板开关放在面板自身或工具栏里。

**P6 视图切换分散在两处。**
Editor / Export / Interview 在顶栏的胶囊里，Versions 在左栏的开关区。它们都是「看这份简历的不同方式」，却被分到两个位置、两种控件形态。

**P7 视图切换也用了胶囊，但它是全局导航。**
模式胶囊是顶栏唯一的强视觉元素，用的是 primary 实底，比「保存状态」「当前简历名」都更抢眼，而实际使用频率很低。

**P8 预览工具栏缺少适配类操作。**
只有缩放步进（50/75/100/125/150）与页数显示，没有「适应宽度」与「适应整页」，而 PDF 预览的默认期望就是这两个。缩放数字也不可点。

**P9 窄屏时右侧两个面板上下硬分。**
内容宽度低于 980px 时左栏折叠，但右列仍会在预览与助手都在时上下 60/40 分割，两个面板都变得难用。

**P10 字号与圆角档位过多。**
字号有 13 个不同像素值，圆角有 4 个（5/7/9/10）再加若干工具类。当前靠工程纪律维持一致，缺少可描述的阶梯。

**P11 `ok` 状态色等于 primary。**
`--ok` 与 `--primary` 是同一个蓝，「已保存」的对勾是蓝色。好处是克制，代价是「保存成功」与「可点击」在颜色上无法区分。

**P12 没有命令入口。**
除撤销重做外无键盘操作。跳转 section、添加 section、换模板、套用技能这些高频动作都要用鼠标在三个不同区域里找。

**P13 模板选择以「下拉面板」形态挤在预览工具栏下方。**
六张缩略图加字号胶囊全部塞在 88px 高度的展开区里，与预览争空间。

**P14 版本历史是单列展开式。**
一行一行展开差异，比较两个版本时要来回展开与折叠，缺少「左列表右对照」的常规形态。

---

## 7. 参照产品

不要照抄外观，抄结构与交互习惯。

| 产品 | 相似点 | 具体借鉴 |
| --- | --- | --- |
| **Overleaf** | 与主编辑屏几乎同构：左边写源，右边实时出 PDF | PDF 工具栏的 fit width / fit page；渲染中的进度表达；**双向定位**（点 PDF 跳到对应源码，光标在源里时 PDF 对应位置高亮） |
| **Figma** | 左侧面板 + 画布 + 右侧属性栏，均可拖拽、可最大化 | 面板标题栏的统一范式（左标题、右图标按钮、hover 才显影）；浮动缩放控件；**窄屏时把多个面板收成标签页**而不是硬塞分栏 |
| **VS Code / JetBrains** | activity bar + 工具窗 | 工具窗的开关归面板自身管理，导航栏只负责导航；窄屏时工具窗自动挪到边缘或收起 |
| **Linear** | 同一种克制、紧凑、无阴影的调子 | 1px 低对比描边、3% 到 5% 的 hover 底、只在浮层用阴影；**Cmd+K 命令面板**；列表项的 hover 操作条 |
| **Notion** | 块级文档编辑 | hover 才出现的块操作手柄与菜单；标签在上、输入无边框、聚焦才出边框与焦点线 |
| **Cursor / Zed / Copilot Chat** | AI 提议加逐条接受 | 待审汇总条（N 条待处理、全部接受、全部拒绝）；逐条 Accept/Reject；接受后差异淡出；差异着色 |
| **Notion AI** | 建议直接落在文档上 | 建议态在文档内联呈现（幽灵文本或高亮），而不是只活在聊天面板里 |
| **Google Docs** | 文档加右侧栏 | 左侧大纲面板与正文的联动；版本历史侧栏（按日分组、只显示命名版本、恢复此版本）；保存状态的措辞层级 |
| **Canva** | 左侧素材、中间画布、右侧属性 | 属性面板的分组标题与折叠；一组预设值用胶囊而非下拉 |
| **Reactive Resume**（同类开源产品） | 表单加实时预览加模板选择 | 模板画廊的呈现（大缩略图加描述）；section 手风琴 |

---

## 8. 改造方案

### 8.0 三条主线

整个改造收敛为三件事，其余都是它们的推论。

**主线 A：重排「面」的层级。**
「纸」（纯白）只留给内容本身：表单区、PDF 页、浮层。导航与工具一律退到 `canvas` 或更浅的 tinted 面，靠底色而不是描边来分区。
判据：关掉所有描边，界面依然能看出「这是导航」「这是内容」。

**主线 B：把三个视图连成一件事（联动定位）。**
编辑表单、PDF 预览、AI 建议卡共享同一个「当前节点」概念。在任一处选中，另外两处同时高亮并滚动到可见。
判据：用户点预览里的某条经历，表单会定位到那张卡并展开，左栏对应 section 也亮起。

**主线 C：把建议从「消息」升级为「待审队列」。**
建议出现在三个地方且始终一致：文档与预览里的高亮、卡片本身、以及一条常驻的待审汇总。接受或拒绝后，三处同时消失。
判据：用户在处理第 3 条时，始终知道还有几条、以及总共会改动哪些地方。

### 8.1 全局壳

- 模式切换从顶栏中央移到「当前简历」的旁边，形态从彩色胶囊改为一行低调的文本标签加下划线指示，或改为分段控件。它不再使用 primary 实底。
- 顶栏腾出的中央位置给两样东西：一个搜索/命令入口（`Cmd+K`，形态参考 Linear，含一行 placeholder 与右侧 kbd 提示），以及常驻的保存状态（把现在藏在表单标题行里的状态提升到全局可见）。
- 顶栏信息层级建议：左为 logo 与当前简历名（可点击展开切换），中为命令入口，右为保存状态、模式切换、头像。
- `ResumeRail` 的卡片去掉常驻描边，只在 hover 与选中时出现；选中项加一条左侧 2px 指示条。列表顶部加一个筛选/搜索输入。

### 8.2 Dashboard

- 卡片网格保持，但增加每张卡的「最近编辑时间」「页数」「是否有待处理建议」三个元信息，用统一的角标行呈现。
- 增加排序与筛选（最近编辑 / 名称 / 归档），位置在标题右侧。
- 空态重构：`Getting started` 目前是四步说明加按钮，建议改成可勾选的三步清单，并让每一步直接跳到对应位置。
- 导入入口与新建入口合并成一个更明确的主行动区，避免两个虚线框并列。

### 8.3 主编辑屏

```text
┌──────────────────┬────────────────────────────────────────────┬──────────────────────────┐
│ MY RESUME        │ Contact     12 roles   ✓ Saved   ⟲ ⟳  ⛭   │ ▤ Preview  1p  [fit][100%]│
│ ──────────────── │ ────────────────────────────────────────── │ ────────────────────────  │
│ ● Contact        │                                            │  ┌────────────────────┐  │
│   Summary        │  FULL NAME                                 │  │   PDF page         │  │
│ ● Experience  3  │  [___________________________________]     │  │   ← 选中态描边      │  │
│   Education      │                                            │  │   ┌──────────────┐ │  │
│   Projects       │  HEADLINE                                  │  │   │ 高亮的条目   │ │  │
│   Skills      2  │  [___________________________________]     │  │   └──────────────┘ │  │
│                  │                                            │  └────────────────────┘  │
│ + Add section    │  LINKS                                     │                          │
│ ──────────────── │  [Label__________] [https://________]  🗑  │  ┌────────────────────┐  │
│ Views            │  + Add link                                │  │ Assistant          │  │
│  Editor          │                                            │  │  待审 3 条         │  │
│  Versions        │                                            │  │  ┌──────────────┐  │  │
│  Export          │                                            │  │  │ suggestion   │  │  │
│  Interview       │                                            │  │  └──────────────┘  │  │
│                  │                                            │  │ [ Ask about ...  ↑]│  │
└──────────────────┴────────────────────────────────────────────┴──────────────────────────┘
```

- 左栏改为 `bg-canvas`，与中列的白纸形成明确分区。栏内改为三段：`Sections`（导航）、`Views`（Editor / Versions / Export / Interview，即把顶栏模式与 Versions 合并到一处）、以及各面板自己在标题栏里的开关。栏底部只留 `Add section`。
- 激活项从纯色底改为「2px 左侧指示条加淡底」，与预览的高亮用同一种颜色语义。
- 中列保留白纸。首屏的标题行建议压缩为两行：第一行标题加元信息加操作，第二行是一句场景化提示（例如当前栏目的填写建议）。
- 字段改为 Notion 式：无边框输入，聚焦时底部出现 2px primary 线与一层极淡的 focus 底；错误态用 destructive 色描边加下方说明；网格改用统一的基线网格，所有字段行高一致。
- `ItemCard` 折叠态压缩到 40px 高，展开态固定显示「标题行加一行摘要」（例如 `Acme · 2022 to present · 4 bullets`），删除与拖拽只在 hover 时出现。

### 8.4 预览面板

- 工具栏补上 fit width 与 fit page 两个图标按钮；缩放百分比数字可点，点开是一个包含预设档位与「适应宽度 / 适应整页」的菜单。
- 增加页码跳转（`1 / 2` 可输入），多页时右侧加一个极窄的页面缩略导航。
- 模板选择从「工具栏下方展开的面板」改为两种方案二选一，请设计两个版本：
  (a) 点击后在右列内滑出一层模板画廊（覆盖预览区，带大缩略图、模板名、一句描述与主题色点）；
  (b) 常驻在右列底部的横向画廊条（约 96px 高，横向滚动，选中项描边）。
- 渲染状态统一：渲染中的不定进度条保留，另加一层「内容已过期，正在重排」的轻提示，避免用户在旧内容上做判断。
- 新增：预览与表单联动的视觉规则。选中节点的对应区域在页面上有一圈 1.5px primary 描边加极淡底色；被 AI 建议改动的区域用另一种语义色（建议用琥珀）标出，与现有的 `flag` 体系一致。

### 8.5 助手面板与建议（本次设计的重点）

- 标题栏显示当前作用域，并把「作用域」做成一个明确的实体：`Whole resume` / `Experience · Acme` / `Bullet 2 of 4`。用户点击可切换作用域（整份 / 当前 section / 当前条目）。
- 消息流保留气泡形态，但把「计划」「工具调用」「拟合检查」统一成一类低调的过程卡，默认收起为一行，可展开。
- **待审汇总条**：固定在输入区上方或面板顶部，一行呈现 `3 suggestions pending`，右侧 `Accept all` 与 `Reject all`。当存在结构性改动（会删除或重构内容）时，指明其中几条需要单独确认，`Accept all` 只作用于安全项。
- **建议卡重构**：
  - 头部：改动类型（如 `Impact bullet`，来自技能名）加作用域路径，右侧是补丁类型角标。
  - 主体：`replace_text` 用词级 diff（划掉旧文、新文加重、只高亮变化词）；`update_fields` 用两列对照表，行首是该字段在简历中的位置；插入/删除/移动用摘要行加目标位置。
  - 警示：若补丁引入了简历里不存在的数字，用琥珀色说明「这是一个估算值，接受前请确认」，并把数字本身加粗。这部分必须显眼但不能吓人。
  - 结构性改动（删除、重构）用破坏性语义，且不参与批量接受。
  - 底部：`Accept` 主按钮与 `Dismiss` 次按钮，右侧可放一个「在预览中高亮」的开关（默认开）。
- 建议的三种状态都要出图：待处理、已接受（卡片塌陷成一行 `Accepted · 3 fields updated`，带撤销）、已失效（`Outdated`，说明文档已变，附 `Re-apply`）。
- 悬停与选中的区别要设计清楚：悬停卡片为「预看」，选中卡片为「锁定高亮并滚动到该处」。

### 8.6 Versions 视图

改成左右两栏：

```text
┌────────────────┬──────────────────────────────────────────────────────┐
│ TODAY          │  #12  Tightened three bullets         [agent]        │
│  #12 agent  ●  │  2 hours ago · 4 changes                              │
│  #11 user      │  ──────────────────────────────────────────────────   │
│ ──────────     │  DIFF AGAINST CURRENT               [ Restore ]      │
│ YESTERDAY      │                                                       │
│  #10 agent     │  Experience · Acme                                    │
│  #9  user      │   • Led the migration  →  Cut latency 40%              │
│                │                                                       │
│ [只显示命名版本]│  Summary                                              │
│                │   • Led migrations  →  Ran 12 migrations               │
└────────────────┴──────────────────────────────────────────────────────┘
   左栏 280px            右栏自适应
```

- 左栏是时间轴：按日分组、每个版本一行（序号、来源角标、时间、用户命名），选中项用左侧指示条。
- 右栏是该版本与当前内容的差异，字段级分组，改动以「旧值划掉、箭头、新值」呈现。
- 增加「只显示命名版本」开关与版本命名功能。
- `Restore` 需要二次确认（`Restore version 9? This replaces what is open now.`）。

### 8.7 Export 与 Interview

- Export：三张能力卡改为「一个主下载区加两个次级格式」的层级，主区展示文件名、页数、模板名与最近导出时间，主按钮 `Download PDF`。Preflight 从列表改为按严重程度分组的清单（必须解决 / 建议改进 / 已通过），每条可展开说明并跳转到对应位置。若页数未测量，给出可点击的「测量页数」动作而不是干瘪的说明。
- Interview：保留折叠卡结构，但增加「准备进度」的整体视图（已准备 / 未准备），并把静态演示内容的说明改成一条明确的空态与行动号召。

### 8.8 视觉语言统一规则

建议在此次重构中收敛为可描述的阶梯，同时保持现有调子（克制、无阴影、靠描边与底色分层）。

- **颜色**：语义色只保留三个：primary（蓝，动作与选中）、flag（琥珀，值得改进与估算提示）、destructive（红，破坏性）。成功态需要单独决策：要么继续用蓝色对勾加图标区分，要么引入一个低饱和绿。请给出两种方案对比。
- **底色**：`paper` 只用于内容面与浮层；`canvas` 用于外围与导航；新增一档 `tinted`（约 `oklch(0.97)`）用于「同一面板内的分组区」，替代现在混用的 `bg-muted`。
- **描边**：1px `border-border` 为默认；选中用 1.5px primary；虚线只用于「可新增」。
- **圆角**：收敛为三档，小控 6px、中容器 8px、大容器 12px，胶囊保持 full。
- **字号**：收敛为六档，11（元信息，替代 10 与 10.5）、11.5（次要）、12.5（正文与输入）、13.5（卡片标题）、17（面板标题）、19（屏幕标题）。全大写分组标签统一用 11px 加 `tracking-[0.06em]`。
- **间距**：统一到 4 的倍数，只允许 4 / 8 / 12 / 16 / 24 / 32 / 40。取消 7px 与 9px 这类任意值。
- **阴影**：只保留 PDF 页那一层，其余一律不加。
- **动效**：保留两个既有动画，新增的过渡一律 150ms 的 `transition-colors` 或 `transition-opacity`，不加位移动画。

---

## 9. 硬约束

设计稿必须能落到现有实现上，以下不是建议而是边界。

**技术**

- 前端是 React 19 + Tailwind v4 + shadcn（Base UI 版），令牌来自 `packages/ui/src/styles/globals.css`。任何新颜色都要同时给出浅色与深色的 oklch 值（深色令牌已存在，只是没有开关）。
- 字体只有两款且已引入：Figtree Variable（UI 正文）与 Inter Variable（标题）。不要引入新字体。
- 图标统一用 Phosphor Icons。不要混入 Lucide 或其他图标集。
- PDF 是 react-pdf 渲染的真实文件，不受 Tailwind 或 CSS 影响。界面上的改动不会、也不应该改变模板排版。设计稿里的 PDF 页面只是占位示意。
- 主界面是固定视口高度、分区各自滚动，不做整页滚动。设计时请按「1440×900 可见高度」考虑信息量。

**布局**

- 唯一的内容断点是 980px（左栏折叠）。请提供 1440 / 1280 / 1024 / 900 四档，其中 900 档需要给出面板如何收纳的方案（建议标签页）。
- 面板可拖拽，最小宽度：表单列 300px，右列 320px 至 360px，左栏折叠态 50px。
- 顶栏固定 56px，面板标题栏固定 44px。这两处高度不建议改变。

**交互**

- 保存状态有五种：保存中、已保存、未保存改动、重试中、冲突。冲突态需要独立的行动（重新加载 / 用我的覆盖）。
- 自动保存有 800ms 防抖，界面上不要设计成「每次都提示」。
- 结构性改动不可批量接受，这是产品规则，界面上要能体现。
- 撤销/重做是全局的，接受建议也要能撤销。

**内容与无障碍**

- 界面文案用英文，沿用现有措辞，不要改写成营销语气。
- 不使用 emoji，不使用渐变，不使用大面积深色块。
- 所有图标按钮需要可读的标签（aria-label）与 tooltip；开关必须整行可点，并关联到标签文字。
- 正文与次要文字的对比度需满足 WCAG AA。现在的 `muted-foreground` 在 10px 字号下已经偏淡，请在设计时给出更稳的组合。

---

## 10. 交付物清单

**必需的屏幕（浅色，1440 宽）**

1. 主编辑屏，三栏，预览打开、助手关闭（默认态）
2. 主编辑屏，预览与助手同时打开（上下分栏态）
3. 主编辑屏，助手最大化
4. 助手面板特写：含待审汇总条、三条不同类型的建议卡（改写、字段更新、删除）、一条估算警示
5. Versions 视图（新版两栏）
6. Dashboard（含至少三张简历卡）
7. Export 视图（含新版 Preflight）

**必需的补充稿（1440 宽）**

1. 主编辑屏的联动状态：表单选中某条经历、预览对应区域高亮、左栏 section 亮起
2. 模板画廊的两个方案（滑出层 / 底部常驻条）
3. 窄屏 900 宽：面板收纳为标签页的形态
4. 空态组：没有简历、没有版本、没有待处理建议、Preflight 全通过

**建议一并给出**

 1. 组件规范页：颜色、字号、圆角、间距阶梯的实际取值表
 2. 成功态颜色的两版对比（蓝对勾 vs 低饱和绿）
 3. 深色模式的两种处理：只给主编辑屏一屏，或明确声明本期不做

**标注要求**

- 关键尺寸（栏宽、行高、内边距）标在图上
- 交互状态逐项标注：default / hover / focus / active / disabled / loading / error
- 需要动效的地方写明时长与曲线

---

## 11. 验收清单

设计稿通过以下检查即视为可交付实现：

1. 关掉所有描边后，仍能分辨导航面与内容面。
2. 同一屏内出现的强调色不超过两个语义（primary 与 flag）。
3. 全屏字号种类不超过六档。
4. 圆角种类不超过三档。
5. 每一条 AI 建议都能回答三个问题：改哪里、改成了什么、为什么。估算数字有明确标注。
6. 用户在任意时刻都能看到「还有几条建议未处理」。
7. 选中一个节点后，表单、预览、左栏三处的状态一致。
8. 在没有鼠标的情况下，主要流程（跳转栏目、发消息、接受建议、保存版本）可完成，或有明确的快捷键设计。
9. 900px 宽度下，界面没有出现 300px 以下的可用区域。
10. 所有图标按钮有文字标签或 tooltip；所有开关整行可点。

---

## 附录 A：现有界面文案（请沿用）

**全局**：Résumé Studio、My resumes、Create a new resume、Getting started、Editor、Export、Interview、Versions、Sections、Side panels、Preview、Assistant、Add section、Add link、No links yet.

**表单**：Contact、Contact details、Full name、Headline、Email、Phone、Location、Links、Professional summary、Summary、Job title、Company、School、Degree、Field of study、Project、Link、Group name、Title、Subtitle、Skills、Achievements、Start、End、Present、Month、Remove link、Delete entry、Delete achievement、Rename section、Delete section、Section title、Done、Nothing here yet、Add a skill.

**占位符**：Senior Product Designer、<you@example.com>、City, Country、https://、What you do, at what scale, and what changed because of you.

**保存与状态**：Saved、Saving、Unsaved changes、Retrying、Conflict、Fix errors to save、Save version、Undo、Redo.

**预览**：Live preview、Two-column layout、Single-column layout、Switch template、Text size、Zoom in、Zoom out、Maximize preview、Restore preview、Close preview.

**助手**：Assistant、Select text or a field to focus the next turn.、Clear conversation、Ask about this resume…、Message the assistant、Send、Stop、Allow removing and restructuring、Suggested rewrite、Accept、Dismiss、Accept all、Outdated、Plan.、Stopped.、Working.

**技能名**：Impact bullets、Match a posting、Grammar and clarity、Cut to length、Quantify impact、Tech resume.

**版本**：No versions yet、Changes since、Restore、Identical to what is open now.、agent、user.

**其他**：This resume changed somewhere else、Reload theirs、Keep mine、Export、Not in this release、Preflight、Two-column layout、Fonts embedded as real text、Every bullet carries a figure、Reachable、No email address、Page count not measured yet、The last render failed、Interview prep.

## 附录 B：每屏需要覆盖的状态

| 屏幕 | 状态 |
| --- | --- |
| Dashboard | 加载骨架、有简历、只有一份、空、导入对话框中、卡片 hover 菜单 |
| 编辑屏 | 默认、保存中、已保存、未保存、重试中、冲突横幅、校验错误、面板拖拽中、面板最大化、窄屏折叠、窄屏标签页 |
| 表单 | 空字段、聚焦、校验错误、hover 的条目卡、展开的条目卡、拖拽排序中 |
| 预览 | 首次渲染、重排中、多页、适应宽度、适应整页、选中节点高亮、建议高亮、模板画廊打开 |
| 助手 | 空对话、提问中、流式输出中、计划展开、工具调用中、待审若干条、已全部处理、全部拒绝、建议已失效、清空确认 |
| Versions | 空、加载、列表、选中某版本、无差异、恢复确认 |
| Export | 加载、就绪、Preflight 有必须解决的项、二次导出 |
| Interview | 空态、分类筛选、卡片展开 |
