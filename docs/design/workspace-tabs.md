# 动态工作区 Tabs

实现日期：2026-09-22。

工作区在 `_app` 层覆盖简历与 Skills 页面。Tab 描述已打开的页面，URL 决定活动页面，Registry 持有资源运行态。关闭 tab 不删除资源。

## 实现入口

| 文件 | 职责 |
| --- | --- |
| `apps/web/src/features/workspace/targets.ts` | Zod 身份、快照和现有路由映射 |
| `apps/web/src/features/workspace/store.ts` | 打开、排序、恢复、关闭守卫、Registry 与释放 |
| `apps/web/src/features/workspace/context.tsx` | 每用户实例、路由提交同步、确认框与离站提示 |
| `apps/web/src/features/workspace/WorkspaceTabs.tsx` | 全局栏、Base UI tabs、菜单、拖动与键盘排序 |
| `apps/web/src/features/workspace/skill-editor.ts` | 技能草稿、校验与保存状态 |
| `apps/web/src/features/chat/assistant-runtime.ts` | 每简历独立 Chat、输入、生成任务和测量回调 |
| `apps/web/src/server/fns/conversations.ts` | 按具体 runId 取消的 server function |
| `packages/resume-core/src/services/run-service.ts` | 取消幂等性与运行记录归属检查 |

同简历的四种页面共享 ResumeSession、撤销栈、PreviewStore 和 Chat。章节、Versions 选择、全宽偏好、技能草稿、聊天输入与滚动位置保存在运行态。未激活的恢复 tab 只有描述，首次进入页面时才创建资源会话。

工作区本机快照为 `{ version: 1, tabs, lastActiveKey }`，存储键按 userId 隔离。不保存标题、正文、草稿、聊天输入或撤销历史。SSR 与客户端首帧不读取 localStorage，挂载后合并当前 URL。具体资源 URL 优先，只有首次进入 dashboard 才尝试恢复活动页。

## 关闭和后台任务

单个、关闭其他、关闭全部都调用 `requestCloseTabs`。同资源还有其他页面时保留会话。最后一个简历页面等待已有写入并 flush，遇到无效内容、冲突或保存失败保留页面。技能草稿可保存、放弃或取消；未发送消息可放弃或取消。失败通知提供返回编辑页的入口。

全部目标通过检查后才移除页面。活动 tab 先导航到右邻居、左邻居或 dashboard，再删除旧描述。批量检查已经保存的内容不回滚，已经停止的任务不自动重启。

Chat 独立于面板挂载。后台任务的闭包读取原简历 session，普通 PDF 引擎只在活动简历下挂载。关闭最后一个页面会中断客户端请求，按消息 metadata 中的 runId 取消服务端记录，并使迟到的 check_fit 回调失效。续跑拒绝与当前运行记录不匹配的 runId。Supabase 与内存仓储均只允许 running 转为终态，避免完成回调覆盖 cancelled。

新建技能保存时，工作区等待保存和身份迁移完整结束。原草稿仍活动时才替换 URL，背景保存不抢焦点。资源释放同步或失效查询缓存，成功删除资源清理其全部页面与运行态。

## 验证记录

- `bun run typecheck`：通过。
- `bun run lint`：通过。
- 工作区模型、内存路由、AssistantRuntime、chat handler：42 项相关测试通过。
- Web 全量：180 通过，2 项现有 WordDiff 配色断言失败。
- resume-core 全量：134 通过，1 项现有 ImportService 长度限制断言失败。
- agent 全量：101 通过，2 跳过，1 项现有模型 thinking 配置断言失败。

以上四个失败涉及的实现和测试文件与任务开始时的 HEAD 相同，未在本次修改。没有运行 build、启动开发服务器或使用浏览器自动化。

## 手动验收

1. 在 `/r/:resumeId/edit` 打开 A，用 `+` 打开 A 的 Export，再从左侧打开 B。返回 A 后，字段值和撤销记录应保留。
2. 在 `/skills/new` 输入内容，切换到简历再返回，草稿应保留。保存后原 tab 原位变为真实技能，后台保存不切走当前页面。
3. 打开多个简历和技能页面，检查横向溢出、活动项滚入视野、左右方向键切换，以及 `Alt+Shift+←/→` 排序。拖动应只调整顺序。
4. 关闭活动页面应进入右邻居，其次左邻居；关闭全部后显示 dashboard。浏览器历史重新访问已关闭页面时应重新登记。
5. 在简历无效、保存冲突或离线时关闭最后一个页面，应保留 tab 并说明原因。批量关闭时取消草稿提示，应保留全部目标。
6. 在 A 启动 AI 后切换到 B，结果应只归属 A。关闭 A 的最后一个 tab 后，迟到的测量结果不应再次发起续跑。
7. 刷新具体资源 URL，当前页面优先；首次进入 dashboard 可恢复上次活动页，运行期间返回首页不再次恢复。Skills 页面隐藏简历 Preview 与 Assistant。

## 原模板文档

`workspace-tabs-system-design.docx` 是中文 System Design 交付文档，`workspace-tabs-reference.docx` 是保留的原始参考文件。

参考 SHA-256：`13504f6c221a42c1726460a9e865e563355539ff97d702d6c9b2267b4b261d76`。

采用 OOXML 定点替换正文、页脚、脚注、链接目标和原图槽位。其余 19 个包部件逐字节保持不变；段落、表格、行列数量、段落与字符格式、表格网格、节设置均通过一致性检查。参考文件未改动。

最终文档用 bundled LibreOffice 渲染为 7 页，已逐页检查中文显示、表格、架构图、脚注和分页。渲染进程通过临时 Fontconfig 配置读取现有系统中文字体，未修改模板字体或系统字体设置。中间 PDF 和页图仅用于检查，不作为交付文件。
