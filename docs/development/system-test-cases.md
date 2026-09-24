# 系统测试用例与执行记录

最近执行：2026-09-18。功能实现状态仍以 [开发计划](dev-plan.md) 为准；本文件负责可重复的测试步骤、证据和验收边界。原生发布验收另见 [P0 回归清单](p0-regression-checklist.md)。

## 1. 本轮结果

| 检查 | 结果 |
| --- | --- |
| 前端全量 Vitest | 208 个文件，971 项通过，0 失败；最后全量运行 34.25 秒 |
| Rust 全工作区测试 | 248 项通过，0 失败，4 项显式忽略的人工 QA 生成器未执行 |
| Rust 全工作区编译检查 | `cargo check --workspace` 通过，包含桌面后端 |
| 前端类型检查与生产构建 | `tsc --noEmit && vite build` 通过 |
| 浏览器实测 | 设置、条目侧栏/编辑、条目库、真实 PDF.js 阅读、段落翻译、关系图六个隔离入口 |
| 新增自动回归 | 21 项：资料库读取归属 7 项、侧栏拖动/布局 9 项、组合弹层 2 项、PDF 可读区域 3 项 |
| 原生 Tauri 视觉验收 | 未完成；浏览器结果不能替代 WebView2、原生对话框及窗口生命周期验收 |
| 玻璃配色修订复查 | 6 文件/78 项相关测试与构建通过；完整窗口、窄窗口和 PDF 滚动透色浏览器检查通过，原生截图接口不支持（0x80004002） |
| 标签阅读内部目录复查 | 新增 5 项回归；11 文件/91 项相关测试、类型检查和构建通过。浏览器验证 220px 侧栏、125% 缩放、左右打开、无 PDF 笔记及 32 篇笔记菜单；原生视觉未验收 |
| 标签阅读层级修订复查 | 新增 2 项回归；8 文件/54 项相关测试与构建通过。浏览器检查三级缩进、单项高亮、折叠位置提示、方向键、三主题、220px/125% 及长目录；原生视觉未验收 |

测试开始时前端有 950 项，其中 3 项失败：推荐标签测试仍期待自动请求、重排性能测试缺少正式组件需要的 Toast Provider、设置模型测试在全量并行执行时查询范围过大导致超时。已更新测试环境和过时预期、缩小查询到当前对话框；没有删除断言或提高超时。随后新增回归先复现故障，再修复实现。

本轮修复：

| 编号 | 级别 | 复现和影响 | 修复与验证 |
| --- | --- | --- | --- |
| BUG-01 | P1 | A 资料库的请求未完成时切换 B，A 的条目、批注、回收站或错误迟到后覆盖 B；返回同名 A 也会接收上一次访问的结果 | 读取结果同时核对资料库、访问代次和同资源请求顺序；打开资料库清理旧目录与解析刷新状态。7 项真实 hook 回归通过 |
| BUG-02 | P1 | 主侧栏拖动收到 pointercancel 仍提交宽度，失焦或卸载后可能遗留全局禁止选字和拖动光标；125% 下位移计算偏大 | 抽取共用拖动 hook，明确提交/取消、指针归属、资源清理和物理距离换算；9 项回归通过，浏览器验证缩放拖动 |
| BUG-03 | P1 | 玻璃阅读栏浮在 PDF 上方时，跳到第 3 页仍显示第 2 页；“下一页”反复定位同页 | 可见页判断与翻页共用 CSS 定义的可读区域，观察器排除浮栏遮挡，随工具栏换行/缩放更新；3 项回归、实际第 2→3→4 页及 125% 窄栏通过 |
| BUG-04 | P2 | 侧栏先拉宽，再放大界面或缩窄窗口，会挤掉主内容区 | 根据内容可用宽度临时约束侧栏，给主区域保留空间，不覆盖偏好；浏览器验证 820→656→820px 往返 |
| BUG-05 | P2 | Tooltip 与 Popover 的触发器组合时丢失 DOM 引用，弹层定位与关闭后的键盘焦点不可靠，React 输出 ref 警告 | 两个共享 Trigger 转发 ref；正反组合 2 项回归及标签笔记筛选实测通过，Esc 恢复入口焦点 |

此次未改变保存草稿、写入冲突或模型请求限流的业务规则，没有增加交互延迟或新依赖。读取校验只决定异步结果是否还属于当前界面。

## 2. 执行方法与测试数据

验证分层：

- **A**：本轮全量自动化或后续专项回归中相关行为通过。组件测试使用受控 IPC/事件，Rust 存储测试使用临时目录，HTTP 测试使用本地模拟服务。
- **B**：本轮已按浏览器交互步骤实测。使用正式业务组件和隔离示例数据，不代表真实原生 IPC 链路也完成验收。
- **N**：必须补做原生窗口、实际磁盘或外部服务验收；本轮未执行。

矩阵中的 A 表示已有自动化覆盖该场景的核心逻辑，不表示人工步骤的每一种排列组合均被自动化。没有列 B 的用例不记作本轮浏览器通过。

```powershell
# 仓库根目录
npm --workspace apps/desktop run test:frontend
npm run test
npm run check
npm --workspace apps/desktop run build:frontend

# 仅在 1420 没有现有开发服务时启动浏览器检查入口
npm --workspace apps/desktop run dev:frontend
```

原生验收准备两个可丢弃的资料库 A/B，包含不同标题但相同条目 ID 的复制样本，以便发现跨库混入。数据集应同时有空库、无 PDF 条目、失败解析、深层标签、长标题、600 条记录、240 段正文、中英文和数学公式、跨页表格、图片、孤立引用。网络失败用受控测试端点模拟，不改真实服务配置。

