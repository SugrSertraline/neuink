# 统一检索工具（search_library）基线报告

日期：2026-11-04。本文只引用已冻结的产物，不新增评测、不重新排名、不改动源码。

每项结论按来源分为两类：
- **已冻结事实**：数值与路径取自冻结报告或清单，并已逐项核对。
- **待评测项**：本文未测量，列在第 5 节。

## 1. 基线结论

- 生产默认检索为 `Legacy`，章节 alpha 为 `0`。源码：`crates/neuink-ipc/src/commands/search.rs:32`（`BOOKRAG_SECTION_ALPHA = 0.0`）与 `search.rs:507`（`production_hybrid_policy` 返回 `HybridPolicy::Legacy`）。
- `search_library` 的规划（`use_planning`）关闭时，每个问题直接按原问题检索，不拆解、不调用模型，内部走 `search_segments`（mode 为 `hybrid`）并进入 `Legacy`。代码路径见第 4 节。
- 规划是显式可选项（`use_planning: true` 才启用）。它的分类质量、过度拆分率与子任务覆盖尚未在任何冻结产物中测量，见第 5 节。

## 2. 标注集（Qasper-v2）

- 路径：`D:\dev\neuink-bench\data\qasper-v2\{select,gate,test}`，清单为同目录下的 `manifest.json`。
- 清单 schema：`neuink-qasper-v2/1`，seed：`20261103`。
- 划分与题数（已与清单 `splits.*.counts` 核对）：

| 划分 | 篇数 | 题数（queries） | qrels | 清单 manifest_sha256 |
|---|---|---|---|---|
| select | 140 | 455 | 1113 | `1e9860f6…a731d` |
| gate | 141 | 467 | 936 | `c70f56f8…02e1` |
| test | 416 | 1350 | 3713 | `1aa85b9f…de8f` |

- 原始来源（清单 `source_sha256`，已用 `sha256sum` 重新计算并一致）：
  - `D:\dev\neuink-bench\data\qasper\qasper-dev-v0.3.json`，SHA256 `2ae7ee62a65b1c4225791c70de80c2aad4e8998cf1fd4f09a53103db4f21af93`
  - `D:\dev\neuink-bench\data\qasper\qasper-test-v0.3.json`，SHA256 `6e29ad410e6e39aa1936017fb965b30a20eb2e7751997f55b97c9d281aa884e5`
- 转换器与审阅记录（清单记录值，未重新计算）：`qasper-v2.mjs` `af3756220fc530ee2aeb5b1b4f699476c995dd138c6fc9862e2eaeefb3afb0c2`，`qasper-v2-data.mjs` `b57aaba11b213f88e1e93b8f9a872d7074bb307627d668a6f11aff317a1f6a3c`，审阅文件 `review_sha256` `b150955fd09342ec9c64296996da3fb165bf83047a0316b49fca434c233a880b`。
- 划分方法：按 `sha256('20261103:' + paper_id)` 升序，前 140 篇为 select，其余 141 篇为 gate。test 为独立的 416 篇保留集。
- 排除规则为整题排除，不保留部分 qrels。排除原因见清单，例如 select 排除 33 条无可回答标注与 8 条无非空证据。
- float 只映射到归一化后完全相同的图表标题，所在章节未知。因此 float 只依据 caption 文本匹配，不能证明表格内容被理解。

## 3. 检索基线（Legacy，冻结数值）

nDCG@10 / R@10，Overall 切片，均为 `Legacy`。

| 划分 | nDCG@10 | R@10 | 出处 |
|---|---|---|---|
| select（455 题） | 0.4206 | 0.6254 | `D:\neuink-orchestration\bookrag-lite-acceptance.md` 第 5 节（第 68 行），来源 `select-final-v5-report.json` |
| gate（467 题） | 0.4263 | 0.6438 | 同一文件第 6 节（第 102 行），来源 `gate-report-v5.json` |
| test（1350 题） | 0.4413 | 0.6183 | 同一文件第 6 节（第 102 行），来源 `test-report-v5.json` |

- 指标计算使用 2000 次论文簇 bootstrap，seed `20261103`。
- test 的结果属于事后分析的冻结评估，未用于调整参数、候选或默认。
- 选择阶段的 H1 方法在 select 上 Overall 为 0.4388 / 0.6406，在 test 上为 0.4624 / 0.6392。H1 未被采用为生产默认，原因见验收报告第 0 节（COVID 回归双指标点估计失败）。本文的基线仅指 Legacy。

## 4. search_library 基线映射

以下内容是代码路径核对，不是测量结果。

- 工具定义：`apps/desktop/src/modules/assistant/sdk/tools.ts:669` 起，`use_planning` 仅在 `object.use_planning === true` 时为真（`tools.ts:690`）。schema 中没有显式默认值，未传时等同于 `false`。
- 规划关闭时：`searchLibrary.ts` 直接构造 `planning.status` 为 `disabled` 的计划，`question_types: ['single']`、`retrieval_tasks: []`、`attempts: 0`，不调用模型，也不调用 `fallbackDirectPlan`。规划函数的回退逻辑位于 `apps/desktop/src/modules/assistant/sdk/retrievalPlanning.ts:121`，只在规划已请求且失败时使用。
- 检索回调：`tools.ts:715` 处 `mode: 'hybrid'`，调用 `search_segments`。
- 后端：`crates/neuink-ipc/src/commands/search.rs` 的 `search_segments` 调用 `run_search_bundle`。该函数对每个查询执行 `recall_candidates`，策略由 `production_hybrid_policy` 给出，即 `Legacy`（`search.rs:507`）。章节重排因 alpha 为 0 而不执行。

