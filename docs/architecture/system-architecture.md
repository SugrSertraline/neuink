# Neuink 系统架构

> 本文描述当前代码边界。未实现目标只放在开发计划，不在这里画成现状。

## 1. 总体结构

```text
React / TypeScript
  -> shared IPC wrappers
  -> Tauri commands (neuink-ipc)
  -> workspace / parser / search / job services
  -> Workspace 普通文件与可重建缓存
```

前端负责交互和 Assistant 编排；Rust 负责本地数据、解析接入、搜索、权限校验和关键写盘。

## 2. 当前 Rust crates

| crate | 职责 |
|---|---|
| `neuink-domain` | ID、Entry、Tag、PDF、Source Link 等领域类型 |
| `neuink-workspace` | Workspace 布局、原子写、Entry/Note/Annotation/Conversation 数据 |
| `neuink-parser` | MinerU 自定义端点客户端、客户端 ZIP 导入与结果归一化 |
| `neuink-search` | Keyword、Semantic、Hybrid、Embedding 与持久化向量记录 |
| `neuink-job` | 本地任务和事件状态 |
| `neuink-sciverse` | 外部文献服务客户端、请求与响应模型 |
| `neuink-config` | 安装级与 Workspace 级配置类型 |
| `neuink-ipc` | Tauri command、Assistant 后端能力和薄转发 |

不存在的独立 crate 不作为当前模块写入文档。领域继续增长时再按真实依赖拆分。

## 3. Workspace 数据

```text
<workspace>/
  neuink.workspace.json
  entries/<entry-id>/
    entry.meta.json
    paper.pdf
    paper.segments.json
    paper.annotations.json
    paper.translation.json
    segment-notes.json
    notes/<note-id>.md
    notes/<note-id>.links.json
    mineru-output/
  tag-reading/<tag-id>.json
  tag-reading/<tag-id>/notes/<note-id>.md
  tag-reading/<tag-id>/notes/<note-id>.assets/
  conversations/
  trash/entries/
  agent-runtime/
    settings.json
    runs/
  agent-skills/               # 旧版本遗留用户文件，当前不会读取或执行
  .neuink-cache/
```

规则：

- Entry、Note、Annotation、Conversation 等用户数据属于 Workspace；
- `.neuink-cache` 只放可重建派生数据；
- Note 正文和 Source Link sidecar 必须保持一致；
- 删除 Entry 先进入 trash，彻底删除是独立操作。
- 打开已有 Workspace 必须先验证 `neuink.workspace.json`；空目录只通过显式新建初始化，普通非空目录不会被静默转换；
- 切换 Workspace 在目标完整打开后才更新安装级设置，迁移则复制、验证并保留原目录。

## 4. 桌面前端

`AppearanceProvider` 拥有原有／私人书房／液态玻璃三种外观、独立书架/列表偏好及玻璃降低透明度偏好，和已有配色预设 `data-theme` 分开保存；切换只改变 `html[data-appearance]` 及资料集合的呈现，不重建 Workspace Surface 或编辑器。全局与侧栏搜索复用 `AppearanceCommand` 处理隐藏入口，命令匹配后不提交资料搜索，选择动作才切换外观。玻璃状态仅挂载限定材质及可选 `data-glass-transparency`，不引入三维渲染或窗口透明权限。`LibraryPapers` 保持原表格挂载，仅书房可展示 `LibraryPaperShelf`；两者共用过滤结果、阅读状态、`useLibraryEntryDrag` 和 `LibraryPaperContextMenu`，不引入新的工作区数据模型或 IPC。

主要模块位于 `apps/desktop/src/modules`：

- `library`：Entry、Tag、Field 和资料库管理；
- `reader`：PDF、Reflow、Segment、翻译和右侧内容；
- `notes`：Markdown 编辑、表格、公式和 Source Link；
- `search`：全局检索、预览与索引状态；
- `assistant`：Task、Evidence、Agent loop、Verifier 和 Proposal UI；
- `sciverse`：外部文献详情、服务配置与导入接入；
- `annotations`、`settings`：批注聚合与配置。

