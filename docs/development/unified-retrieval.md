# 统一检索：文档级路由 + 载体绑定 + 双通道旁路

状态：已接入 `neuink-search` 与 `search_unified` IPC，宿主默认未开启。前端 `unifiedRetrieval` 为宿主级开关，当前生产代码尚未设置，因此助手默认仍走 `search_segments_batch`。

## 1. 组合依据

三个来源的实测各自只覆盖一层，单独看都不构成完整管线；合并顺序由符号与增益决定。

| 机制 | 生效层 | 实测 | 结论 |
|---|---|---|---|
| 文档头宽度 20 / 文档上限 20 | 文档路由 | DAPR 271 题：文档级召回 95.20% → 97.05%，CI [+0.79, +4.55] | 开启，默认值取 20/20 |
| 引用追加池 8 | 文档路由 | HotpotQA 524k 篇：@6 76.6% → 89.1%，@10 77.1% → 85.9% | 仅追加在排序之后，不改名次 |
| 子需求拆解 | 证据层 | 同批拆解：BM25 −0.73pp，cross-encoder +5.24pp | 只进证据层，文档层禁止 |
| 命名载体切池 | 证据层 | MultiHopRAG 1558 题：e5-small R@1 +12.71pp（198 改善 / 0 退化），BM25 +5.84pp，BGE-M3 +8.54pp | 明确编号才绑，未编号不猜 |
| 视觉旁路父级聚合 | 文档候选 | DocVQA500：region 0.344、parent 0.340、双路 RRF 0.380 R@10 | 一页一票，不可整页与 region 各投一次 |
| 门控追加（`append_gated`） | 文档候选 | DocVQA100：文本 0.36@10 → 追加后 0.41@11 | 默认策略；文本顺序不变，仅门控打开时追加 |
| 加权融合（`weighted`） | 文档候选 | DocVQA500 双路 RRF 0.380 | 可选；会重排头部，错误视觉信号会挤掉正确文本命中 |
| 字段覆盖 50/50 | 排序 | 全池 0.486 R@10 / 0.366 nDCG@5；受限窗 0.454 / 0.342（上限 0.648） | 收益仍在但绝对值下降，须按池报告 |

被否定的做法一并记录：规则拆解 −2.32pp；语义 kNN 图在 5.2M 语料覆盖率 0.00245%；传播打分 γ=1 掉 7.8pp；把 BGE 排名再次加入融合（三重加权）nDCG@5 从 0.366 降到 0.329。

## 2. 管线顺序

```text
整题 → 文本召回（BM25+E5，无章节/类型限制）
     ∥ 视觉旁路（就绪时）：region 折叠到 parent，一页一票
     → 入口 RRF（文本 1.0 / 视觉 0.5）→ 与冻结范围取交集
     → 文档头（head 20 / cap 20；点名论文单独传入，不被 cap 挤掉）
     → 载体绑定（唯一编号才收窄；多编号/无编号只报告）
     → 每个证据子问题在路由文档内检索（子问题不改变路由集合）
     → 载体收窄为空则退回文档范围并记录 carrier_empty_fallback
```

不变量由结构保证而非约定：路由只读 `question`，`sub_questions` 只在证据阶段出现，`run_unified` 里没有任何路径能让子问题修改 `RoutingStage.documents`。测试 `sub_questions_never_change_the_routed_documents` 固定这一点。

## 3. 契约与降级

- `search_unified` 独立于 `search_segments_batch`，批次请求与结果形状不变；旧调用不受影响。
- 固定降级码：`visual_disabled`、`visual_unavailable`、`visual_no_allowed_entries`、`carrier_unnumbered`、`carrier_multiple`、`carrier_empty_fallback`、`no_documents`。前端持有文案，后端不返回路径或正文。
- 路由为空直接返回空证据，绝不把空集合透传成“全库”。`out_of_scope_entries_from_a_channel_are_dropped` 覆盖通道越界。
- 视觉通道当前恒为 `Disabled`：产品没有视觉索引与编码器，模型侧只留 `VisualRecall` trait。`VisualChannelStatus::Ready` 之前不得宣称已启用多模态召回。
- 证据仍只来自文本通道的片段，来源走既有 `formatSearchSegmentsOutput` 与来源账本；视觉候选只作为文档层投票，不生成正文摘录。

## 4. 验证

| 命令 | 结果 |
|---|---|
| `cargo test -p neuink-search --lib` | 181 通过，0 失败 |
| `cargo test -p neuink-ipc --lib commands::search` | 60 通过，2 忽略 |
| `npm --workspace apps/desktop exec tsc -- --noEmit` | 退出码 0 |
| `vitest run -- src/modules/assistant/sdk` | 41 文件 / 441 测试通过，3 跳过 |

覆盖点：路由读头且不受证据过滤影响、点名论文保住 cap、空路由不扩散、通道越界丢弃、视觉缺席降级、载体收窄与空结果回退、未编号不绑定、融合同分确定性、请求取消后不注册来源。