尺寸组合：原生最小窗口 1280×720、常规宽窗口，界面 100%/125%/150%；左右分屏和窄侧栏另测。浏览器 800px 双栏只是压力场景，不宣称桌面支持 800px 整窗。此次重点实测设置 320px 内容栏/125%、PDF 800px 整窗/125% 双栏（每侧工具栏 294px）、条目库 800px/125% 分屏和关系图 560px/125%。

每个交互至少检查：初始/加载/空/错误、主操作、重复操作、取消、恢复焦点、自己的滚动区域、切换对象后的归属。拖动额外检查 Esc、失焦、pointercancel、卸载、另一根指针和缩放；只读场景必须不获得写入目标。

## 3. 用例矩阵（72 项）

### 资料库与异步归属

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| WK-01 | P0 | 新建空库，创建条目和笔记，关闭并重新打开 | 元数据、文件和笔记一致，不产生第二份主 PDF | A：workspace 存储；N：完整原生重启流程 |
| WK-02 | P1 | 延迟 A 的批注/回收站读取，打开 B，再完成 A 请求 | B 只显示 B 的目录，A 的迟到错误不污染 B | A：`useWorkspace.test.tsx`，BUG-01 |
| WK-03 | P1 | 延迟 A 条目刷新，切到 B；另在同库连续刷新两次并倒序完成 | 当前库、选中条目和列表不被旧响应替换 | A：`useWorkspace.test.tsx` |
| WK-04 | P1 | A→B→A，最后完成第一次 A 的请求；初始读取中再手动刷新 | 使用本次访问和最新刷新结果 | A：`useWorkspace.test.tsx` |
| WK-05 | P1 | A 正常打开时尝试不存在/无法读取的 B | 保留 A 的数据与可用状态，显示切换失败 | A：`useWorkspace.test.tsx`；N：系统权限场景 |
| WK-06 | P0 | 条目连同笔记/图片进入回收站后恢复；中途模拟写入失败 | 恢复对象完整，失败无静默半完成，原数据可恢复 | A：workspace journal/trash；N：原生完整流程 |

### 窗口、页签、拖动和弹层

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| UI-01 | P1 | 多次打开同一条目，左右分屏开不同内容，切换活动页 | 复用正确页签，左右选中对象/焦点不串线 | A：workspaceSurface/workspaceSplit/WorkspaceTabsBar |
| UI-02 | P0 | 两页有草稿，批量关闭；让其中一次保存失败后重试 | 失败保留待关闭页面和草稿，不关闭后来新增页 | A：useSurfaceCloseGuard/useUnsavedWindowCloseGuard；N：原生关闭 |
| UI-03 | P1 | 主侧栏分隔条单击或移动不足 4px 后松开 | 不写入宽度、不遗留拖动样式 | A：useSidebarResize |
| UI-04 | P1 | 125% 下拖动 100px 后松开，再发送一次 pointerup | 布局宽度增加 80px，只提交一次 | A、B：生产 hook，BUG-02 |
| UI-05 | P1 | 侧栏拖动中分别 Esc、pointercancel、失焦、折叠、卸载；混入另一 pointerId | 取消不持久化；恢复光标/选字，无悬挂监听器 | A：useSidebarResize；N：操作系统切窗 |
| UI-06 | P2 | 侧栏拉至 820px，放大到 125%，恢复 100%；用左右方向键调整 | 保留主内容可达，恢复偏好宽度，键盘有边界 | A、B：820→656→820px，BUG-04 |
| UI-07 | P1 | 标签/列宽/笔记块/分屏拖动中取消、切页，再正常拖动 | 原顺序/尺寸回滚，不触发点击或悬停预览 | A：各业务 drag/split 测试；N：跨原生窗口拖放 |
| UI-08 | P2 | 打开带 Tooltip 的标签笔记筛选，输入，再按 Esc | 位置贴近按钮，焦点回按钮，没有 ref 警告 | A、B：popover/tooltip，BUG-05 |
| UI-09 | P2 | 窄栏打开菜单，方向键/Home/End 选择，Esc 关闭；嵌套弹窗逐层退出 | 操作不被截断，只有最上层关闭，焦点回原入口 | A：dialog/select/viewport-overlay/SegmentActionMenu；B：PDF/列表菜单 |

### 条目库与编辑

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| LIB-01 | P1 | 600 条记录中搜索末条标题、不存在的词，清空搜索；切换排序 | 准确找到末条；无结果与空库不同；清空恢复范围 | A：EntryLibraryView；B：`/ 600` 命中 1 条 |
| LIB-02 | P2 | 深层标签/长描述/长标题，800px/125% 分屏，开右键菜单 | 页眉操作可达，表格自身滚动，整页不横向溢出 | A：EntryLibraryView/TagNavigation；B：宽度检查及上下文菜单 |
| LIB-03 | P1 | 打开新建条目，填写标签，切换 PDF/解析结果/普通模式再提交 | 添加标签不提交表单，只提交当前模式的来源 | A：CreateEntryPanel；N：真实文件选择 |
| LIB-04 | P1 | 编辑标题后返回，Esc 取消，再返回并放弃 | 取消保留草稿；放弃恢复原值；焦点回编辑按钮 | A、B：EntryEditPage/EntryOverview |
| LIB-05 | P0 | 编辑标题/描述/标签/属性，Ctrl+S；模拟失败、外部更新及解析刷新 | 失败可重试；外部修改不被覆盖；解析状态刷新不清草稿 | A：EntryEditPage；N：磁盘竞争 |
| LIB-06 | P2 | 打开已有标签的条目，生成推荐、添加一项、切换再返回、重新生成失败 | 打开时不自动调用模型；旧推荐保留，已添加项准确 | A：EntryTagRecommendations/useEntryTagSuggestions；N：真实模型 |