`WorkspaceSurfaceLayout` 管理左右 pane、tab 和焦点。Surface 包含 Library、Settings、Entry Overview、PDF、Reflow、Note、Owned Note、Tag Reading、Segment Notes、Annotations、Source Links 及管理页面；旧 Tag Details 仅保留受保护的兼容迁移。

编辑安全仍由既有文档笔记保存注册表、片段编辑注册表和编辑器共同负责，不新增 Tab 注册框架。`EntryWorkspaceView.editorScopeKey` 使用 `surfaceKey`，与历史 `tabValue` 分离；片段注册表兼容旧 `entry-content:<id>|...` 标识，关闭、导出和后台回收使用同一范围。`useSurfaceCloseGuard` 统一单页、关闭其他页和关闭分屏的确认：冻结目标集合，全部保存并复查无新修改后才关闭；失败时整批保留，只有明确放弃才清草稿。跨分屏移动或交换有未保存内容时阻止重挂载；同分屏排序不受影响。

Workspace 切换先保存片段笔记/批注和文档笔记，再复查；切换完成按 root 重建 ReaderPane，避免跨资料库残留共享草稿或定位。`useHeavyReaderRetention` 只回收连续空闲五分钟且无草稿的 PDF/Reflow，保存后重新计时。`useUnsavedWindowCloseGuard` 同时监听刷新和原生关闭请求，有未保存内容时阻止退出；Tauri 的已安装关闭监听 API 在允许关闭时调用 destroy，因此主窗口 capability 显式包含该权限。突然崩溃/断电的草稿恢复不在此保证内。

片段保存只确认所提交的文本快照；保存期间其他输入或分屏共享修改不会被清掉。批注等待实际保存结果，不以旧批注列表的刷新推断成功。`buildSegmentNoteLookup` 统一真实 UID 与跨页逻辑 UID 查找，供 PDF、Reflow 和片段记录复用。片段记录的读取状态由 `useSegmentRecordsData` 持有，区分初次失败/刷新失败并支持重试；刷新失败保留数据和编辑器，旧条目/旧 Workspace 的迟到响应不更新当前页。页面正文仍是原滚动所有者，错误条和确认弹窗无新增拖动协议。

### 条目概览编辑与推荐标签缓存

`EntryOverview` 持有页内编辑模式，`EntryEditPage` 复用字段／标签控件并以概览 surface key 注册未保存草稿。原 `updateWorkspaceEntry` 仍是保存入口；解析状态变化不改变元数据版本，标题、标签或属性发生外部变化时阻止覆盖。返回／关闭／资料库切换复用 `useSurfaceCloseGuard` 与 dirty registry，条目删除检查也包含概览草稿。`EntryPdfActions` 接收从 App 经 ReaderPane、EntryWorkspaceView 传递的原上传、新版和解析结果导入回调，不新增文件写入协议。

`useEntryTagSuggestions` 仅响应显式生成，调用现有 `analyzeEntryTags`；后端自行读取论文上下文，不重复在概览加载完整 PDF reader 数据。`entryTagSuggestionStore` 按资料库根路径和条目 ID 隔离缓存，同一窗口中去重进行中的生成／添加请求，迟到结果归属原键。推荐路径、选择和生成时间以 `neuink.entryTagRecommendations.v1:` 缓存在 localStorage，空结果亦可恢复；解析重跑、添加标签或关闭页面不使其自动失效，仅重新生成成功后替换。该数据可重建、不作为实际标签归属；应用推荐仍走现有追加标签接口，失败保留结果。概览和 PDF 工具条共用状态，缓存写入失败会明确告知仅当前会话可保留。

## 5. PDF 与 Reflow

PDF 原文由 PDF.js 渲染。Parser 输出被归一化为 `SourceSegment`，再用于：

