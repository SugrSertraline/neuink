import type { GuideInteractionPolicy } from './guideInteractionPolicy';

export type GuideRoute = 'library' | 'library-sidebar' | 'search' | 'tag-reading' | 'settings' | 'create' | 'pdf' | 'pdf-note' | 'note' | 'split-pdf' | 'details' | 'parser' | 'parser-zip' | 'mineru-guide' | 'models' | 'translation' | 'reflow' | 'assistant' | 'onboarding-settings' | 'none';
export type GuideSignal = 'pdf' | 'parsed' | 'translation-task' | 'translated-view' | 'split' | 'segment-editor' | 'annotation-editor' | 'document-note' | 'note-edited' | 'assistant-context' | 'assistant-sent' | 'proposal';
export type GuideStep = {
  id: string; task: string; title: string; instructions: string[]; target: string;
  relatedTarget?: string;
  targetSurface?: 'pdf' | 'reflow' | 'note' | 'entry-overview';
  targetPane?: 'left' | 'right';
  route: GuideRoute; signal?: GuideSignal; practiceOptional?: boolean; prerequisite?: 'pdf' | 'parsed';
  cue?: { label: string; target?: string };
  instructionCues?: { label: string; target: string }[];
  /** Unspecified lessons are observational; real actions must be opted into. */
  interaction?: GuideInteractionPolicy;
};
const nav = '.activitybar';
const sidebar = '.app-sidebar';
const libraryEntry = '.activitybar button[aria-label="条目库"]';
const detailsEntry = '.activitybar button[aria-label="条目详情"], .activitybar button[aria-label="笔记详情"]';
const searchEntry = '.activitybar button[aria-label="搜索"]';
const assistantEntry = '.activitybar button[aria-label="助手"]';
const tagsEntry = '.activitybar button[aria-label="标签阅读"]';
const settingsEntry = '.activitybar button[aria-label="设置"]';
const pdf = '[data-guide="pdf-page"]';
const pdfSurface = '[data-pdf-page-surface]:has([data-guide="pdf-page"] canvas[data-pdf-rendered="true"])';
const tools = '[data-guide="pdf-tools"]';
const settings = '.settings-viewport';
const assistant = '[data-assistant-context-dropzone]';
const tabs = '[data-guide="tabs"] .workspace-surface-tab.is-active';
export const GUIDE_STEPS: GuideStep[] = [
  { id:'welcome', task:'认识工作台', title:'认识左侧导航（从上到下）', route:'library', target:nav,
    instructionCues:[
      { label:'条目库', target:'.activitybar button[aria-label="条目库"]' },
      { label:'条目详情', target:'.activitybar button[aria-label="条目详情"], .activitybar button[aria-label="笔记详情"]' },
      { label:'搜索', target:'.activitybar button[aria-label="搜索"]' },
      { label:'助手', target:'.activitybar button[aria-label="助手"]' },
      { label:'标签阅读', target:'.activitybar button[aria-label="标签阅读"]' },
    ],
    instructions:['条目库：管理所有论文，按标签或阅读状态筛选，查看解析队列。','条目详情：查看当前论文的资料、标签和文件，打开 PDF、重排内容及笔记。','搜索：查找资料库中的论文、笔记和正文，打开结果或定位原文。','助手：围绕论文提问、解释内容、整理笔记，并预览和确认修改。','标签阅读：按标签汇集多篇论文和相关笔记，方便对照阅读与整理。'] },
  { id:'open-pdf', task:'准备论文', title:'打开 PDF，理解条目与标签页', route:'pdf', target:'[data-guide="pdf-page"]', targetSurface:'pdf', signal:'pdf', prerequisite:'pdf',
    cue:{ label:'演示论文 PDF' },
    instructions:['Attention Is All You Need（演示版）已自动打开，高亮区域就是 PDF 阅读页面。','演示资料已包含解析结果、阅读笔记、片段记录、批注和摘要示例译文，不需要先配置服务才能试用。','演示版是独立条目，你可以在这里练习；自己的同名论文不受影响。标签页只是阅读视图，不是另一份文件。'] },
  { id:'nav-library', task:'认识工作台', title:'条目库：管理你的论文', route:'library-sidebar', target:sidebar, relatedTarget:libraryEntry,
    cue:{ label:'条目库', target:libraryEntry },
    instructions:['高亮的书库图标是“条目库”，左侧面板已自动打开；右侧仍保留示例论文。','这里管理条目、标签分类、阅读状态和解析队列，支持搜索与筛选。','本步只认识界面，侧栏保持展开；继续即可查看下一个入口。退出引导后可点击同一入口收起或展开侧栏。'] },
  { id:'nav-details', task:'认识工作台', title:'条目详情：论文内容与笔记入口', route:'details', target:sidebar, relatedTarget:detailsEntry,
    cue:{ label:'条目详情', target:detailsEntry },
    instructions:['高亮的图标是“条目详情”，右侧相邻的面板已展示示例论文的内容入口和笔记。','这里可以打开 PDF、重排、片段记录与文档笔记，并查看标签、文件信息和解析操作。','详情跟随当前聚焦对象；打开笔记时也可能显示笔记详情。它与条目库是不同的侧栏工具。'] },
  { id:'nav-search', task:'认识工作台', title:'搜索：寻找资料库中的内容', route:'search', target:sidebar, relatedTarget:searchEntry,
    cue:{ label:'搜索', target:searchEntry },
    instructions:['高亮的放大镜是“搜索”，搜索面板已自动打开。','在这里查找资料库中的论文、笔记及可检索内容；命中结果可以打开或定位来源。','搜索资料库与让助手搜索互联网不是同一个操作。切换侧栏不会关闭右侧论文。'] },
  { id:'nav-assistant', task:'认识工作台', title:'助手：围绕论文进行问答', route:'assistant', target:sidebar, relatedTarget:assistantEntry,
    cue:{ label:'助手', target:assistantEntry },
    instructions:['高亮的对话图标是“助手”，示例 PDF 与对话面板已自动打开。','阅读对象决定这一次关联哪篇论文、笔记或标签；也可以明确选择不关联内容。','现在只认识入口，不会自动发送消息或调用模型。后续任务会指导配置、问答和修改审阅。'] },
  { id:'nav-tags', task:'认识工作台', title:'标签阅读：跨论文整理', route:'tag-reading', target:sidebar, relatedTarget:tagsEntry,
    cue:{ label:'标签阅读', target:tagsEntry },
    instructions:['高亮图标是“标签阅读”，用于按标签浏览论文和标签笔记。','例如选择“注意力机制”，可以在同一范围内比较多篇论文，左右分屏分别阅读。','没有标签时先看到空范围也正常；教程不会为了演示自动给你的论文添加标签。'] },
  { id:'nav-settings', task:'认识工作台', title:'设置：配置服务与阅读偏好', route:'settings', target:'.settings-panel-shell', relatedTarget:settingsEntry,
    cue:{ label:'设置', target:settingsEntry },
    instructions:['高亮的齿轮是“设置”，设置页已自动打开。','解析服务、聊天模型、翻译模型和阅读偏好分别在对应分类配置，不能混用地址或密钥。','“资料库与数据 → 新手引导”可以继续或回放本教程。下一步自动带你了解论文解析。'] },
  { id:'parse-choices', task:'解析论文', title:'推荐：从 MinerU 客户端导入', route:'parser-zip', target:'[data-setting-id="parser-zip"]',
    interaction:{ mode:'observe', actionTarget:'[data-setting-id="parser-zip"] button' },
    cue:{ label:'打开图文教程', target:'[data-setting-id="parser-zip"] button' },
    instructions:['PDF 是原始文件。MinerU 解析会将它拆成可定位的文字、标题、表格、图片和公式等内容块。','推荐先在 MinerU 客户端完成解析，再把完整结果 ZIP 导入 NeuInk；无需在 NeuInk 配置解析服务 URL 或 API Key。','设置页提供“查看客户端导入图文教程”。点击“已了解，继续”，系统会自动打开这份教程。'] },
  { id:'parse-zip', task:'解析论文', title:'跟随截图导入 MinerU 客户端结果', route:'mineru-guide', target:'[data-guide="mineru-tutorial"]',
    interaction:{ mode:'read', actionTarget:'[data-guide="mineru-copy-link"]' },
    cue:{ label:'复制 MinerU 链接', target:'[data-guide="mineru-copy-link"]' },
    instructions:['本页保留应用已有的 MinerU 客户端操作截图与导出说明，按截图获得完整结果 ZIP。','ZIP 应包含 content_list_v2 或兼容的 content_list，以及对应图片资源。不要只导入一张截图、单独 Markdown 或任意压缩包。','已有条目：在条目详情的文件操作中选择“导入客户端解析结果”。也可在创建条目时使用结果 ZIP 创建新条目。导入前核对它对应当前 PDF。'] },
  { id:'parse-service', task:'解析论文', title:'可选：连接自己的 MinerU 解析服务', route:'parser', target:'[data-setting-id="parser-service"]',
    interaction:{ mode:'practice' },
    cue:{ label:'MinerU 服务地址', target:'[data-setting-id="parser-service"] input' },
    instructions:['如果你有 MinerU 解析服务，可以在“MinerU URL”填写实际服务地址；服务需要密钥时再填写服务 API Key。','这是 PDF 解析服务的配置，与聊天或翻译模型的 Base URL、密钥无关。','不使用解析服务可跳过本步，前面的客户端 ZIP 导入方式仍然可用。'] },
  { id:'parsed', task:'解析论文', title:'让本篇论文具有解析结果', route:'pdf', target:pdf, targetSurface:'pdf', signal:'parsed', prerequisite:'pdf',
    instructions:['演示版已附带 MinerU 解析结果。页面中会自动描出一个真实内容块，展示解析后的位置；不需要重新解析。','自己的论文可通过解析服务提交，或在条目详情导入 MinerU 客户端结果 ZIP。','左侧解析队列区分未解析、排队中、进行中和失败，等待项可置顶或调整顺序。'] },
  { id:'blocks', task:'认识内容块', title:'什么是一个块？', route:'pdf', target:pdf, targetSurface:'pdf', prerequisite:'parsed',
    instructions:['解析后，标题、段落、列表、表格、图片、公式等各有自己的块，带页码、位置和稳定标识。页面会描出一个真实块的位置与类型；它不是任意切开的句子。','悬停、片段记录、批注、翻译和溯源都通过这些块关联原文。后续修改笔记不会覆盖原 PDF。','本步固定当前阅读位置，只观察示例块；后面的记录和批注练习可以实际操作，不会在演示中误翻页或改变布局。'] },
  { id:'hover', task:'认识内容块', title:'悬停查看原文、译文与记录', route:'pdf', target:pdf, targetSurface:'pdf', prerequisite:'parsed',
    instructions:['系统会在演示论文的一个真实内容块上展示悬停预览；你也可以自己移动鼠标到其他段落或图表。长内容可在预览中滚动、选字和复制。','“悬停配置”可选择展示原文、译文、片段记录、批注等内容，并调整预览字号和大小。没有译文时不会凭空显示翻译。','本步是展示，不强制手动悬停。正在拖选正文时，悬停会让位给选区工具条。'] },
  { id:'reflow', task:'认识内容块', title:'重排视图与原 PDF 有什么区别？', route:'reflow', target:'[data-guide="reflow-reader"]', targetSurface:'reflow', prerequisite:'parsed',
    interaction:{ mode:'read' },
    cue:{ label:'重排阅读区' },
    instructions:['系统已切到重排视图：文字、表格、公式与解析后的流程图按块展示，更方便阅读和选择。','每块的“原图”“解析内容”“翻译”是不同显示层。原图是 PDF 区域或图片，解析内容是可选取文字等，不要把文字原文误称为原图。','PDF 保留出版版面；重排更灵活。二者通过同一片段关联原文，不是两篇论文。'] },
  { id:'translation-model', task:'使用翻译', title:'先配置阅读翻译模型', route:'translation', target:'[data-setting-id="translation-model"]',
    interaction:{ mode:'practice' },
    cue:{ label:'阅读翻译模型', target:'[data-setting-id="translation-model"]' },
    instructions:['翻译需要实际可用的大模型连接。没有配置时，先在“模型与助手”新增连接，选择提供商，填写模型 ID、Base URL 和 API Key（本地模型可不需要 Key）。','回到“翻译”，指定阅读翻译模型。它用于整篇、片段、选中文字等翻译，与助手模型可以不同。','不会因进入教程自动发起请求。使用云端模型会把选中的论文内容发送给该服务，并可能产生费用。没有模型时可跳过。'] },
  { id:'translation-task', task:'使用翻译', title:'选择范围，提交整篇或部分翻译', route:'pdf', target:tools, targetSurface:'pdf', signal:'translation-task', practiceOptional:true, prerequisite:'parsed',
    interaction:{ mode:'practice', scroll:false },
    cue:{ label:'翻译任务', target:'[data-guide="pdf-tools"] button[aria-label="翻译任务"], [data-guide="pdf-tools"] button[aria-label="翻译任务进行中"], [data-guide="pdf-tools"] button[aria-label="更多 PDF 操作"]' },
    instructions:['可在 PDF 阅读操作栏点击“翻译任务”，检查内容类型和已有结果；本步也可以直接完成并继续，不必启动真实翻译。','想自己体验时，可选择参与翻译的类型，再明确点击开始翻译。失败片段可以重试；批量成功的译文保留，异常项会按顺序单条重试。','运行中可暂停或取消：暂停保留任务，之后继续；取消结束本任务，但保留已经完成的译文。打开任务面板不会退出引导，关闭后回到本步。'] },
  { id:'translation-view', task:'使用翻译', title:'切换原文与译文显示', route:'pdf', target:tools, targetSurface:'pdf', signal:'translated-view', practiceOptional:true, prerequisite:'parsed',
    interaction:{ mode:'practice', scroll:false },
    cue:{ label:'译文显示', target:'[data-guide="pdf-tools"] [data-guide="translated-mode"]' },
    instructions:['有译文后，点击阅读操作栏的“译文”，查看文字在原 PDF 位置上的覆盖显示；点击“原文”可以切回。','没有译文的文字区域显示“缺少翻译”。表格、图片、公式和算法在 PDF 译文模式仍显示原图；它们的翻译结果可在其他预览中查看。','译文显示不会修改 PDF 文件。悬停翻译是独立功能，原文或译文显示时都能用；任务完成后页面会更新结果。'] },
  { id:'selection-translation', task:'使用翻译', title:'选中文字，只翻译需要的部分', route:'pdf', target:'[data-guide="pdf-page"]:has(.pdf-text-layer span)', targetSurface:'pdf', prerequisite:'pdf',
    instructions:['系统会在演示论文中模拟拖选一小段文字和出现选区工具条，不会真的选中、发送或翻译。本步只观察，后面的批注步骤可以亲自拖选正文。','真实选区工具条可进行翻译、提问、解释或添加批注。选区翻译与整篇翻译不同，只处理当前选中的文字。','若设置开启“选中文字后自动翻译”，实际选字可能调用翻译服务；想控制费用可先关闭该偏好。本步不调用模型。'] },
  { id:'split', task:'分屏与联动', title:'复制阅读标签到另一分栏', route:'pdf', target:tabs, targetSurface:'pdf', signal:'split', practiceOptional:true, prerequisite:'pdf',
    interaction:{ mode:'practice', scroll:false, contextMenuOnly:'[data-guide="tabs"] .workspace-surface-tab.is-active',
      popupActionTarget:'[data-guide="duplicate-reading-tab"]' },
    cue:{ label:'当前阅读标签', target:'[data-guide="tabs"] .workspace-surface-tab.is-active' },
    instructions:['可在当前 PDF 标签上右键，选择“复制到另一分栏”，让同一篇论文同时出现在左右两侧；也可直接继续，下一步会自动准备两侧视图。','这只复制阅读视图，不复制 PDF 或条目。本步不需要拖动、切换或关闭标签；教程结束后也可以通过拖动标签或分屏入口打开不同内容。','工具栏的“双页”指单个阅读器并排显示两页，不等于工作区左右分屏。'] },
  { id:'split-translation', task:'分屏与联动', title:'左侧原文，右侧译文', route:'split-pdf', target:'[data-workspace-drop-pane="right"] [data-guide="pdf-tools"]', targetSurface:'pdf', targetPane:'right', prerequisite:'parsed',
    interaction:{ mode:'practice', scroll:false },
    cue:{ label:'右侧切换译文', target:'[data-workspace-drop-pane="right"] [data-guide="translated-mode"]' },
    instructions:['如果上一步没有手动复制标签，系统会在这里自动准备同一论文的两个阅读视图。先在左侧阅读器选择“原文”，再在右侧选择“译文”；每个视图可独立设置显示方式和缩放。','同一条目、同一种阅读类型的可见视图会按页码和片段内偏移联动；在一侧滚动，观察另一侧定位。无需再打开定位联动开关。','分屏、缩放不会复制内容或清空阅读进度。不同论文不要理解成页码逐一同步，同一文档的编辑同步也不是跨设备协作。'] },
  { id:'split-note', task:'分屏与联动', title:'论文与笔记对照、来源定位', route:'details', target:'.app-sidebar',
    interaction:{ mode:'observe', actionTarget:'[data-guide="entry-document-notes"] button[title="在 PDF 旁打开"]' },
    cue:{ label:'在 PDF 旁打开', target:'[data-guide="entry-document-notes"] button[title="在 PDF 旁打开"]' },
    instructions:['在条目详情找到文档笔记，点击该笔记行末的“在 PDF 旁打开”，让一侧读论文、另一侧写笔记。','笔记中的来源组件可以点击定位对应论文和片段；论文中的相关记录也能打开对应笔记。定位联动不等于强制把不同内容的滚动条绑在一起。','同一窗口内复制同一文档笔记时，共享正文与保存队列，但光标和撤销历史独立。未保存、冲突和保存失败仍需处理。'] },
  { id:'note-types', task:'记录与溯源', title:'三种记录，分别解决什么问题？', route:'details', target:'.app-sidebar',
    instructionCues:[
      { label:'片段记录', target:'[data-guide="entry-segment-notes"]' },
      { label:'批注也在片段记录', target:'[data-guide="entry-segment-notes"]' },
      { label:'文档笔记', target:'[data-guide="entry-document-notes"]' },
    ],
    instructions:['片段记录（片段笔记）：绑定一个原文块的短记录，适合记“这一段的理解”。','批注：绑定一个块或具体文字选区，可以保留高亮位置、颜色和说明，适合记“这句话值得注意”。','文档笔记：独立 Markdown 文档，适合整理整篇论文、跨段总结、表格和思维导图；插入来源组件后可回到原文。三者不是同一个存储对象。'] },
  { id:'segment-note', task:'记录与溯源', title:'给一个段落写片段记录', route:'pdf', target:pdfSurface, targetSurface:'pdf', signal:'segment-editor', practiceOptional:true, prerequisite:'parsed',
    interaction:{ mode:'practice' },
    cue:{ label:'右键解析段落', target:'[data-pdf-page-surface] [data-segment-uid]' },
    instructions:['在一个已解析段落上右键，选择“编辑片段笔记（浮窗）”；如果设置采用点击或 Alt + 点击，也可以使用该手势。','在打开的编辑区域输入自己的理解，然后点击保存。不要把翻译结果当作自己的阅读记录。','教程检测编辑入口已打开；保存是否成功以编辑器反馈为准。重新打开同一段落可以查看记录，导航轨道也可帮助定位。'] },
  { id:'annotation', task:'记录与溯源', title:'给具体文字添加批注', route:'pdf', target:pdf, targetSurface:'pdf', signal:'annotation-editor', practiceOptional:true, prerequisite:'pdf',
    interaction:{ mode:'practice' },
    cue:{ label:'拖选正文文字', target:'[data-guide="pdf-page"] .pdf-text-layer span' },
    instructions:['在 PDF 正文拖选一小段文字，再在选区工具条中选择批注；设置高亮颜色或重要程度，并填写说明后保存。','整块批注指向块，文字选区批注指向确切文字和区域。选区没有解析时仍可保留页级位置，不会猜测对应块。','这一操作会让位于选字，不与悬停争抢层级；保存后的批注可从轨道、页边入口或片段记录页面返回查看。'] },
  { id:'document-note', task:'记录与溯源', title:'创建论文的文档笔记', route:'details', target:'.app-sidebar', signal:'document-note', practiceOptional:true, prerequisite:'pdf',
    interaction:{ mode:'practice', scroll:false },
    cue:{ label:'新建文档笔记', target:'[data-guide="entry-document-notes"] button[aria-label="新建文档笔记"]' },
    instructions:['演示论文已有文档笔记，可以直接继续；若想练习创建，在左侧条目详情的“文档笔记”分组点击“新建文档笔记”，系统会创建“未命名笔记”并打开编辑页，之后可修改标题。','可以写三个小标题：问题、方法、我的理解。文档笔记支持引用、公式、表格与 Mermaid 图表。','标签笔记用于某个标签范围的跨论文整理，与属于一篇论文的文档笔记不同。创建完成不等于正文已经保存；下一步会自动打开现有或新建的笔记。'] },
  { id:'write-note', task:'记录与溯源', title:'输入、保存，并核对状态', route:'note', target:'.markdown-note-scroll .tiptap', targetSurface:'note', signal:'note-edited', practiceOptional:true,
    interaction:{ mode:'practice' },
    cue:{ label:'笔记正文' },
    instructions:['系统已打开演示论文最近的文档笔记。若想练习，可以输入一两句自己的总结，使用格式工具栏或 Markdown 快捷输入。','使用 Ctrl/Cmd + S 保存，并检查“已保存”反馈；若显示未保存、失败或冲突，先处理，再关闭。直接继续不会改写笔记。','不要通过关闭窗口来模拟保存。分屏写同一笔记时，两侧内容会共享，但不会取消保存保护。'] },
  { id:'source-note', task:'记录与溯源', title:'把原文来源放进笔记正文', route:'pdf-note', target:pdfSurface, targetSurface:'pdf', prerequisite:'parsed',
    interaction:{ mode:'practice' },
    cue:{ label:'右键原文片段', target:'[data-pdf-page-surface] [data-segment-uid]' },
    instructions:['系统已将演示 PDF 与最新文档笔记并排打开。在高亮原文段落或图表上右键，选择“插入到分屏笔记”；也可选择“复制来源链接”后在目标笔记中粘贴。','来源组件包含论文、页码和片段信息，可放在正文中间；点击可跳回原文。引用快照用于原文失效时保留上下文。','核对插入位置并保存；教程不会代替你改写笔记或插入虚构来源。如果笔记未自动出现，先到条目详情新建文档笔记，再回放本步。'] },
  { id:'assistant-model', task:'使用大模型助手', title:'配置助手模型，了解数据范围', route:'models', target:settings,
    interaction:{ mode:'practice' },
    cue:{ label:'新增模型连接', target:'[data-setting-id="models-connections"] button' },
    instructions:['在“模型与助手”创建或选择可用连接，并指定助手对话模型。公开预设只帮助填写模型参数，不代表你已经拥有该接口权限。','助手可以读论文、解释术语、比较方法、整理笔记与图表，也可以调用系统提供的论文或网页检索工具。','真实 API 请求可能产生费用。配置是用户自己的连接，不需要为教程启用子助手、MCP 或所谓 skills。没有连接时可跳过后续调用。'] },
  { id:'assistant-context', task:'使用大模型助手', title:'明确这一次让助手读什么', route:'assistant', target:assistant, signal:'assistant-context', practiceOptional:true, prerequisite:'pdf',
    interaction:{ mode:'practice' },
    cue:{ label:'选择元素', target:'[data-guide="context-picker"]' },
    instructions:['本篇 PDF 与左侧助手面板已自动打开。阅读对象默认跟随当前活跃阅读标签；核对为教学论文即可继续，不必重复选择。','如想固定对象，可用“选择元素”按标签 / 条目 / PDF / 笔记挑选具体对象；在输入文字中输入 @ 可按文件名检索并附加内容。','也可取消阅读对象，选择“不关联内容”，进行普通聊天。发送时会冻结本次阅读范围，之后切换标签不会偷偷替换正在运行的任务对象。'] },
  { id:'assistant-send', task:'使用大模型助手', title:'尝试一次带来源的问答', route:'assistant', target:assistant, signal:'assistant-sent', practiceOptional:true, prerequisite:'pdf',
    interaction:{ mode:'practice' },
    cue:{ label:'发送问题', target:'[data-guide="assistant-send"]' },
    instructions:['如果已配置模型，可输入：“请根据这篇论文，解释 Self-Attention 与 Multi-Head Attention 的区别，并给出原文来源。”核对阅读对象后由你点击发送；没有模型时可直接继续，不会发起请求。','助手汇总工具返回的证据，再呈现回答。点击来源检查页码与原文；未解析时只能使用可读取的 PDF 文字，OCR、图像及覆盖范围可能受限。','教程只检测你的发送操作，不把它当作模型已经成功回答。请求失败时查看提示；等待期间可换标签或新建对话，原任务在应用运行期间留在后台。'] },
  { id:'assistant-proposal', task:'使用大模型助手', title:'让助手整理笔记，先预览再确认', route:'assistant', target:assistant,
    interaction:{ mode:'practice' },
    cue:{ label:'输入整理要求', target:'[data-assistant-context-dropzone] [data-material="composer"] .tiptap' },
    instructions:['如果上一步已得到回答，可以继续要求：“把刚才的解释整理成思维导图，并追加到我的 Transformer 阅读笔记。”没有发送过问题时，也可以直接提出完整整理要求；用选择元素或 @ 明确目标笔记。','助手可能先让你澄清范围，也可能生成图表及修改提案。图表由应用渲染；提案中的“在笔记中查看修改”打开右侧审阅标签。','先看渲染后的新增 / 删除 / 修改差异，再选择确认或忽略。对话里说“同意”不代替应用的写入确认；未确认的提案不会直接覆盖笔记。'] },
  { id:'tags', task:'收尾与继续探索', title:'用中文标签组织论文', route:'details', target:'.entry-overview', targetSurface:'entry-overview',
    interaction:{ mode:'practice' },
    cue:{ label:'生成推荐标签', target:'[data-guide="entry-tags"] button' },
    instructions:['可手动添加“注意力机制”“自然语言处理”等与你实际阅读内容一致的标签，或使用推荐标签并检查后添加。','“标签阅读”会按你选中的标签范围列出论文和标签笔记，适合跨论文比较；选标签不是自动创建另一个论文副本。','助手还能检索论文、推荐候选并在你确认后导入 PDF。下载成功不等于解析完成，也不会自动替你写笔记或加标签。'] },
  { id:'finish', task:'收尾与继续探索', title:'完成引导，回到自己的研究', route:'none', target:nav,
    instructions:['你已了解导入与解析、内容块、翻译、分屏、片段记录、批注、文档笔记、溯源和助手。跳过的步骤仍会单独显示，不算完成。','示例论文和你创建的记录保留在当前资料库。回放教程只重置教程进度，不删除笔记，不覆盖示例，也不重复自动提交请求。','以后在设置 → 资料库与数据 → 新手引导继续或重新开始。'] },
];
export const GUIDE_TASKS = [...new Set(GUIDE_STEPS.map(step => step.task))];