未验证：真实 E5 与真实语料的整合排序质量、原生 Tauri 界面、视觉编码器接线。`cargo check -p neuink-ipc` 一度因其他会话在 `neuink-config` 的改动产生陈旧构建产物而失败，`cargo clean -p neuink-config -p neuink-ipc` 后通过；该失败与本次改动无关。

## 5. 评测口径问题（已于 2026-11-14 修正）

1. **候选池已改为显式参数。** 冻结版 `field_rerank_docvqa500.py` 的 docstring 写 "top50"，代码实际取 `BGE top50 ∪ 全量 Qwen 父级排名` = 500 页全池，min-max 也在全池内做。修正后由 `field_pool_ablation.py` 同表报告三档池（`field-pool-ablation.md`）。受限窗结果：`bge50∪qwen50` 均池 88.55 页、金标可达 324/500、上限 0.648、`field_0.5` 达 0.454/0.342；`bge50∪qwen20` 均池 64.54、可达 284/500、上限 0.568、达 0.452/0.344。`rrf_only` 三档均为 0.380，说明浅池已包含该排序，字段增益从 +0.106 收窄到 +0.074。**跨池绝对值不可比。**
2. **VLM 门控已证伪。** 冻结版触发用 `gold_rank`、候选集追加金标页，`0.90 R@10` 是"含金标页的 11 元集合内排序"，与全池 0.486 不可比。`vlm_gate_v2.py` 用候选侧信号重新标定（dev/holdout 按 `index % 2` 固定划分）：所有 gold-free 规则在 ≤3% 触发率下只覆盖 ≤3% 的失败查询（冻结规则 `field<=0.20`：holdout 触发率 0.02、精度 0.80、失败召回 0.0312）。结论：现有可观测信号不支持把 VLM 作为生产开关。
3. **命名载体切池**的证据仍来自 MultiHopRAG，问题直接点名来源且点名与金标一致率接近 100%，证明的是"用命名载体的价值"，不等于论文图表识别能力。

旧的 v1 产物已移入 `out/vidore-v1/archive-v1/`，相关脚本加了 oracle 运行时警告。

## 6. 未启用项

- 引用追加池：`neuink-search` 尚未包含引用抽取与扩池，`document_head` 只完成了头部选择。接入需要引用抽取器与独立的可重建引用索引。
- 图表资产不再复制：`images/**` 直接从已存 `<entry>/mineru-output/full.zip` 读取（`entry_assets.rs` 只读），`asset_path` 与 ZIP 相对路径一致。此前的 `<entry>/assets/` 副本、`assets.manifest.json` 与 `backfill_entry_assets` 回填命令一并移除——老库与新建库行为一致，无需迁移。
- **页面与区域源来自原生 PDF，图表资产来自 MinerU，二者同进一个快照**（`VisualSourceKind::{Page,Region,Figure,Table}`）。页面与四个 region 共享同一 `parent`（`page:{idx}`），所以一页只投一票，region 只用来取最大分；资产按 `asset:images/...` 独立投票。栅格化由本地编码服务完成（`POST /embed_pages {pdf_path,pages,regions}`），产品不保存页面位图，Rust 侧不引入原生 PDF 库；`qwen_api` 无法读本地路径，因此没有页面源，其快照只含资产。
- 视觉通道固定使用 Qwen3-VL-Embedding-2B，两种运行方式：`qwen_local`（默认 `http://127.0.0.1:8765`）与 `qwen_api`（https + 密钥）。随包 fastembed 视觉编码已停用，旧设置值仍可反序列化但会被拒绝并提示改选。索引 namespace 由服务上报的模型身份派生。`prepare_visual_search_index` 编码一次、查询只读快照；服务不可达或快照不匹配时固定报 `model_unavailable`/`index_missing` 并退回文本通道。
- 字段覆盖重排、真实版面 crop（替代几何四等分）均未接入产品。
- 字段覆盖重排、真实布局 crop（替代几何四等分）均未接入产品。
- 宿主开关：`createAssistantTools({ unifiedRetrieval })` 已透传到批次适配器，但 `qna.ts` 等调用方未设置，生产默认关闭。

## 7. 重排阶梯（cross-encoder / 无模型 / 降级）

重排是可选的第三段，阶梯固定为 **cross-encoder → 字段覆盖（无模型）→ 融合序**，每次任务都会报告实际用哪一档。

| 设置 `rerank.mode` | 行为 | 体积 |
|---|---|---|
| `off`（默认） | 不重排 | 0 |
| `heuristic` | 字段覆盖重排：数字/指标词/实体加权，命中查询词才生效 | 0 |
| `cross_encoder` | 本地 ONNX 交叉编码器，只判头部 `max_candidates`（默认 20） | 279 MB（base int8）/ 570 MB（m3 int8） |