- bbox 与 Segment rail；
- Reflow 内容；
- 搜索输入；
- Assistant evidence；
- Source Link 和批注定位；
- 全文翻译。

Reflow 是派生阅读视图，不替代 PDF 原文证据。定位和引用仍以具体 Segment 为准。

### 论文内容导出

PDF/Reflow 的 `PaperExportDialog` 共用 `shared/ipc/exportApi.ts`，通过薄 Tauri command 调用 `neuink-workspace::export`。服务直接读取全部归一化 Segment、译文记录和已引用的本地解析图片，组装解析全文、中文译稿或双语稿；不根据当前视图的隐藏状态裁剪内容。

检查返回覆盖清单及内容指纹。生成文件时重新核对源文本、译文和资源快照；仅未译、失效译文或缺图触发草稿，弹窗展示具体数量，并以“继续导出（含待核对内容）”按钮取得当前检查快照的显式确认，不再额外勾选。草稿保留原文/检查说明；图中文字未核验仅作提醒，不单独触发草稿或阻止导出，但仍写入检查清单，不宣称内容已经人工核验。重新检查期间保留显示结果与按钮文案，禁用导出，只有最新匹配指纹的结果可以写入。输出支持 DOCX、TXT 和 Markdown 图片 ZIP；ZIP 是整理包，不包含原 PDF、笔记或配置。导出服务限制资源读取边界、拒绝写入资料库内部，并经现有原子写保存到用户选择的外部路径。

`docx-rs` 承担 Word 生成；Markdown 和 HTML 表格经过解析，不从阅读 DOM 或可见虚拟节点截图拼接。图片有界解码后嵌入；公式保留源表示，复杂表格逐行回退。旧“生成内部译文笔记”仍是独立的已译片段汇总操作，不等同于文件导出。

内容检查清单的每项提供显式“预览”入口。`preview_paper_export` 按当前导出选项和检查指纹只读生成对应片段，不另写一套翻译/缺失判断；源快照变化时拒绝预览并提供重新检查。响应只携带当前片段引用的已校验 PNG，不暴露本地图片路径或让渲染器自行读取文档中的外部图片链接。预览使用独立有界 Dialog，可切换上一项/下一项，复用 `SourceSnapshotPreview` 的大图和大表查看；关闭后以 `preventScroll` 恢复触发按钮焦点，保留导出清单的展开和滚动位置。查看不改变核验状态或导出授权。

Mermaid 识别兼容 Figure 的 `text`、`markdown` 与 `asset_path` 同时存在的 MinerU 结果。`PaperExportOptions` 选择原图（默认）、渲染图、源码或原图附源码，并控制 Word 图片最大宽度及逐段来源编号；选项参与快照指纹。渲染模式从检查结果取得绑定片段的源码，在前端复用串行化的 Mermaid 渲染器，以严格安全设置转换为有尺寸上限的 PNG，再由后端校验图标识、数量、编码、格式与总量后嵌入。失败不写文件，也不自动修复科学图的含义。ZIP 在选择源码/渲染模式时附独立 `.mmd`；检查清单不重复携带源码。原图不可用时保留源码并报告缺失。

Word 根据 Segment 标题级别与图注角色设置语义样式，保留正文强调、代码字体和标题分页约束；原图及渲染图共享等比尺寸边界。逐段来源编号默认关闭以减少正文干扰，检查清单仍保留页码。

### 阅读成果导出

条目概览与文档笔记文件菜单共用 `ReadingExportDialog`，通过 `shared/ipc/readingExportApi.ts` → `inspect_reading_export` / `export_reading` → `neuink-workspace::export::reading` 读取已保存的 Note、Segment Note、Annotation 和成功译文片段。笔记菜单只查询当前笔记，不要求存在 PDF/解析结果；概览提供按类型筛选和显式多选，筛选不改变已选范围。