### 标签阅读内部内容

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| TAG-01 | P1 | 展开论文及笔记组、筛选后清空，依次打开 PDF、重排和指定笔记，再查看详情 | 箭头不触发阅读；打开准确内容，标签范围、查询、折叠、滚动及标签阅读侧栏保留 | A：SameTagSidebar.contents/useSameTagContext/tagReadingNavigation；B：正式侧栏与路由预览 |
| TAG-02 | P1 | 内容已在另一侧时再次点击，再显式选择分屏打开；检查无 PDF、解析中/失败及笔记重命名/删除 | 默认聚焦已有页签，显式分屏才移动；不重复编辑器，不丢其他页签；无 PDF 可读笔记，禁用重排显示原因，目录随数据更新 | A：SameTagSidebar.contents/workspaceSurface；B：无 PDF 笔记与两侧打开；N：原生编辑草稿跨侧移动 |
| TAG-03 | P2 | 800×600、220px 侧栏、125% 缩放，右键打开含 32 篇笔记的论文；方向键进入另一侧子菜单，End/Enter 打开末篇，Esc 返回 | 主/子菜单保持视口内并可滚动；末项可达，打开正确笔记，关闭恢复焦点，无 ref 警告 | A：context-menu/viewport-overlay；B：主/子菜单边界与末篇打开；N：WebView2 视觉检查 |
| TAG-04 | P2 | 展开论文和笔记组，选中笔记后逐级收起；用方向键进入首个子项、返回上级；在三种主题及 220px/125% 下查看 | 三级缩进与连接线明确，只高亮当前叶子；折叠仍显示当前位置，返回上级不打开内容，原折叠状态保留，无横向溢出 | A：SameTagSidebar.contents；B：正式目录、长列表和主题切换；N：原生视觉检查 |

### PDF 阅读与批注

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| PDF-01 | P1 | PDF 加载失败后重试；加载中切条目、卸载旧阅读器 | 有可恢复提示，旧文档不覆盖新文档，worker/canvas 清理 | A：usePdfBytes/usePdfDocument/PdfCanvasPage |
| PDF-02 | P1 | 玻璃模式输入第 2 页，再连续下一页到第 4 页；125% 窄栏重复 | 页码与可读正文一致，末页禁用下一页 | A、B：useVisiblePdfPages/readerUtils，BUG-03 |
| PDF-03 | P1 | 查找 Evidence，Enter/Shift+Enter 切换，再清除 | 命中计数、页码与高亮同步，清除移除查找状态 | A：usePdfTextSearch；B：示例 24 个匹配 |
| PDF-04 | P1 | 连续/书页、单页/双页切换，PageUp/PageDown，回上次位置 | 当前阅读页保留；输入框/正文选择时不误翻页 | A：usePdfBookNavigation/pdfPageTurn；B：书页第 4→3 页 |
| PDF-05 | P2 | 800px/125% 双栏，分别翻页、打开查找/工具菜单 | 每侧独立，工具栏 294px 自动换两行，菜单在视口内 | A：ReaderToolbar；B：两侧页码 3/1、菜单边界 |
| PDF-06 | P0 | 选字添加高亮/批注，保存中继续输入，刷新列表、切批注后重试失败保存 | 选择定位正确，更新不清草稿，失败可重试 | A：PdfTextSelectionToolbar/SegmentAnnotationEditor/usePdfAnnotationActions；N：真实 PDF 选字 |
| PDF-07 | P1 | 放大后 Ctrl+滚轮、滚动、目录跳页、隐藏再返回 | 锚点可达，懒渲染不无限增长，背景页不累加阅读时长 | A：usePdfReaderZoomState/render queue/reading tracker；N：原生长文档性能 |

### 重排和翻译

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| TR-01 | P1 | 打开 240 段重排正文，跳到后部，隐藏/恢复元素 | 虚拟化只挂载可见附近内容，正文顺序和来源不变 | A：ReflowReader.performance/reflowVirtualization |
| TR-02 | P1 | 右键或 Shift+F10“翻译此段”，重复点击 | 正常首次仅整段/逐句各一次；重复提交复用任务，只发送当前段落 | A：ParagraphTranslation + Rust 本地 HTTP；B：请求数 2 |
| TR-03 | P1 | 逐步提供流式结果；切换整段/逐句对照 | 完成一句就显示一句，其余英文保留；视图切换不请求模型 | A、B：ParagraphTranslation |
| TR-04 | P1 | 整段成功、逐句失败，切整段查看，再“重试失败的翻译” | 整段译文保留；只补逐句请求；成功后同一段显示两组对照 | A、B：请求数 2→3，切换后仍为 3 |
| TR-05 | P1 | HTTP 连续 429、Retry-After，全文与手动段落同时排队 | 限流不触发非流式重复请求，等待让出并发槽，手动任务优先；超限可重试 | A：Rust rate-limit/scheduler；B：排队/限流 UI；N：真实服务吞吐 |
| TR-06 | P0 | 翻译中改原文、切条目、重复旧进度事件、重启未完成任务 | 旧 source/job/sequence 不覆盖新状态；中断/失败与已保存成功部分分开 | A：ParagraphTranslation + Rust paragraph translation；N：原生重启事件链 |
| TR-07 | P1 | 全文翻译暂停/继续/失败重试，查看任务，导出已保存结果 | 状态准确；运行中/无可导出译文时正确禁用；重试不重复成功部分 | A：TranslationTaskDialog/useEntryTranslationTask/Rust translation；N：真实全文服务 |