降级规则：模型缺失 → `used=heuristic, reason=model_unavailable`；推理失败 → `used=heuristic, reason=provider_error`；`fallback_heuristic=false` 时两档都退回 `used=fused`。单条命中不触发重排。模型目录按目录+mtime 缓存，加载失败也缓存，避免每查询重试 279 MB 模型。

### 接入 cross-encoder

```text
apps/desktop/src-tauri/resources/embedding-models/reranker/
  onnx/model_int8.onnx          # 优先；也接受 onnx/model.onnx、model.onnx
  tokenizer.json
  config.json
  special_tokens_map.json
  tokenizer_config.json
```

导出与量化（本机已验证）：m3 用 `torch.onnx.export` + `quantize_dynamic` → 569.6 MB，fp32 数值差 1e-05；base 上游自带 fp32 ONNX（1112 MB），量化后 **278.9 MB**，top1/top3 排序与 torch 一致。模型字节不进仓库，由设置 `rerank.model_dir` 指向任意目录。

### 实测选择依据（40 题、真实候选池、头部 20）

| 路线 | R@1 | R@5 | R@10 | nDCG@5 | 每查询 |
|---|---:|---:|---:|---:|---:|
| 融合（已含字段覆盖） | 0.300 | 0.450 | 0.475 | 0.391 | — |
| +启发式 | 0.300 | 0.450 | 0.475 | 0.385 | ≈0 |
| +base int8 @256 | 0.350 | 0.425 | 0.475 | 0.385 | 1.2 s |
| +m3 int8 @256 | 0.325 | 0.475 | 0.475 | 0.399 | 4.2 s |

结论：**R@10 由头部宽度与池覆盖决定，重排改变不了**（池覆盖 0.700，头部 20 后上限 0.475）；重排只影响 R@1/nDCG@5，CPU 代价 1.2–4.2 s。所以默认 `off`，字段覆盖留在融合臂里，不重复施加同一信号。


## 8. 启用入口（端到端接线）

默认**不启用**：组合检索会改变论文路由与证据顺序，属于用户决定而不是默认行为。

| 层 | 位置 | 作用 |
|---|---|---|
| 配置 | `AppSettings.retrieval.unified`（默认 false） | 唯一权威来源 |
| IPC | `get_retrieval_settings` / `save_retrieval_settings` | 设置页读写 |
| TS 缓存 | `shared/lib/retrievalMode.ts` | 每轮不重复 IPC；失败**fail-closed** 保持批次路径 |
| 调用方 | `sdk/qna.ts` → `unifiedRetrieval: unified ? {} : null` | 主助手；子助手与本地 Agent 仍走批次路径 |
| 设置页 | 检索与工具 → 检索路径 → 使用组合检索 | 单个开关；保存被拒会回滚开关 |

关闭时全链路退回批次检索；开启后视觉投票、文档路由、载体绑定与重排阶梯才进入真实提问。

## 9. 一次调用跑完整条检索（retrieval-probe）

```powershell
cargo run -p neuink-ipc --bin retrieval-probe -- `
  --root <库路径> `
  --model-dir apps/desktop/src-tauri/resources/embedding-models/default `
  --question "what accuracy does table 11 report?" `
  [--build-text-index] [--prepare-visual] [--visual-endpoint http://127.0.0.1:8765] `
  [--rerank-mode off|heuristic|cross_encoder] [--rerank-dir <模型目录>] [--skip-visual]
```

输出一份 JSON：`text_model`（是否可用/维度/名称）、`text_index`（构建耗时与向量数）、`visual_prepare`（1 篇 / 23 资产 / 128 向量源 / 405 ms）、`routing`（论文、跳过原因、文本与视觉条目数、`visual_status`、门控）、`carriers`、`tasks`（命中数、`rerank_used`/`rerank_reason`、前三条），以及 `timing_ms`。

实测（dev 库，stub 视觉服务 + base int8 重排）：`visual_status=ready`、`rerank_used=cross_encoder`、检索 2.87 s、准备索引 405 ms。

`NEUINK_VISUAL_DEBUG=1` 时，准备失败会打印未能归因的文档（entry/kind/page/region），便于定位源不一致。

### 多篇演示库与空 scope 语义

- `--seed-demo DIR`：写入两篇合成论文（各 3 页、2 张图）到空目录，用于在无真实语料时验证多篇路由；目录非空时拒绝执行，避免覆盖真实库。
- 空 `scope_entry_ids` 现在表示**整库**（`PreparedSearch.entries`），而不是空边界。之前它会让视觉通道报 `visual_no_allowed_entries` 并静默不出票——守卫是对的，推导是错的。

两篇演示库实测：路由 2 篇（无 `single_document` 跳过）、`text_entries=2`、`visual_entries=2`、`visual_gate_open=true`、`rerank_used=cross_encoder`、检索 2.48 s；`carrier_empty_fallback` 属于预期（合成段落没有载体标记，绑定如实报告并回退）。