片段记录页、片段笔记/批注编辑面板、展开的译文和翻译任务通过共享 `ReadingExportButton` 就地打开同一弹窗。按钮捕获点击时的 `ReadingExportScope`（类型、具体项目 ID、片段 UID 或跨页逻辑组），检查端先求交集再读对应内容，空集合不等于全部；`scope_applied` 用于拒绝未支持范围的旧后端。页面入口默认不选，当前片段入口预选范围内项目；实际写入仍仅凭选择的 ID/指纹复查和导出。入口切换条目时关闭旧任务，主动关闭时恢复按钮焦点，不新增滚动或拖动状态所有者。

选项与任务状态由弹窗持有，复用既有笔记保存所有者和片段编辑 dirty registry。所选笔记未保存时阻止导出，用户可明确保存所选笔记并刷新，不能借导出接管只读编辑权或自动保存未选笔记。片段记录/批注有未保存草稿时提示返回阅读器处理。每项携带检查指纹；写盘前再次检查所选正文、标题、来源说明和图片，变化或删除阻止写入。

DOCX/TXT 复用现有 Word、Markdown/HTML 和图片处理模块。批量支持合并文件，或当前论文目录下每项一个 TXT/DOCX 的 ZIP，附可读索引。包内只含所选项及其引用文字；来源使用题名、物理页码、可用 DOI 和保存快照，未使用的 sidecar 引用不被展开，代码中的来源 token 保持字面量。缺图、断链和旧译文须明确确认后带提示输出；不自动下载外部图片。此入口不附原 PDF、完整译稿、未选笔记或会话；公式和 Mermaid 暂保留源码，系统级拖出尚未接入。

### 标签平行阅读（B1）

入口为条目库标签页头的“平行阅读”，以及主导航的“标签阅读”。新入口使用普通 `pdf/reflow/entry-overview/owned-note` 标签页和现有工作区左右分屏，不创建 `tag-reading` 页面。`SameTagSidebar` 复用共享列表行、搜索、筛选与滚动组件；单击在左侧阅读，行末动作打开右侧对照或条目详情。App 通过 `useSameTagContext` 分别持有会话浏览范围与活跃论文：同标签侧栏首次显示且资料加载完成时，优先用仍包含该论文的 Surface `contextTagId` 来源，其次用有效自身标签初始化；标签范围与后代筛选此后不随 Tab 或分屏焦点变化。显式 `startReading` 初始化新范围，手动选标签与“定位当前论文”是其余范围变更入口。条目库打开入口显式传递来源，搜索等直接打开入口不继承过期的条目库标签。列表从实时 Entry—Tag 关系去重生成，论文删除或取消归属后自动移出。`useLibraryReadingStates` 为条目库和侧栏复用阅读状态加载与实时更新，列表补充文件、进度、页码、时长、文档笔记数量与标签路径。已有右侧内容保留，无 PDF 的条目仍可打开概览。论文列表下方通过 `TagNotesSidebarSection` 展示当前范围的标签笔记，与论文共用标签/后代范围，各自使用 SidebarPanel 管理可折叠正文与滚动；笔记独立搜索、可折叠，目录与写入复用 WorkspaceNotesProvider/useTagNoteActions。`tagNoteOpenPane` 默认返回笔记已有位置或当前活跃区域，单击与新建不自动分屏；只有显式分屏参数才选择论文另一侧（无论文时为当前区域另一侧）。同标签与条目详情复用 SplitNoteButton，已有笔记跨区域移动仍接入原保存保护。

`TagReadingWorkspace` 保存在资料库的 `tag-reading/<TagId>.json`，是用户数据而非缓存。它保存版本/修订号、后代范围、当前/对照、顺序、标签内任务状态和布局比例，以及可选 `active_note: NoteTarget` 和 `auxiliary_view`。新增字段有兼容默认值，旧 v1 状态可继续载入。成员由当前 Entry—Tag 关系动态求出并去重，临时移出成员的历史不删除。真实文件与规范化 Segment 决定可读能力；原 PDF 尚未解析、仅有 MinerU 解析结果均可进入对应阅读器，不依赖 PDF 显示文件名。读取成员会检查范围内 Segment JSON，未引入大库资源清单索引。