### 笔记、来源链接和只读

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| NOTE-01 | P0 | 修改正文，自动保存期间继续输入；失败后重试并重开 | 不丢后续输入，保存状态与实际版本一致 | A：MarkdownNoteEditor/WorkspaceNotesContext/workspace note；N：重启重读 |
| NOTE-02 | P0 | 两个分屏打开同一笔记，在另一处尝试输入或插入引用 | 第二视图只读，不抢占写入目标或执行 Ctrl+S | A：noteEditLease/MarkdownNoteEditor |
| NOTE-03 | P0 | 初次读取失败、外部文件被修改，尝试编辑/保存 | 读取失败保持只读并允许重试；旧 revision 写入被拒绝 | A：MarkdownNoteEditor + Rust revision |
| NOTE-04 | P1 | 粘贴结构化 Markdown，插入/调整表格、公式和图片，再撤销 | 结构不重复、菜单不截断，源码/预览一致，图片尺寸有界 | A：structuredMarkdownPaste/math/table/image tests；N：原生剪贴板 |
| NOTE-05 | P0 | 同一来源反复引用、跨条目引用，删除正文引用后重开 | 来源正确复用；正文与 sidecar 一致，不删除仍在使用的来源 | A：SourceLink/useMarkdownSourceLinks + workspace tests |
| NOTE-06 | P1 | 嵌入笔记与片段笔记各有草稿，关闭父页面、取消/放弃、切换引用预览 | 所有嵌入草稿进入关闭保护，迟到预览不串来源 | A：MarkdownNoteEditor/sourcePreview/segment draft tests |

### 搜索与设置

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| SEARCH-01 | P1 | 搜索“翻译”“主题”和设置别名，打开结果 | 找到正确设置并定位控件，设置加载失败也能查目录 | A：settingsCatalog/SettingsPanel；B：翻译显示定位 |
| SEARCH-02 | P1 | 搜索条目、标签、笔记和来源，键盘选择结果、Esc 返回 | 类型/所属条目明确，跳转目标和焦点准确 | A：SearchResultList/SearchPanel；N：全应用跨页跳转 |
| SEARCH-03 | P1 | 缺失/损坏索引时进入搜索，再显式确认重建 | 不在挂载时自动构建；索引状态可解释，重建后能查询 | A：SearchPanel/SearchIndexStatusLine + neuink-search |
| SEARCH-04 | P1 | 改动源文件、删除/恢复条目后更新索引 | 索引可重建，不作为权威数据；不会返回不存在目标的旧内容 | A：neuink-search/workspace；N：完整 UI 到磁盘链路 |
| SET-01 | P2 | 320px/125% 打开设置、切分类、搜索定位 | 目录和搜索可达，内容区无外层横向溢出 | A：SettingsPanel；B：内容宽度/滚动宽度均 320px |
| SET-02 | P1 | 打开模型编辑，改字段后取消；重新编辑并模拟保存失败、重试 | 取消不保存，失败保留对话框与草稿，成功才关闭 | A：SettingsPanel |
| SET-03 | P0 | 设置自动保存尚未完成时继续修改、关闭或切资料库 | 新修改保持未保存，失败可重试，不把旧响应当最新保存成功 | A：useSettingsAutosave/close guards；N：原生退出 |
| SET-04 | P2 | 标准/拟物/玻璃切换，降低透明度开关，已有草稿和焦点保持 | 名称统一；材质独立于业务状态；减少动效/透明度偏好正确清理资源 | A：AppearanceProvider/useGlassMaterial/glassOptics；B：本轮玻璃业务页面 |
| SET-05 | P1 | 没有模型/解析端点时打开相应功能，配置失败后返回 | 空配置可解释，禁用项有正确原因，普通 PDF 阅读仍可用 | A：Task model/settings/CreateEntryPanel/sciverse settings；N：真实凭据连通性 |
| SET-06 | P2 | 玻璃模式在 1600×900/800×600 打开完整条目库及统计浮层，滚动 PDF 经过悬浮栏 | 工作区无蓝紫底色；浮层透出实际背景色，前景清晰；页眉按钮可达、表格自身滚动 | B：library-showcase?desktop / reader-showcase；N：原生材质验收待完成 |

### 关系图与助手

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| REL-01 | P1 | 600 篇示例搜索“研究 600”，点击节点展开再返回三维 | 只出现匹配对象，二维详情与当前节点一致，转换后恢复操作 | A：relationGraph/RelationsPage/presentation；B：搜索、选中和详情 |
| REL-02 | P2 | 560px/125% 展开详情、打开条目、返回关系图 | 详情操作可达，画布不撑大页面，保留已有选择上下文 | A：RelationsPage；B：页面 558×523px，无滚动溢出 |
| REL-03 | P1 | 模拟部分目录失败，刷新；清空筛选，检查空图/加载图 | 错误与空结果不同，已读数据可用，刷新可恢复 | A：RelationsPage；B：错误→刷新状态 |
| REL-04 | P1 | 静止图、隐藏页、卸载；模拟 WebGL 不可用或丢失 | 空闲暂停，不泄露 GPU 资源，保留可访问对象入口 | A：relationScene/relationPresentation；N：WebView2 GPU/帧率 |
| AI-01 | P0 | 不同资料库/条目/标签下建立对话并切换，再保存会话 | 上下文只属于目标范围，会话持久化不混入另一对象 | A：assistantScope/contextPlanner/conversation tests；N：原生会话重启 |
| AI-02 | P1 | 流式回复期间用户向上滚动，再返回底部 | 不强行抢回滚动位置，消息更新不重渲染全部历史 | A：useAssistantAutoScroll/ChatMessage.performance |
| AI-03 | P0 | Proposal 生成后更改目标笔记或元数据，再应用；重复应用 | 核验基础版本，拒绝陈旧写入，重复应用不会重复修改 | A：harness verification/SDK proposal + IPC/workspace |
| AI-04 | P0 | 模型工具返回异常/循环调用，取消并恢复任务 | 任务状态可解释，不绕过已核验 Proposal 直接写盘 | A：cycleGuard/taskOrchestrator/executionContract/Rust job |
| AI-05 | P1 | Sciverse 超时/错误响应，搜索并保存远程内容 | 错误可恢复，分页推进有界，来源归属明确 | A：neuink-sciverse/config tests；N：真实远程检索和图片下载 |

