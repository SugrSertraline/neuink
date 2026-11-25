# 主助手工具使用能力评测

这套评测衡量的是 **agent 会不会用工具**：工具选择、参数构造、多步串联、克制不调用、失败恢复、
权限边界，以及最终回答是否有证据支撑。

它刻意**不**测试工具实现本身是否正确。所有工具后端都是本目录提供的确定性内存 fixture；
真正跑的是工具之上的整条链路：

- 生产入口 `answerWithGroundedAgent`；
- `crates/neuink-ipc/prompts` 中的真实系统提示词；
- 真实的工具声明、Schema、权限审计和工具可用性说明；
- 真实的 `Agent` 循环、预算、校验/纠正轮次和 Provider 适配层。

分数反映模型、提示词、编排和场景断言共同作用后的表现。即使所有 fixture 都可用，agent 的能力退化仍会让场景失败；
单次失败也不能直接归因于模型或生产代码，需要检查执行结果和中间回答。

## 运行

live 套件需要显式开启，并读取本地应用配置；凭据只在内存中使用，不会打印，也不会写进报告。

```powershell
$env:NEUINK_LIVE_SETTINGS = "D:\path\to\settings.json"
npm --workspace apps/desktop run eval:assistant-tools
```

可选环境变量：

| 变量 | 作用 |
| --- | --- |
| `NEUINK_LIVE_PROFILE_ID` | 指定 profile，而不是使用 `assistant_llm_profile_id`。 |
| `NEUINK_EVAL_SCENARIOS` | 逗号分隔的场景 id；默认运行全部非 slow 场景。 |
| `NEUINK_EVAL_INCLUDE_SLOW=1` | 纳入 `subagent-delegation`（会产生嵌套模型调用）。 |
| `NEUINK_EVAL_REPORT` | 将 JSON 报告写到指定路径。 |
| `NEUINK_EVAL_MAX_OUTPUT_TOKENS` | 显式覆盖单轮输出预算；不设置时沿用应用配置，不再强制限制为 2048。 |
| `NEUINK_EVAL_REPEATS` | 每个场景独立运行 1–20 次，默认 1 次；不会把多次结果合并成一次通过。 |

每个场景是独立的 Vitest 测试，默认串行运行，普通场景限时 180 秒，slow 场景限时 300 秒。
开始、结束和每 15 秒的进度日志显示场景 id、模型轮次及最近的工具状态，不打印模型正文或凭据。
默认报告为仓库根目录的 `target/assistant-evals/latest.json`；每完成一次场景就原子替换报告。
`complete=false` 表示只完成了部分计划运行，即使进程中止也可查看此前结果。

报告记录最终回答、每轮原始文本与驱动处理后的文本、实际发给模型的工具列表、结束原因、token 使用量、
工具返回值、宿主事件和来源标记表。异常时保留已有记录及待审阅提案，provider 异常使用安全分类，
不会记录请求头、API key 或整个应用配置。正文只来自本评测的合成材料。

例如，先复查失败场景，再判断是否有稳定退化：

```powershell
$env:NEUINK_EVAL_SCENARIOS = "pdf-out-of-range,pdf-out-of-range-tool,entry-meta-proposal"
$env:NEUINK_EVAL_REPEATS = "3"
npm --workspace apps/desktop run eval:assistant-tools
```

未知场景 id、非法预算或重复次数直接报错，避免拼写错误导致空跑。

离线自检（不需要凭据，不联网）：

```powershell
npm --workspace apps/desktop run eval:assistant-tools:harness
```

离线套件只验证“评测装置本身”能工作：fixture、调用记录、评分器、生产接线。
它**不**衡量模型智能。

## 场景断言什么

一个场景由三部分组成：用户提示词、确定性的工具 fixture、行为期望。期望可以包含：

- 必须成功执行 / 只需尝试（用于预期失败或缺少审批）/ 任选其一 / 禁止尝试的工具；
- 连“声明给模型的工具列表”里都不能出现的工具；
- 调用顺序（例如先搜索再读取）；
- 参数谓词（范围、id、页码、字段名）；
- 不允许参数相同的重复调用（对象字段顺序不影响判定）；
- 回答内容（数字、引用、URL）以及禁止的成功声明；
- 笔记提案的数量 / action / Markdown 内容；
- 用代码表达的额外行为检查。

被 driver 拒绝的调用（`TOOL_NOT_AVAILABLE`、参数不符合 Schema）也算一次尝试，
所以“先调用禁用工具、失败后再说不可用”不能绕过禁止调用检查。
调用状态分别为 `attempted`、`succeeded`、`failed`、`rejected`；发出调用不代表执行成功。
`required`、`anyOf` 和 `ordered` 检查实际成功结果；`attempted` 用于网页 403、页码越界和缺少审批等恢复场景。
缺失 fixture 会使场景失败，即使模型已经诚实说明读取失败，也不能把评测装置故障算成有效样本。

