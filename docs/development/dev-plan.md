# Neuink 开发计划

> 当前状态核对：2026-07-15
>
> 本文件是实现状态与优先级的唯一维护位置。

## 1. 已形成闭环

- Entry 创建、编辑、标签/属性管理、回收站、恢复和彻底删除；
- PDF 导入、Parser 提交、轮询、状态持久化和失败重试；
- PDF.js 阅读、Segment overlay/rail、Segment Note、Annotation；
- Reflow 主要 MinerU 块、列表、公式、视觉块、隐藏、翻译展示和动态高度虚拟滚动；
- Markdown 编辑、表格、公式、Source Link、反向引用和导出脚注；
- Keyword/Semantic/Hybrid 搜索、持久化向量记录、RRF 和索引状态；
- 全文翻译、暂停/继续、失败重试和 Markdown 导出；
- Conversation 历史与 AgentRun；
- Router、TaskState、Evidence Ledger、Verifier、Verified Proposal；
- Note Proposal 的后端校验、幂等和 journal recovery；
- Entry Meta、Tag、Segment Note 等受控 Proposal 基础能力；
- Agent Skills、内置 Subagent、权限审计和进程型 MCP 工具 MVP；
- 左右 Workspace Surface、tab、分屏和 Entry Overview。

“已形成闭环”不等于已完成发行质量，回归和性能债务仍按下文处理。

## 2. 当前优先级

### P0：日常可用与数据安全

1. **Workspace 生命周期**
   - 已支持严格识别、选择、新建、最近打开、切换和迁移真实 Workspace；
   - 继续移除对开发目录或隐式默认目录的依赖；
   - 明确 Workspace 不可用、迁移和损坏时的恢复 UI。

2. **关键写入回归**
   - 覆盖 Note/Source Link/Proposal Apply 的冲突、重复提交和异常恢复；
   - 覆盖 Entry 删除恢复、解析重试和 Conversation 恢复；
   - 把 [P0 回归清单](p0-regression-checklist.md) 中的人工项目逐步自动化。

3. **统一任务体验**
   - Parser、索引、向量化和翻译统一进入 Job 状态与任务面板；
   - 统一取消、失败原因、重试和历史清理语义；
   - 不用“状态文本”代替真实进度。

4. **构建与发行基线**
   - 在干净 Windows 环境验证安装包和资源；
   - 固化模型缺失、有模型、断网三种启动路径；
   - 建立最小 CI、构建产物和发布检查。

### P1：阅读与检索工程化

1. Reflow 结构化 outline、PDF/Reflow 同步定位、导出边界和超长文档性能基准；
2. 旋转页、复杂版式、隐藏规则配置和 source anchor 正式化；
3. 搜索结果类型过滤、大结果虚拟列表和真实增量向量化；
4. Embedding 质量基准、reranker 或 ANN 的收益验证；
5. Source Link 反向索引和服务边界收口。

### P1：Agent 工程化

1. 真正从成功节点继续的 resume，而不是整条任务重跑；
2. 完整 MCP discovery/session/protocol，而不是一次性进程包装；
3. 更清晰的 Context Role UI 和任务恢复入口；
4. 扩充 Verifier、Evidence 和 Proposal 的端到端测试；
5. Parser、索引、向量化等长任务接入统一 Agent/Job 可观测性。

### P2

- Matrix；
- 知识图谱、闪卡和间隔复习；
- 第三方 UI 插件；
- 用户安装自定义 Subagent；
- 多设备同步。

## 3. 暂不实施

- 为目标架构预建空 crate、空 schema 目录或不存在的 CI；
- 将 Skill 中的任意脚本直接执行；
- 在没有规模数据前引入数据库或分布式检索服务；
- 用 Prompt 补丁代替 TaskState、权限或后端写盘校验；
- 同一实现状态在多份专项文档重复维护。

## 4. 每个切片的完成定义

- 用户可从 UI 触发并看到结果；
- 前端、IPC、Rust 服务和落盘路径闭环；
- 错误可见且有恢复方式；
- 高风险写入有冲突和重复提交测试；
- TypeScript、Rust 和相关前端测试通过；
- 同步更新本文件及必要的架构/回归文档；
- 已完成的临时方案文档不留在仓库。
