# arxiv_search 职责与当前合同

## 职责链

```text
assistant sdk / Agent
  生成结构化查询；结果进入回答、候选展示和论文操作记录
↓
shared/ipc/researchApi.ts
  运输请求与结果，不持有搜索或下载策略
↓
neuink-ipc research.rs / arxiv_query / arxiv_runtime
  校验查询，执行分页、身份对齐和结果归一化
↓
arxiv_gate + arxiv_http / arxiv_feed
  统一调度 arXiv API 请求并解析响应
↓
arxiv_cache / 候选展示 / 显式批准的导入
  缓存完整记录；展示候选；仅在授权后交给既有下载与入库路径
```

每日推荐、旧 `search_papers`、深度研究和 `arxiv_search` 的 arXiv API 请求共用 Rust 门卫。推荐 Python 只运输请求并使用 `arxiv.py` 解析；PDF 下载与 API 搜索分属不同路径。

## 当前边界

- `arxiv_search` 是只读搜索，不自动下载。查看候选与下载授权分开；下载沿用既有预览、确认、去重和入库流程。
- 新检索缓存与旧论文缓存分开。来源或历史记录不完整时可以展示，但不得据此批准导入。
- 请求排队最多 8 项，前一请求结束后间隔 3 秒；排队上限 30 秒，单请求上限 25 秒。临时错误最多额外重试一次；429 不重试，按共同冷却记录处理。
- 工具调用、缓存、下载和写入的授权各自独立。搜索成功不能当作完整原生交互、真实模型、长期公网稳定性或下载验收。

## 文档与证据归属

功能状态与后续任务只记在 [`dev-plan.md`](../dev-plan.md)。本文件维护稳定职责和合同；[`VERIFICATION.md`](VERIFICATION.md) 只保留最近验收摘要、边界和本机证据归档索引。阶段计划、报告、会议材料、旧交接稿、探针和原始证据已完整移入仓库根目录 `.local-archive/arxiv-search/2026-11-06/`，该目录由 `.gitignore` 排除，仅供当前工作副本留存。