`read_tag_reading` / `save_tag_reading` 在 Rust 工作区层处理持久化。保存使用基础 revision 校验及原子写；前端串行提交，保存失败保留待重试快照，冲突须重新载入，不静默覆盖。损坏或未知版本的文件报错，不自动重置。锁仅覆盖当前桌面进程的元数据操作，不承诺多进程共同写入同一资料库。

删除标签以 `neuink.workspace.json` 的 `tag_archives` 归档标签树及活跃/回收站 Entry 的关联快照，阅读状态文件留在稳定 TagId 路径。`tag-operation.journal.json` 先落盘，随后更新 Entry 元数据与 Workspace；重新打开资料库时幂等恢复。目标限定在资料库内，写前检查全部文件 hash，冲突保留恢复记录、不覆盖外部修改。统一回收站的标签列表可恢复原标签、描述、笔记、关联和阅读状态；同名/父标签缺失或关联已变化则拒绝恢复，永久删除的 Entry 不重建。故障日志遇到外部冲突仍需人工处理，未提供通用冲突解决器。

状态所有者：当前分屏与标签页由 `workspaceSurfaceReducer` 持有，单篇位置由 `EntryReadingState` 持有。`tagReadingNavigation` 只生成已有打开/移动/聚焦动作，不复制阅读器或编辑会话；跨屏移动前接入统一保存保护。切换 Tab、来源、分屏焦点或侧栏面板时保留同标签列表的范围、搜索、折叠及滚动，只更新活跃论文；聚焦配对标签笔记时沿用另一侧论文上下文。搜索属于浏览范围，只有显式范围变化、重新开始平行阅读或定位被搜索隐藏的论文时清除。选中标签被删除时保留不可用状态，工作区切换重置范围。旧 `TagReadingWorkspaceView` 和 `useTagReadingWorkspace` 仅供运行中旧页面通过关闭保护后迁移，原有阅读状态文件保留，新入口不再写入旧嵌套布局。

滚动与手势：同标签侧栏外层不滚动，路径与搜索固定；标签选择、论文与标签笔记共用 SidebarPanel，每组正文拥有一个独立 ScrollArea，标题始终可达，展开组分配剩余高度。收起保留正文挂载和滚动位置；显式定位自动展开论文区并只滚动该区；正文继续使用各阅读器的滚动容器。分隔条、宽度偏好、最小尺寸、键盘调整与拖动清理全部沿用工作区已有分屏实现，不维护标签阅读专用分隔条。PDF 按容器宽度适配，加载任务独占 Worker。

### 平行阅读文档笔记（B2 本地编辑部分）

笔记从条目详情侧栏的文档/标签笔记列表或条目库“标签笔记”栏目打开，使用普通工作区标签页；只有用户明确输入标题并创建才写文件。`ParallelNotePicker` 仅供旧阅读页面迁移期间使用。`NoteOwner` 区分 `entry` 与 `tag_reading`，`NoteTarget` 明确 owner 与 NoteId；不创建隐藏 Entry。旧 Entry 笔记格式和 IPC 保持兼容，`noteOwnerApi` 分派到旧接口或新的 `tag_note` 类型化请求，业务写盘统一在 Workspace。

综合笔记位于 `tag-reading/<TagId>/notes/<NoteId>.md`。版本、标题、来源和删除时间保存在 Markdown frontmatter 的 `neuink_note` JSON 对象中，与正文一次原子写入；没有额外的 Source Link sidecar。整份文件 hash 作为编辑 revision，创建/更新/删除/恢复受现有元数据锁保护，拒绝未知格式、损坏文件、陈旧版本和越界/重定向目录。图片写入相邻 `<NoteId>.assets`，文件内容定名；软删除保留正文和图片，恢复原 NoteId。标签归档后内容留在原 TagId 路径且不可编辑，恢复原标签后重新可读；没有永久删除及自动清理图片功能。