### 导出、原生边界和性能

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| IO-01 | P0 | 导出检查后修改原文/图片，或切换条目；再点击导出 | 旧检查不能授权新内容；未保存内容有明确处理 | A：PaperExportDialog/ReadingExportDialog + Rust export |
| IO-02 | P1 | 仅选部分笔记/译文导出，检查 DOCX/TXT/ZIP 的内容、来源、图片 | 只导出所选范围，中文和来源完整，无无关资料 | A：ContextualReadingExport/Rust export；N：Word/WPS 排版验收 |
| IO-03 | P0 | 保存对话框取消；目标占用、只读、重名时重试 | 取消不写盘；失败不破坏原目标，恢复后成功 | A：导出组件/原子写逻辑；N：系统保存对话框和权限 |
| IO-04 | P0 | Alt+F4、标题栏关闭、系统文件打开、窗口最大化/还原 | 原生行为与草稿保护一致，不强杀进程代替退出 | A：close guard/title bar 逻辑；N：Windows 窗口验收 |
| PERF-01 | P1 | 240 段文档滚动、跳转、来回切换；长 PDF 快速滚动 | 挂载范围受限、任务优先可见页、旧渲染正确取消 | A：虚拟化、PDF 调度及缓存生命周期测试；N：内存/帧率基准 |
| PERF-02 | P2 | 600 条记录搜索/排序，600 节点图筛选，连续打开/关闭菜单 | 输入和主操作可完成，没有应用报错或页面失去响应 | A、B：长列表/关系图；未测量 p95 输入延迟，不宣称达到某个 FPS |
| PERF-03 | P1 | 页面后台、缩放/拖动中、关闭主题、反复挂载卸载 | 释放 canvas/观察器/监听器；只有交互期间运行必要渲染 | A：bookScene/glassOptics/reader retention/resize tests |
| PERF-04 | P2 | 开发冷启动与正式打包启动、打开大型阅读页 | 记录时间、资源和异常；重包只在需要时加载 | 构建通过；主包约 4.20MB（gzip 1.26MB）仍有分包提示，N：原生冷启动计时 |

## 4. 浏览器复跑入口

这些页面只在开发中用于复用业务组件，不用来证明磁盘持久化成功。

| 页面 | 建议操作顺序 |
| --- | --- |
| `/settings-showcase.html?width=320&scale=1.25` | 搜索设置“翻译”→重排翻译显示→切换分类→模型取消/失败状态 |
| `/entry-sidebar-showcase.html` | 125% 拖动分隔条→筛选标签笔记/Esc→100% 拉宽/125%/100%→编辑标题/返回/Esc/放弃 |
| `/library-showcase.html` | 600 篇论文→搜索 `/ 600`→排序→125%/分屏→右键→加载/失败/恢复/空列表 |
| `/reader-showcase.html` | 真实 PDF 第 2→3→4 页→查找 Evidence→书页/PageUp→800px/125% 双栏→工具菜单 |
| `/paragraph-showcase.html` | 320px→模拟逐句失败→右键翻译→检查 2 请求→逐步响应→查看整段→恢复成功→仅重试失败→检查 3 请求→切逐句 |
| `/relations-showcase.html` | 600 篇→窄窗口/125%→研究 600→点节点/打开条目/返回→错误/刷新 |

本轮最终检查上述页面没有新增浏览器 error/warn。这不能证明未经过的路径没有异常。浏览器工具的尺寸设置应以页面 `innerWidth` 和实际内容尺寸复核，结束后恢复临时尺寸。

## 5. 证据与发布前缺口

本机原始日志（临时目录可能被系统清理，重新运行以上命令可复现）：

- `%TEMP%/neuink-system-audit-frontend.json`、`neuink-system-audit-frontend.log`：971 项全量结果。
- `%TEMP%/neuink-full-rust-tests.log`：248 项通过和 4 项忽略的明细。
- `%TEMP%/neuink-system-audit-build.log`、`neuink-system-audit-cargo-check.log`：最终类型/构建/后端检查。
- `%TEMP%/neuink-workspace-baseline.log`、`neuink-sidebar-baseline.log`、`neuink-popover-baseline.log`、`neuink-page-navigation-baseline.log`：修复前新增测试的失败证据。

4 项忽略项是 `write_real_paper_review_samples`、`write_reading_export_qa_sample`、`write_review_samples`、`write_tag_notes_qa_fixture`。它们会生成供人工查看的资料或导出样本，部分需要显式样本路径与输出目录；本轮没有把这些“未执行”算作通过。

发布前必须继续完成 N 项中的原生关闭/重启、真实文件选择与保存、导出文件在 Word/WPS 中的显示、真实模型与解析端点、系统缩放及 WebView2 GPU 性能。当前未完成原生 Tauri 视觉验证，没有生成并验收发布安装包，也没有声称所有路径或性能指标已经覆盖。

现有性能测试验证的是挂载数量、调度、取消、滚动归属和资源释放；浏览器操作验证的是交互可完成及布局边界。主包体积提示与原生长时间内存/帧率测量应单独跟进，不应靠加长 hover 延迟或吞掉错误来掩盖。


## 6. 笔记定位与文内预览回归（2026-09-18）