**需要注意的输出差异：** 规划关闭（`use_planning` 未传或为 `false`）时，返回的 `planning.status` 为 `disabled`，`planning.reason` 缺省，不附带规划相关警告。这表示规划未被请求，不是降级。只有 `use_planning: true` 且规划失败回退时，`planning.status` 才为 `degraded`，并附带 `planning.reason`（如 `no_model_configured`、`plan_invalid`）。统计降级分布时仍需区分两者：降级比例的分母应只包含 `use_planning: true` 的调用。

**证据关联：** 代码按 `task_id` 将证据分组（`TaskResult`）。本次未逐行核对 `entry_id` 与 `segment_uid` 如何参与关联，这一点仍需代码核对。

**范围：** 代码中的 `scope.status` 包含 `empty`、`full_library` 以及带 `scope_kind` 的范围。`empty` 直接返回空结果，不检索。

**与 Qasper 基线的关系：** Qasper 评测器不调用 `search_library`。`D:\dev\neuink-bench\src\bookrag.rs:779` 与 `:825` 直接以 `HybridPolicy::Legacy` 调用 `recall_candidates`。它与 IPC 路径使用同一个检索函数和同一策略，因此两者在代码层面相近。但调用入口、候选窗口与 top_k 截断方式不同（IPC 的 `search_segments` 将 top_k 限制在 1 到 20）。两条路径的输出是否逐题一致，本次未测量。

## 5. 尚未测量的项（后续工作）

以下项目均不在本次基线中，也没有冻结数值。

1. 规划分类质量：问题类型判断的准确率。
2. 过度拆分率：单跳问题被错误拆解的比例。
3. 按子任务的证据覆盖：每个子任务是否取到证据。
4. 降级路径分布：在 Qasper 上，`planning.status` 为 `degraded` 的比例及其原因（需按第 4 节的说明区分）。
5. 多目标、跨论文、全局、多步依赖问题的表现。Qasper 为单跳标注，无法覆盖这些类型，需另行构造评测集。
6. search_library 输出与 `Legacy` 基线逐题一致性（第 4 节的代码推断尚未验证）。

规划能力已实现（见 `retrieval-tool-completion-plan.md` 第 8 节），但其分类与拆解质量尚未评测，不能写成已验证。以上各项在测量前均视为待评测。

本次实现（统一批量检索、任务状态、范围意图、原问题冻结、检查点中的冻结检索范围）未运行上述 Qasper 评测。第 2 至 4 节中的 Qasper 指标仍是旧基线，不是本次实现的新结果。

测试覆盖：前端单元与接线测试；Rust 的批量收集隔离测试，以及内存索引上 `run_single_query` 与 `collect_segments_batch` 的逐项一致性测试、`scope_intent` 序列化与持久化往返测试（已通过 cargo 验证：搜索 IPC 15 项、会话 IPC 5 项，另有底层搜索 52 项通过）。

原生开发应用冒烟使用隔离的合成论文与本地确定性模型端点：默认提供 `search_library`；规划状态为 planned、attempts=1、question_types 为 single；真实 Tauri 批量调用返回 `retrieved`，模式 `hybrid_fallback_keyword` 并附安全警告；界面渲染 42 位参与者及 S1 来源。该冒烟只验证接线，不是真实模型验证，也不代表召回质量。真实模型端到端验证与检索质量评测尚未完成。全量前端 3,104 项通过、3 项按配置跳过、0 项失败，TypeScript 检查通过。最终修订已完成原生窗口复测：全库检索、界面固定单篇 Beta 后仅返回 Beta 证据，以及 Alpha/Beta 两个子任务分别绑定论文并显示 42 人 [S1]、24 人 [S2]。复测仍使用隔离合成资料与本地固定模型响应，不计作真实模型拆解质量或真实语料召回率评测。

## 6. 复现方式

- 既有评测工具：`D:\dev\neuink-bench\tools\evaluate-qasper-v2.mjs` 与 `D:\dev\neuink-bench\tools\bookrag-v2-runner.mjs`。二者只被引用，本次未修改，也未运行。
- bench 二进制源码：`D:\dev\neuink-bench\src\bookrag.rs`。
- 冻结报告：`D:\neuink-orchestration\bookrag-lite-acceptance.md`，证据索引见其第 12 节。
- 冻结结果文件位于 `D:\dev\neuink-bench\results\bookrag-v2\`，例如 `select-final-v5-report.json`、`gate-report-v5.json`、`test-report-v5.json`。
- 清单：`D:\dev\neuink-bench\data\qasper-v2\manifest.json`。