`OwnedNoteSurfaceView` 复用 `useOwnedNote` 持有目标加载、保存和串行来源插入队列，`MarkdownNoteEditor` 继续持有编辑与保存会话。原文和笔记分别滚动，普通工作区标签页保留未聚焦的实例。笔记沿用租约、自动保存、版本冲突、关闭保护和 Word/TXT 导出；只读编辑器不提供来源插入目标。旧嵌套笔记仍由 `useParallelNotes` 接入 `tag-reading:<TagId>/note:...` 草稿作用域，完成保存保护后才能迁移。

`ReadingSessionContext` 给现有 PDF/Reflow 传递显式文档笔记插入回调和来源定位请求。来源仍是具体 Entry/Segment/物理页码；综合笔记采用 `LinkOwner::TagNote`，同一文档可引用多篇论文，待插入项按队列消费，迟到响应不写入另一个笔记。本组来源返回工作区主读原文，本组之外的来源沿用全局原文导航。导出复用 `export::reading` 的布局、资源/目标保护和指纹复核，Word/TXT 含题名、页码和文字证据，不要求接收人安装 NeuInk。

标签笔记已接入标题筛选、独立编辑页和论文反向来源列表。尚未纳入全局搜索或 Assistant 附件/Proposal 写入；不通过伪造 Entry 接入旧 AI 写入目标。B3 证据对比也尚未实现。平行阅读入口不隐式启动模型或网络检索。


### 条目库标签上下文与笔记查询

`TagMeta.description` 默认空；`update_tag_description` 仅更新描述并校验旧描述，使用工作区元数据锁及原子写。侧栏和标签浏览中的名称单击进入已有 `library` Surface 的标签范围。App 持有 activeTag、资料库范围与“论文 / 标签笔记”栏目；EntryLibraryView 持有搜索、排序、展示方式及共同的“仅当前 / 含子标签”论文范围；TagNavigation 独立持有侧栏目录位置。LibraryHeading 合并面包屑、标题和描述，TagDescriptionField 仅在编辑时展开输入框，草稿登记在 `library/tag:<TagId>`。切换标签/资料库范围与关闭统一经过 library 关闭保护，保存失败留在原位置；切换栏目和展示方式保留组件及草稿。旧 `tag-details` Surface 仅保留兼容渲染，受保护地迁移到条目库，不再从新入口创建。

侧栏复用既有 ScrollArea，论文表格和标签笔记栏目各自持有内容滚动区域，页头不参与滚动。标签浏览整行和名称使用同一导航动作；名称按钮支持键盘，行内按钮停止冒泡；整行仍为论文拖放目标，拖入只增加标签归属。删除标签前保存受影响的描述和笔记，归档后条目库显示不可编辑状态及回收站入口。

`owned-note` Surface 使用真实 NoteTarget 打开标签笔记，返回归属会进入条目库的对应标签笔记栏目；Entry 笔记沿用原 Surface 与 IPC。`EntryTagNotesSidebar` 在左侧条目详情中提供标签笔记，概览/PDF/Reflow 顶部不再承载笔记列表或范围控件。从条目库标签范围进入论文保留 contextTagId；侧栏默认平铺论文标签及祖先、contextTagId 的笔记和引用本论文的笔记，范围与搜索仅在筛选浮层中设置。文档笔记与标签笔记复用 SidebarContentRow 并可独立折叠；useTagNoteActions 统一处理创建、保存草稿后的删除与修订检查。侧栏回收站入口进入 WorkspaceTrashView，已删除标签笔记通过 TagNotesList 的回收站展示与恢复，不在普通笔记列表保留已删除开关。单击标签笔记直接打开，显式分屏按钮才打开对照区域。左侧工具由 sidePanel 持有，打开或聚焦笔记不切换工具；详情工具通过 resolveTagNoteSidebarContext 优先显示当前标签笔记的 TagNoteDetailsSidebar，文档笔记与论文沿用条目详情。resolveEntrySidebarContext 仅为标签阅读的论文高亮与分屏定位保留配对论文上下文，不再决定标签笔记的详情内容。TagNoteDetailsSidebar 复用 WorkspaceNotesProvider 的已保存笔记目录、SidebarPaperRow、SidebarPanelGroup 与 TagNotesSidebarSection，显示归属标签、按 EntryId 去重的来源论文和当前直属标签的笔记；已删除来源保留状态提示并禁用打开。详情的定位所属标签调用 locateTag 显式更新浏览范围并清除旧搜索；普通 Tab 切换不重置标签阅读的范围、滚动和高度。描述与笔记编辑继续通过统一草稿登记及关闭保护，标签归档后显示不可编辑状态。