本组浏览器入口 `/navigation-showcase.html` 使用正式阅读组件、原生 PDF 链接和 PDF.js 文字层；收藏与正文仅存于页面内存。磁盘持久化由 Rust 测试单独验证，不以浏览器示例代替。

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| LOC-01 | P1 | 右键原文→记住此处→笔记定位→收藏；正文留空 | 空笔记位置可见，显示原文摘要和页码，点击定位 | A：ReadingNotes；B：重排版标题收藏 |
| LOC-02 | P0 | 已有笔记收藏／取消收藏、清空正文、重新打开工作区 | 收藏不覆盖正文，清空正文仍保留收藏，旧 JSON 默认未收藏 | A：workspace segment_note、ReadingNotes |
| LOC-03 | P0 | 同时编辑正文和设置收藏；删除后从回收站恢复 | 两次写入互不覆盖；恢复正文和收藏元数据 | A：并发 Workspace 实例、回收站及重启测试 |
| LOC-04 | P1 | 搜索定位列表、切收藏筛选、取消收藏；模拟保存失败再重试 | 结果范围正确；失败保留已保存状态，操作可再次发起 | A：ReadingNotes；B：保存失败提示及标记保留 |
| LOC-05 | P1 | 跳到引用或收藏位置，再返回／前进；左右分屏、书页重复操作 | 恢复原阅读位置，每个面独立历史；输入区 Alt 方向键不被拦截 | A：ReadingNavigation；B：PDF 第 1→3→1 页、重排、分屏隔离 |
| REF-01 | P1 | 在真实 PDF 点击内嵌目的地链接和识别出的引用 | 优先采用 PDF 内嵌目标，解析引用仅使用唯一可用编号 | A：pdfDestinations、paperReferenceIndex；B：四页 PDF 原生图表链接与 [1] |
| REF-02 | P1 | 悬停／聚焦 Figure 3、[1, 2]，向下键打开预览，选择目标 | 图文和页码对应原文；可用键盘选择；点击不同时打开笔记 | A：PaperReferences；B：图表原图和键盘预览、定位 |
| REF-03 | P1 | 无图像资源、缺失／冲突编号、隐藏目标、损坏 PDF 目标 | 原图按需加载；无可信目标保持文字；失败明确并可重试 | A：索引和 PDF 目的地失败重试、隐藏目标提示；N：损坏真实文件端到端验收 |
| REF-04 | P2 | 320px、125%、分屏打开定位与预览；关闭、滚动、输入 | 工具栏入口可达，浮层在视口内，原 PDF 选字层不被改写 | A：既有 toolbar／HoverCard／SourceSnapshotPreview 回归；B：窄栏定位面板 |
| REF-05 | P1 | `/navigation-showcase.html?brokenReference=1`，聚焦／单击失效内置引用，向下键打开面板，再定位并返回 | 缺失目的地回退到已解析文献；第 1→4→1 页准确，正常图表链接仍优先 | A：pdfReferenceFallback、PdfReferenceLayer；B：真实 PDF 缺失命名目的地与单数字链接 |
| REF-06 | P1 | 引用分成 `[`, `12`, `]` 三个 PDF 文字片段；另一行或另一栏出现相似片段 | 同行识别，跨行／栏不拼接，原文字节点与选择保留 | A：pdfTextReferences |
| REF-07 | P1 | 失效章节／页码链接、冲突编号、组合引用、文字迟到与关闭阅读器 | 无上下文数字不误匹配文献，组合可选，加载完成后可恢复，关闭后不跳转 | A：pdfReferenceFallback、PdfReferenceLayer |
| REF-08 | P1 | 原生链接只包含目标页码，另一处有首段坐标 | 使用页级定位，不借用无关段落坐标或高亮 | A：usePdfReadingNavigation |
| REF-09 | P1 | `/navigation-showcase.html?twoColumns=1`，依次预览 [1]／[12] 并定位，目标在左右栏同一高度 | 编号、正文、栏位置一致；不因解析数组顺序改变而串号 | A：pdfReferencePreview、PdfReferenceLayer；B：真实双栏 PDF |
| REF-10 | P1 | 参考文献合并为列表，区域数组打乱并跨页；在列表预览依次悬停 | 按编号或唯一正文绑定文献与坐标，保留各条原页码，不按序号配对 | A：paperReferenceIndex、ListHoverPreview.interaction |
| REF-11 | P1 | 非等宽双栏、PDF 目的地没有横向坐标、编号与坐标冲突 | 不假设页面中线或左栏；无法确认时不展示另一篇文献 | A：pdfReferencePreview、pdfDestinations |

验证结果：前端全量 215 文件／993 项通过，其后新增的 3 项用例包含在 35 项相关回归中并通过；Rust 笔记相关 7 项通过；`cargo check --workspace` 和前端生产构建通过。最新构建日志为 `%TEMP%/neuink-bookmarks-preview-build.log`。本组尚未完成原生 Tauri 视觉验收，也不将未识别的作者年份引用、跨文件链接或无解析原文的页级收藏声称为已支持。

失效引用修订验证：11 文件／56 项相关测试与前端生产构建通过，日志为 `%TEMP%/neuink-reference-fix-build.log`。浏览器真实 PDF 验证 REF-05 及 320px／125% 预览与键盘关闭通过，无新增浏览器错误。本轮未复核用户报错的具体 PDF，原生 Tauri 视觉验收仍待完成。

双栏引用修订验证：15 文件／79 项相关测试及生产构建通过，日志为 `%TEMP%/neuink-two-column-references-build.log`。浏览器使用真实双栏 PDF、同高度不同编号及乱序解析区域核对预览与定位；原生 Tauri 视觉验收仍待完成。

## 7. 收藏菜单与默认打开方式（2026-09-19）

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| OPEN-01 | P1 | 设置搜索“默认打开PDF”→打开命中→Space 切换→切换分类／重读偏好 | 定位到“阅读与批注 / 打开条目”，选择可保存，其他阅读偏好不改变 | A：SettingsPanel、settingsCatalog、readerPreferences；B：设置搜索、键盘切换和自动保存反馈 |
| OPEN-02 | P1 | 开关开启／关闭，分别打开带 PDF、无 PDF 条目；在右侧打开 | 开启且有 PDF 时进入 PDF，否则进入概览；复用已有页签并保留标签上下文 | A：workspaceSurface；N：真实资料库各入口和重启验收 |
| OPEN-03 | P1 | 条目行单击／Enter 后，再右键“查看详情”；选择具体笔记／重排／片段搜索结果 | 默认打开受偏好控制；明确内容动作仍打开所选内容 | A：EntryLibraryView、workspaceSurface；N：真实搜索命中端到端验收 |
| LOC-06 | P2 | `/navigation-showcase.html` 右键段落→键盘记住此处→重新右键；320px、125% 重复 | 收藏／取消收藏与普通动作均为 14px 字号、14px 图标、32px 行高、6px/8px 内边距，无文字截断；保存中不重复提交 | A：SegmentActionMenu、ReadingNotes、ParagraphTranslation；B：实际组件菜单尺寸、键盘收藏、窄栏和缩放 |