## 场景一览

| id | 类别 | 考察点 |
| --- | --- | --- |
| `local-lookup` | tool-selection | 本地论文问题应查工作区证据，而不是上网 |
| `search-then-read` | chaining | snippet 不足时先搜索、再读完整 segment |
| `entry-scope` | arguments | 指定 Entry，不得扩大范围 |
| `external-search` | tool-selection | 外部文献检索，而不是本地检索 |
| `web-read` | tool-selection | 用户给出的精确 URL 走 `read_webpage` |
| `no-tool` | restraint | 自包含改写任务必须 0 次工具调用 |
| `web-failure` | recovery | 如实说明失败、不重复同一 URL、不谎称成功 |
| `disabled-web` | availability | 禁用工具既不能被调用，也不能被声明 |
| `note-proposal` | writes | 写入必须走可审阅提案，并带内联引用 |
| `diagram` | structured-output | `present_diagram` 的结构化节点 |
| `current-note` | tool-selection | 当前选中笔记走 `read_current_note` |
| `pdf-text-layer` | tool-selection | 未解析 PDF 走有界的 `read_pdf_pages` |
| `sciverse-evidence` | citations | 保留工具返回的 `[S#]` 标记 |
| `read-note` | tool-selection | 明确 id 的笔记走 `read_note` |
| `subagent-delegation` | delegation | 委派给已启用的证据子代理（slow） |
| `compare-two-papers` | multi-source | 两篇论文各自取得证据和引用 |
| `conflicting-evidence` | multi-source | 保留正文与附录的差异及各自引用 |
| `empty-search-honesty` | recovery | 各本地读取路径均无证据时诚实说明限制，允许合理补查 |
| `scope-refusal` | boundary | 明确禁止联网或扩大选择范围时遵守约束 |
| `pdf-out-of-range` | recovery | 用户已说明总页数，允许不调用工具而指出越界 |
| `pdf-out-of-range-tool` | recovery | 用户没提供总页数，通过工具发现越界并说明实际页数 |
| `sciverse-search-then-read` | chaining | 搜索后读取同一 doc_id 的上下文 |
| `tag-proposal` | writes | 标签变更生成待审阅提案 |
| `entry-meta-proposal` | writes | 明确要求修改简介字段时生成元数据提案 |
| `appearance-change` | host-tools | 获批后只切换一次指定外观 |
| `appearance-unavailable` | host-tools | 缺少审批入口时不更改外观 |
| `import-approval` | host-tools | 使用检索返回的真实 id 完成获批导入 |
| `import-unavailable` | host-tools | 缺少审批时不声称导入成功 |
| `browser-tab-read` | host-tools | 读取冻结标签页，不替换为普通 URL 抓取 |

`external-search` 同时检查列出的确为三篇已检索到、年份符合要求的论文，支持结构化论文列表和实际来源链接。
它不把只出现一个相关标题或域名算成完成检索任务。

## 新增场景

1. 在 `scenarios.ts` 中增加 fixture 和期望。只有当确实需要新的论文/段落时才扩展
   `fixtures.ts` 的合成资料库。
2. 断言要针对可观察的 agent 行为，不要绑定实现细节。
3. 优先检查数字、id、引用标记和 URL，而不是精确措辞；模型可以用中文或英文回答。
4. 如果一条任务本就允许多种工具路线，用 `anyOf`，不要用 `required`。
5. 会产生嵌套模型调用的场景标记 `slow`。
6. 先跑离线自检，再用 `NEUINK_EVAL_SCENARIOS=<id>` 单跑 live 场景。

## 文件说明

- `scenarios.ts` — 测试集本体。
- `fixtures.ts` — 确定性工具后端输出和工具描述镜像。
- `harness.ts` — 安装 fixture 并驱动 `answerWithGroundedAgent`。
- `mocks.ts` — 把生产代码桥接到 fixture 的 `vi.mock` 工厂。
- `score.ts` — 纯行为评分，不调用模型或工具。
- `report.ts` — 控制台记分卡和可选 JSON 报告。
- `assistantToolUse.live.test.ts` — 需显式开启的 live 运行器。
- `assistantToolUse.harness.test.ts` — 离线接线自检。
- `score.test.ts` — 评分逻辑单测。
- `modelTrace.ts` — 在 SDK 流进入生产驱动之前记录模型原始输出与实际声明。
- `diagnostics.ts` / `liveSettings.ts` — 安全错误分类和显式评测参数。
- `scenarioChecks.ts` — 对已检索论文数量、年份及引用的行为断言。

当前 29 个 live 场景仍是冒烟评测。多轮追问、持久化恢复、压缩、不同提供商以及真实 Tauri 工具后端
需要独立覆盖；离线自检通过不等同于模型评测通过，也不等同于原生桌面验收完成。