`read_note_catalog` 扫描条目笔记和活跃标签的笔记，返回来源、修订、删除状态和局部错误；WorkspaceNotesProvider 在 App 层供侧栏与阅读区共享，按工作区与笔记/条目变化重建，不将查询结果写成归属。有效引用解析排除行内/围栏代码和转义标记；反向来源列表通过 NoteTarget 回到真实编辑目标。

`inspect_note_sources`/`source_availability` 根据当前条目、回收站、Segment 及内容 hash 投影来源状态，Source Link 保存的文字快照不被改写。原论文移入回收站、永久删除、片段缺失或内容变化时显示原因并禁用定位；恢复和重新解析后重新检查。编辑器、来源预览、反向引用及导出复用这些状态，失效来源仍可阅读快照。

### 关系图

`relations` 是独立 WorkspaceSurface，仅从条目库页眉按钮打开，不在主导航增加工具项。统一页签状态负责创建／复用关系图页签，左侧工具保留当前选择。ReaderPane 接入当前条目、标签与 WorkspaceNotesProvider 目录。`relationGraph` 只投影标签层级、显式归属、笔记所有权和来源引用；失效来源保留节点和证据快照，不推断论文引用关系。RelationsPage 拥有查询、关系类型、聚焦和查看历史，原页面导航沿用已有条目／笔记打开路径，RelationReturnFrame 提供返回入口且不重新挂载编辑器。

RelationCanvas 使用共享 PointerPreview 和 Popover 展示悬停与节点详情。`useRelationScene` 按需加载三维适配器，协调页签、视口、窗口焦点、尺寸、主题及 WebGL 失败重试；`relationScene` 使用 3d-force-graph 和既有 Three.js 管理布局、拾取、镜头及资源。模拟坐标与可变边端点在独立副本中维护，不写盘。画布无滚动条，滚轮缩放、拖动旋转或平移；气泡正文独立滚动。隐藏时暂停，返回保持镜头，销毁释放资源；WebGL 失败保留对象列表与详情访问。

`relationPresentation` 拥有前后可见性、二维展开与镜头过渡。三维后半部节点保留 24% 不透明度，连线减弱，后侧文字收起并排除拾取；选中时用临时展示坐标展开直接关系，不改写力导向布局或业务数据。二维锁定旋转，关闭详情与退出二维分离；退出恢复进入前镜头。过渡可重定向、暂停和清理，减少动态效果即时提交。完整关系由详情列表提供，画布密度限制不构成数据过滤。节点变换统一由展示帧负责，悬停只改材质和不参与拾取的外圈；`useRelationHover` 协调文字指针、键盘焦点与画布命中，失焦和卸载清理。

## 6. 搜索

`MemorySearchIndex` 提供关键词索引。`PersistentSemanticSearchIndex` 使用本地 Embedding 生成并保存 JSON 向量记录；Hybrid 通过 RRF 合并关键词与语义结果。

