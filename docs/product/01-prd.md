# Neuink 产品需求

> 状态：持续维护
>
> 最后核对：2026-07-15

## 1. 产品定位

Neuink 是面向论文、报告、标准、书籍章节等 PDF 资料的本地优先知识工作台。它把阅读、结构化解析、可追溯笔记、检索和 AI 协作放在同一个 Workspace 中。

产品必须满足：

- 用户资料以本地普通文件为权威，不依赖外部数据库服务；
- AI 生成的论文结论必须能回到具体 PDF Segment；
- AI 不得静默修改用户笔记、标签或属性；
- 没有 LLM、Embedding 或网络时，基础阅读和编辑仍可使用。

## 2. 核心模型

### Workspace

用户选择的本地资料库。代码中统一使用 `Workspace`，UI 可称“资料库”。

### Entry

一个可管理的阅读对象。Entry 包含：

- 至多一个主 PDF；
- PDF 解析状态与 Source Segments；
- 多篇 Markdown 笔记；
- Segment Note、Annotation、Tag 和自定义 Field；
- Conversation、翻译结果和派生缓存。

主 PDF 导入后不通过普通编辑操作替换。解析失败可以复用原 PDF 重试。

### Source Segment 与 Source Link

Source Segment 是 PDF 中可定位的证据单元。Source Link 使用精确 Entry、Segment、页码和文本快照连接笔记与原文。导出的 Markdown 应保留可读脚注。

### Assistant Task

一次 Assistant 操作具有明确的任务 ID、读取上下文、证据、唯一编辑目标、授权状态和 Proposal。读取对象不自动成为写入目标。

## 3. P0 用户闭环

### 资料管理

- 创建、编辑、删除、恢复和彻底删除 Entry；
- 管理层级 Tag、自定义 Field、笔记、批注和来源链接；
- 在左右工作区打开 PDF、Reflow、笔记、概览和管理页面。

### PDF 阅读

- 导入 PDF，提交 MinerU 或兼容 Parser 解析；
- 显示解析状态并允许失败重试；
- PDF.js 原文阅读、Segment 定位、悬停预览和右键操作；
- Reflow 阅读解析后的主要文本、列表、公式、表格与视觉块；
- 全文翻译、暂停、继续、失败重试和导出。

### Markdown 笔记

- TipTap Markdown 编辑与自动保存；
- 标题、列表、引用、代码、公式、图片、提示块和表格；
- Source Link 插入、去重、展开、跳转、反向引用与导出脚注。

### 搜索

- 搜索 Entry、Tag、Field、Markdown Note、Segment Note、PDF 页面和 Segment；
- Keyword、Semantic 和 Hybrid 模式；
- Semantic 不可用时明确提示并回退，不伪装为语义结果。

### Assistant

- 使用显式 `@` 附件和当前工作区状态构建任务；
- 读取 Workspace、搜索证据、生成带来源的回答；
- 通过 Note、Segment Note、Entry Meta 等 Proposal 提议变更；
- Verifier 通过后才展示可应用 Proposal；
- Apply 由后端按 `taskId + proposalId` 读取已验证记录并写盘；
- 保存 Conversation、TaskState、AgentRun、工具过程和 Proposal 状态。

## 4. 非功能要求

- 本地文件是用户数据的唯一权威来源；
- 缓存必须可删除、可重建；
- 写盘使用原子写或带恢复日志的批量提交；
- API Key 不写入 Workspace 或导出内容；
- 目标支持 Windows、macOS；Linux 不作为当前发行承诺；
- 关键写入必须有冲突、重复 Apply 和异常恢复保护；
- 大 PDF、长对话和大搜索结果不得阻塞主要 UI。

## 5. 当前不纳入 P0

- Matrix；
- 知识图谱、闪卡和间隔复习；
- 任意第三方 UI 插件；
- 内置大语言模型；
- 把本地 MinerU/Python 模型塞入主安装包；
- 无限制自主写盘的 Agent。

## 6. 下一阶段方向

- Workspace 不可用、损坏和迁移失败时的恢复体验；
- Reflow 结构导航、长文档性能和 PDF/Reflow 同步；
- 搜索增量向量化、结果过滤和大结果列表；
- Parser、索引、向量化和翻译的统一 Job 体验；
- 完整 MCP 协议、节点级 Agent 恢复和更多可验证 Proposal；
- 可重复的安装包、签名、更新和发布流水线。

具体完成度只在 [开发计划](../development/dev-plan.md) 维护。