验证：9 文件／128 项相关前端测试通过；类型检查和前端生产构建通过，保留已有分包提示，日志 `%TEMP%/neuink-entry-opening-build.log`。设置及阅读隔离页无新增浏览器 error/warn；偏好持久化由自动测试验证，浏览器示例不操作用户资料库。原生 Tauri 视觉验收尚未完成。

## 8. 左侧阅读标记（2026-09-19）

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| RAIL-01 | P1 | 左侧存在空正文收藏、文字笔记、批注及无记录片段 | 统一横条，仅以颜色区分记录；收藏不误计为文字笔记，空记录不产生标记 | A：SegmentRail；B：PDF／重排横条与文字预览 |
| RAIL-02 | P1 | Space 切换“只看标记”，左右分屏分别切换，再返回全部 | 只筛选所在阅读面的导航，不跳转正文或改变目录；全部入口可恢复 | A：SegmentRail；B：两侧 aria-pressed 独立变化 |
| RAIL-03 | P1 | 收藏已有笔记、取消最后一个空收藏、跨页逻辑片段重复映射 | 即时更新颜色与数量；同一逻辑位置只计一次；空筛选显示“暂无标记”并保留退出入口 | A：SegmentRail、ReadingNotes；B：右键收藏后同时显示收藏／笔记标签 |
| RAIL-04 | P1 | 标题数量超过轨道容量，正文中存在收藏；缩到 24px 高度 | 不丢正文片段，折叠后保留全部定位项；横条命中区域不重叠 | A：railLayout 的高密度及极短轨道回归 |
| RAIL-05 | P1 | 当前片段无标记，但与收藏聚合；点击标记、展开预览选择另一记录 | 点击进入收藏位置；预览可逐项选择，标签页码与目标一致 | A：SegmentRail、SegmentRailPreview；B：第 4 页收藏定位 |
| RAIL-06 | P2 | 标准／拟物／玻璃；320px、125%；聚焦标记、查看预览 | 横条外观统一，放大不改变命中范围，预览和焦点圈可见，单一预览滚动 | B：`/navigation-showcase.html?denseRail=1` 三种风格、窄栏与缩放 |
| RAIL-07 | P1 | 大量片段集中同页坐标；改变高度、添加记录、切换当前片段 | 填满可用槽位、按顺序折叠；记录与阅读位置不改变密度和分组，短轨道保留全部定位项 | A：railLayout；B：密集检查页从 50–60 条随高度收缩到 9–17 条 |
| RAIL-08 | P1 | 聚焦折叠横条，在浮层选择第 2 页批注，使用鼠标或 Enter 定位 | 仅调用一次所选片段的跳转，浮层事件不触发后方轨道点击；所选段落进入阅读区 | A：SegmentRail 真实 portal 回归；B：320px／125% 下第 2 页段落已居中显示 |

验证：初次相关 10 文件／30 项测试通过；补充浮层点击回归后 3 文件／19 项复测通过（合计覆盖 31 个相关用例）。类型检查与前端生产构建通过，日志 `%TEMP%/neuink-reader-density-build.log`，保留既有分包提示。浏览器检查动态折叠、独立筛选、键盘预览、聚合段落定位、三主题与窄栏缩放；本次不操作用户工作区，原生 Tauri 视觉验收未完成。

## 9. 宽窗口表格（2026-09-19）

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| TABLE-01 | P1 | 将论文列表放大到超过全部列的基础宽度之和 | 可见列按原比例铺满，允许超过手动列宽上限；无空白占位、横向溢出、固定阴影或竖向分隔 | A：LibraryPaperTable；B：1920px 下表格及滚动视口均为 1879px，无固定单元格 |
| TABLE-02 | P1 | 宽窗口缩窄／150% 缩放，再恢复宽度 | 溢出时按原偏好恢复首尾固定；放得下时取消效果，自动扩展不写回列宽偏好 | A：LibraryPaperTable、EntryLibraryView；B：150% 下恢复两侧 sticky 与阴影 |
| TABLE-03 | P1 | 纵向滚动条出现／消失；隐藏列、仅保留一列、显示空或加载状态 | 按实际可用宽度重新分配；表头正文对齐，消息跨越真实列数，保留唯一滚动容器 | A：LibraryPaperTable、EntryLibraryView；B：空列表及列显隐后仍无横向溢出 |
| TABLE-04 | P1 | 宽屏拖动列边界，150% 下重复；Escape、方向键与双击 | 边界跟随指针；取消不保存，方向键按展示像素调整，双击恢复基础比例 | A：LibraryPaperTable 的缩放拖动、保存、取消及键盘回归；B：宽屏标题键盘调整 371→379px |

验证：2 文件／63 项测试与前端构建通过，日志 `%TEMP%/neuink-table-fit-build.log`，保留既有分包提示。浏览器检查无新增错误或警告；原生 Tauri 最大化窗口视觉验收未完成。

