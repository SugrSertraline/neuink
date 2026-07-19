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
| `neuink-parser` | MinerU 云端和自定义端点客户端、结果归一化 |
| `neuink-search` | Keyword、Semantic、Hybrid、Embedding 与持久化向量记录 |
| `neuink-job` | 本地任务和事件状态 |
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
  conversations/
  trash/entries/
  agent-runtime/
    settings.json
    runs/
    subagents/
  agent-skills/
    registry.json
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

主要模块位于 `apps/desktop/src/modules`：

- `library`：Entry、Tag、Field 和资料库管理；
- `reader`：PDF、Reflow、Segment、翻译和右侧内容；
- `notes`：Markdown 编辑、表格、公式和 Source Link；
- `search`：全局检索、预览与索引状态；
- `assistant`：Task、Evidence、Agent loop、Verifier 和 Proposal UI；
- `annotations`、`settings`：批注聚合与配置。

`WorkspaceSurfaceLayout` 管理左右 pane、tab 和焦点。Surface 可以是 Library、Settings、Entry Overview、PDF、Reflow、Note、Segment Notes、Annotations 或 Source Links。

## 5. PDF 与 Reflow

PDF 原文由 PDF.js 渲染。Parser 输出被归一化为 `SourceSegment`，再用于：

- bbox 与 Segment rail；
- Reflow 内容；
- 搜索输入；
- Assistant evidence；
- Source Link 和批注定位；
- 全文翻译。

Reflow 是派生阅读视图，不替代 PDF 原文证据。定位和引用仍以具体 Segment 为准。

## 6. 搜索

`MemorySearchIndex` 提供关键词索引。`PersistentSemanticSearchIndex` 使用本地 Embedding 生成并保存 JSON 向量记录；Hybrid 通过 RRF 合并关键词与语义结果。

搜索缓存按 Workspace 和记录指纹失效。只有解析成功的 PDF Segment 进入 PDF grounding；Entry、Tag、Field 和 Note 不受 PDF 解析状态限制。

默认 Embedding 模型资源从 Tauri resource 的 `embedding-models/default/` 加载，不在运行时静默下载。模型缺失时语义能力不可用。

## 7. Assistant

当前链路：

```text
用户消息 + @ attachments + UI context
  -> Router / Task compiler
  -> TaskState
  -> context hydration + Evidence Ledger
  -> unified execution
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

模块的就近边界说明见 `apps/desktop/src/modules/assistant/README.md`。

## 8. 配置和安全

- Parser、LLM、Agent、MCP 和 Skills 配置通过显式设置管理；
- 主 Agent 权限限制工具、Skills、Subagent、Workspace 读取和 Proposal；
- Skill 包只提供说明与资源，脚本不因存在于 zip 中自动执行；
- MCP 工具必须经过 server 启用状态和 allowlist 校验；
- 日志和导出不得泄漏 API Key。

## 9. 架构变更原则

- 先追踪真实调用链，再修改边界；
- IPC 保持薄，用户数据写入集中在 Rust 服务；
- 新缓存必须证明可重建；
- 新写入能力必须先定义 Proposal、验证、冲突和恢复语义；
- 目标架构与当前实现必须在文档中明确区分。