搜索缓存按 Workspace 和记录指纹失效。只有解析成功的 PDF Segment 进入 PDF grounding；Entry、Tag、Field 和 Note 不受 PDF 解析状态限制。

默认 Embedding 模型资源从 Tauri resource 的 `embedding-models/default/` 加载，不在运行时静默下载。模型缺失时语义能力不可用。

## 7. Assistant

当前链路：

```text
用户消息 + @ attachments + UI context
  -> 本地请求路由（上下文门控、独立问候快捷路径、语义候选 shadow）
  -> TaskState
  -> context hydration + Evidence Ledger
  -> TypeScript Agent 实例（主/子共用循环，独立上下文，共享预算/溯源）
  -> answer and/or Proposal
  -> Verifier
  -> Conversation + AgentRun persistence
  -> user Apply/Reject
```

关键约束：

- 附件有读取、证据和编辑目标角色；
- 一个 Task 最多一个精确编辑目标；
- 模型只能生成候选内容，不能直接写 Workspace；
- Verifier 失败的输出不能作为正常 Proposal 应用；
- Note Apply 只提交 `taskId + proposalId`，后端读取不可变 Verified Proposal；
- 后端校验 digest、基础内容 hash、幂等键，并用 journal 恢复多文件提交。

明确 UI 入口的固定翻译、标签和按需记忆压缩不运行 Agent 循环。自由对话不做额外 LLM 预分类／强制规划；TS requestRouter 用当前上下文、历史和保守问候白名单决定是否省去文档／工具 hydration。Rust assistant_routing 只提供本地 E5 语义信号，复用 FastEmbed、独立惰性会话和缓存，忙碌／冷启动有界回退；候选目前仅记录用于评估，不接管 Agent 决策或授予权限。路由随任务检查点冻结，恢复不重分类；没有手动模式选择器，旧只读任务仍保留权限边界。模型连接/profile 是独立资源，工具是受权限约束的业务入口，MCP 是工具连接协议；产品不再提供 Skills 功能。AI SDK 只适配单轮模型请求；旧 Rust 单次调用子助手、自动多轮 SDK 执行和证据降级旁路已经移除。外观命令调用既有 AppearanceProvider，知识数据修改继续使用 Verified Proposal。

模块的就近边界说明见 `apps/desktop/src/modules/assistant/README.md`。

持久化执行由 `durableHarness -> durableExecution -> shared/ipc/agentExecutionApi -> neuink-workspace::agent_execution` 承担。检查点先于工具副作用保存，包含主/子 actor 消息、待执行调用、读取快照、来源账本、待审核提案和请求预算。Rust 使用原子写、CAS 与进程间文件锁拒绝陈旧写入；对话删除后不允许继续保存其任务。恢复为用户显式操作：已完成工具不重放，未完成只读工具可重试，结果不明的写操作或 MCP 必须先核对。Conversation 完成交付后确认执行终态，交付确认失败不清空已有结果。

模型调用前的上下文压缩仅改变请求投影，完整记录和特殊溯源保持不变；任务理解、主/子循环、摘要与结束记忆共用请求预算。TS 循环仍位于 WebView，Rust 不复制推理循环，重启后可从新格式检查点恢复但不会在应用关闭后继续后台执行。

## 8. 配置和安全

- Parser、LLM、Agent 和 MCP 配置通过显式设置管理；
- 主 Agent 权限限制工具、Subagent、Workspace 读取和 Proposal；
- MCP stdio 支持标准握手、同会话分页发现、调用、超时和取消；工具必须经过 server 启用、Agent 授权、allowlist 和已批准 Tool Package 校验；
- 日志和导出不得泄漏 API Key。

## 9. 架构变更原则

- 先追踪真实调用链，再修改边界；
- IPC 保持薄，用户数据写入集中在 Rust 服务；
- 新缓存必须证明可重建；
- 新写入能力必须先定义 Proposal、验证、冲突和恢复语义；
- 目标架构与当前实现必须在文档中明确区分。