## 10. 条目库和重排显示配置（2026-09-19）

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| CONTENT-01 | P1 | 打开原文模式的图片、表格，包括没有视觉组 ID 的片段 | 默认只显示原图，解析表格、Mermaid 不自动出现 | A：ReflowContent；B：真实组件检查页 |
| CONTENT-02 | P1 | 组件设置开启表格解析，关闭表格原图 | 仅影响表格，其他类型保留；图片无须重新解析 | A：ReflowComponentControls；B：解析表格显示 |
| CONTENT-03 | P1 | 单片段右键选择解析、关闭原图，换条目／资料库，再返回；恢复跟随 | 选择保存且作用域隔离，恢复后随类型设置变化 | A：ReflowContent、偏好纯函数；B：右键实时切换 |
| CONTENT-04 | P1 | 翻译此段完成后切换逐句、整段、仅译文 | 同一个片段内重排已有结果，解析文字在上、译文在下；没有额外模型请求，原图仍独立控制 | A：ParagraphTranslation、ReflowContent；B：模拟请求数始终为 2 |
| CONTENT-05 | P1 | 原图报错／无资产／PDF 不可用／截图加载完成／重试原图 | 加载状态、失败说明及重试可用；原图失败不会默认显示解析 | A：ReflowContent |
| CONTENT-06 | P1 | 关闭片段的全部显示层，再通过右键或 Shift+F10 恢复 | 保留可操作片段和提示；方向键导航、Escape 关闭正常 | A：ReflowContent；B：360px 菜单未越界 |
| CONTENT-07 | P2 | 条目库标准、玻璃风格，打开深层标签、搜索空结果，360px 窄窗口 | 标题数量同排，无多余空行；按钮/select 高度字号及边框一致，范围操作无横向溢出 | A：EntryLibraryView；B：两主题均 32px 高／12px 字号，标题和数量中心线相同 |

验证：13 文件／119 项相关测试、类型检查与生产构建通过。浏览器无新增 error/warn；测试页不访问真实模型或用户资料库。保留既有分包提示；原生 Tauri 视觉验收未完成。

原图与解析语义修订：

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| CONTENT-08 | P1 | 正文已有翻译，组合开启／关闭原图与解析内容 | 四种组合均正确，翻译始终保留；解析内容不被当作原图 | A：ReflowContent |
| CONTENT-09 | P1 | 正文无独立图片资产，按类型及右键分别切换原图／解析 | 使用真实 PDF 区域截图；支持两层同时显示，类型批量设置可被片段覆盖 | A：ReflowContent、ReflowComponentControls；B：真实 PDF 段落截图及批量切换 |
| CONTENT-10 | P1 | 仅原图模式下发起翻译，再切换整段／逐句 | 保持原图开启、解析关闭；切换排列不发送新翻译请求 | A：ReflowContent |
| CONTENT-11 | P1 | 加载带旧 original 的正文和图片偏好，同时存在新字段 | 正文旧值对应解析，图片旧值对应原图，新字段优先；稀疏覆盖保留继承 | A：reflowContentPreferences |

修订验证：10 文件／62 项相关测试、类型检查及生产构建通过。浏览器实际 PDF 截图加载成功，原图／解析独立及批量控制有效，无新增 error/warn。原生 Tauri 视觉验收未完成。

## 11. 长笔记与收藏预览（2026-09-19）

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| NOTE-HOVER-01 | P1 | `/navigation-showcase.html?longNotes=1`，打开笔记定位并预览长笔记，切换对应原文 | 两份长文分别查看，完整内容保留，切换不跳转阅读页 | A：ReadingNotes；B：45 段笔记／原文 |
| NOTE-HOVER-02 | P1 | 移入悬停浮层滚动；点击“预览”，滚到末尾再定位 | 仅正文滚动，头尾操作保持可见，点击定位仅执行一次 | A：ReadingNotes、HoverCard；B：长文末尾和第 4 页收藏定位 |
| NOTE-HOVER-03 | P1 | 右方向键打开预览，Tab 访问正文及定位，Escape 关闭 | 焦点可达，退出返回预览入口，笔记列表仍打开 | A：ReadingNotes、Popover；B：键盘完整流程 |
| NOTE-HOVER-04 | P1 | 空正文收藏、失效来源笔记、360×480 及 125% 缩放 | 空收藏直接原文，失效笔记可读且禁用定位，浮层不越界或被挤成窄条 | A：ReadingNotes；B：窄窗口／缩放边界 |

验证：4 文件／23 项相关测试、类型检查和前端构建通过；浏览器无新增 error/warn。原生 Tauri 视觉验收未完成。

## 12. 图片详情缩放与拖动（2026-09-19）

| ID | 级别 | 操作步骤 | 预期 | 证据/状态 |
| --- | --- | --- | --- | --- |
| IMAGE-01 | P1 | 重排图片点开详情；横图、长图、小图及改变窗口大小 | 窗口与图片双向居中，初始完整适应，窗口有界且小于全屏 | A：SourceSnapshotImage；B：真实 PDF 截图、360×480 |
| IMAGE-02 | P1 | 鼠标在图像偏右位置滚轮缩放，放大后左键拖动并松开 | 锚点保持，拖动跟手、松开保留，边缘受限，正文不滚动、不触发预览或定位 | A：SourceSnapshotImage；B：普通／125% 实际滚轮与拖动 |
| IMAGE-03 | P1 | 拖动中 Escape、取消指针、丢失捕获、窗口失焦及关闭 | 取消回滚，Escape 不误关窗口，捕获及监听释放；正常松开只提交一次 | A：SourceSnapshotImage |
| IMAGE-04 | P1 | 键盘加减、方向键、0、Escape；图片加载失败后重试 | 可缩放平移复位，关闭返回入口焦点；加载时禁用缩放，错误可恢复 | A：SourceSnapshotImage；B：复位与关闭焦点 |
| IMAGE-05 | P2 | 360×480 窗口开启 125% 后打开图片，查看标题、操作与提示 | 浮层不越界，工具条换行，画布保持居中且无双滚动条 | B：实际根节点缩放与几何测量 |

验证：2 文件／26 项测试、类型检查及前端构建通过；浏览器无新增 error/warn。原生 Tauri 视觉验收未完成。
