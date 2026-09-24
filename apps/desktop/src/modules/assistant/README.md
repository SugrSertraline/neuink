# Assistant Module — Runtime v4

## 职责

- 将用户消息、完整对话、`@` 附件和显式 UI 上下文作为 Agent observation；
- 由模型策略在统一 Agent Loop 中决定直接回答、自然追问、调用原子 Tool 或委派子 Agent；
- 在最终文本、来源和 Proposal 展示前执行 Verifier；
- 维护 Conversation message parts、TaskState、AgentRun 和 Proposal 审核 UI。

## 不负责

- 模型不能直接写入 Workspace；
- 前端不通过正则解析意图、文件名、标题、重试短语或固定澄清槽位；
- 命名、总结、措辞、规划和是否追问属于模型原生认知，不包装成 Tool；
- Conversation 存储不负责调用 LLM。

## 输入

- 用户消息与有序 `@` attachments；
- `[C1]` 等标记对应的 Typed Mention Map（Entry/Note/Tag/Segment 的真实 id 与名称）；
- Workspace context snapshot；
- LLM profile、Agent permissions、Tools 与 MCP allowlist。

## 输出

- 已验证的 Markdown 聊天回答和 Evidence 来源；
- 不可变 Verified Note/Segment Note/Entry Meta/Tag Proposal；
- 可恢复的 TaskState、AgentLoopState 和 AgentRun。
- 已完成/失败任务后的自然语言续接会重放历史 Typed Mention Map，并合并会话 scope；不依赖“恢复任务”或 retry 正则。

## 模块边界

- `agent-core/`：与供应商无关的 Agent 实例、顺序工具循环、完整消息历史、共享运行树预算和取消、循环与无进展保护；
- `harness/`：主循环装配、显式上下文 hydration、Verifier 与 AgentRun；
- `runtime/`：只读 Subagent、共享 SourceLedger、TaskState、Verified Proposal 和窄应用命令；
- `sdk/`：单轮 Provider 适配、无工具的固定模型任务、带 JSON Schema 校验的业务工具；AI SDK 不拥有执行循环；
- `components/`：对话、上下文、Proposal Diff 与 Apply/Reject UI。

`create_entry` 是明确授权的原子副作用，并在单次 Agent run 内按参数幂等。`read_note(entry_id, note_id)` 允许 Agent 读取任意明确引用的 Note，不依赖 UI 正则预选 current note。Note、Entry Meta 和 Tag 修改仍只生成可审核 Proposal；真实 Note 写盘只允许 UI 调用 `apply_note_proposal`。后端按 `taskId + proposalId` 读取持久化 Verified Proposal，执行 digest、基础内容 Hash、幂等和 journal recovery 校验。

## 执行与配置边界

- 输入区不再提供普通执行／仅规划模式选择。`runtime/requestRouter` 在 hydration 前自动分流：仅无历史、无阅读目标、无附件／引用的完整独立问候（精确匹配，允许尾标点）使用轻量路径；不以包含某关键词或句子长度判定业务意图。有上下文、有历史、混合需求和不确定请求仍进入主 Agent。轻量路径复用同一 Agent、Provider、预算和检查点，但不读取文档、不加载工具目录／MCP，不生成固定计划或记忆请求。它并未关闭供应商自身推理。
- Rust `assistant_routing` 复用已有 multilingual-e5-small / FastEmbed，独立惰性模型会话避免与文档索引争用锁；路由示例在进程内缓存，两侧采用 E5 的 `query:` 前缀和余弦相似度。自由输入的短独立非问候请求可获得聊天／阅读／修改／研究／方案／其他候选；当前是 **shadow 阶段**，候选、分差及模型标识只记录到任务检查点和默认折叠的执行详情，不改变执行路线、推理等级或权限。当前没有经过校准的业务阈值，不把相似度当正确率。上下文或历史门控直接回主 Agent，不做截断猜测；超过 256 字符也跳过分类。
- 面板可用时后台预热；原生等待最多 100ms、前端最多 120ms，冷启动／忙碌／资源缺失／错误直接回主 Agent，不请求远程分类器，不下载权重，不记录正文或凭据日志。后台加载完成不修改已冻结的路线；每个请求的路线随检查点保存并用于恢复。翻译和标签的明确 UI 操作仍沿用原固定业务流程，不进入此路由器。未来启用语义快捷路线前须用独立中文标注集校准阈值和分差，并验证混合意图／否定／续聊的误分率及尾延迟。
- `runtime/executionPolicy` 只从当前授权配置装配能力，路由只能收窄不能扩大授权；同一循环按需回答、澄清、检索和委派。无正式调用的旧 `taskOrchestrator` / `executionContract` 已移除。旧只读检查点仍保留其白名单边界，新请求以自然语言说明是否只要方案，不要求切换界面模式；语义候选不是写入授权，计划本身也不是修改确认。
- 默认任务不预判目标与最终操作；工具从显式上下文与参数解析真实目标，歧义由主 Agent 自然追问。原冻结 scope、授权交集、修改前读取、行坐标／expected_text、SourceLedger、内联引用、不可变提案摘要与后端 Apply 校验继续生效。读取出证据后的回答必须引用，带证据的笔记提案缺少引用时作为工具错误交回主 Agent 修正。语义上是否需要读取、哪条资料支持哪句结论仍由模型决定，程序的引用有效性检查不等于事实真实性保证。
- 短对话不额外请求记忆模型；距最近检查点的未总结正文达到 8,000 字符才更新摘要，原始会话照常保存。长上下文的请求投影压缩仍独立生效。该阈值是字符估算，不是供应商 token 的精确用量。
- 模型推理流、任务计划、执行状态是独立概念。等待响应显示“正在处理”，只读计划／工具／子任务／记忆按真实阶段显示；折叠只影响展示，总耗时包含整个任务。Provider 仍接收 reasoning 增量；尚未提供跨协议思考强度配置，不能将只读计划开关称作“深度思考”。
- 主、子 Agent 使用同一个 `Agent` 内核，独立消息上下文；整次请求共享 24 次模型请求、48 次工具调用预算和取消信号，任务理解、上下文摘要和结束记忆也计入请求预算。主 Agent 最多 12 轮，子 Agent 最多 8 轮、深度最多 2；恢复不重置预算。累计供应商已报告的 input/output tokens，达到 512,000 后拒绝下一次模型调用；这不是预付费额度控制，不能精确统计断流后供应商未报告的用量。
- Provider 保留供应商的 reasoning/signature 元数据。每次请求超时 120 秒；上下文使用保守字符估算，超限时只压缩发送给模型的历史投影，保留初始请求、完整近期工具调用/结果配对和引用标识。原始 transcript、SourceLedger 和提案不裁剪；初始输入或最近工具批次仍无法容纳时显式停止。截断的模型输出不得执行工具或标记为完整回答。
- API Key 只属于安装级 LLM profile。主助手可以指定 profile；子助手未指定时继承父模型，指定但不存在时失败。Tool 不拥有模型 Key；MCP/Sciverse/Parser 的凭据与模型凭据不同。
- 对话摘要等固定模型任务使用 `runJsonModelTask`，无工具和子 Agent。推荐标签使用 Rust 固定任务策略直接调用模型，不由用户选择模板。宿主要求每级标签及理由使用简体中文，专有名词可附中文说明保留原文；校验拒绝没有汉字的层级或理由，不做自动翻译重试。旧英文标签及缓存推荐不自动改名，须重新生成推荐。标签输出 schema 为 `{tags: [{path, dimension, reason, confidence}]}`，只推荐、不执行修改。翻译保留 Rust `TranslationPipeline`、共享 `llm_http`、调度、缓存和重试，不绕入 Agent 循环。
- 产品不再提供 Skills 的注册、导入、授权或运行时加载。已有 `agent-skills/` 用户文件留在资料库中但不参与执行；旧 v4 配置中的 Skill 字段在规范化时被剔除。条目属性修改和笔记生成由主 Agent 使用原子工具与溯源能力完成。
- PatchPlannerAgent 已移除；EvidenceAgent 是可选的只读证据工作者，默认关闭。旧双子 Agent 配置首次规范化时关闭原默认开启的 EvidenceAgent，可随后手动重新开启；只有启用且有主助手授权时才向模型提供委派工具。子 Agent 不产生写盘、应用外观或外部 MCP 副作用。计划和子任务只能缩小已授予权限。
- `app.set_appearance` 通过注入的 `ApplicationActions` 调用既有 `AppearanceProvider`，只切换三种外观；不开放通用设置写入。状态、持久化与原界面共用，滚动、键盘、拖动协议不变。条目标题等知识数据修改仍走提案。
- Runtime v4 不迁移 v3 Agent 配置；旧配置不执行，新默认不影响安装级模型 Key、文档、Source Link 或用户已有编辑。普通设置继续隐藏 Agent/MCP 高级配置；该产品开关不是多用户账户权限系统。

## MCP 与溯源

Rust stdio 客户端按照 [MCP 生命周期规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) 执行 `initialize → notifications/initialized → tools/list 或 tools/call`；分页发现使用同一会话，执行请求为短会话。工具 schema 来自服务器，名称须同时通过主助手 server 授权、server allowlist、已启用且 `permissionMode=allow` 的 Tool Package。`ask` 在没有审批界面时拒绝执行，不能自动视为批准。

每个 MCP 操作有 60 秒总超时、2 MiB 单消息上限、8 页发现上限；支持取消、进程回收、Windows 隐藏窗口。不启动 shell，不把模型参数拼成命令。配置中的本地程序是受信任代码，read-only 是业务权限而非 OS 沙箱。当前不提供 Streamable HTTP、长连接池、sampling、elicitation 或任意服务器请求执行。

SourceLedger 在一次运行树内分配唯一 `[Sx]`，子助手证据可供主助手引用和构建提案；最后聊天回答才重编号。既有 Source Link 页码、片段、快照、hash、反向引用和应用时校验保持不变。不存在的引用拒绝，Sciverse 来源可用于聊天，但不能冒充本地 Source Link；需先导入论文再生成带本地溯源的笔记。外部来源的独立持久化模型、PPT 产物工具尚未实现。

## 持久化任务与恢复

`harness/durableHarness` 拥有执行身份和交付状态；`runtime/durableExecution` 串行保存检查点；Rust `neuink-workspace::agent_execution` 负责原子保存、版本比较与交换（CAS）和进程间文件锁。状态存于 Workspace 的 `agent-runtime/executions/`，每份最多 16 MiB；只持久化明确列出的任务输入，不保存 LLM profiles、API Key 或可执行配置。删除对话时清理对应检查点，已删除对话拒绝后续写入。

存储标识校验接受领域 NanoID 的完整 URL-safe 字符集（包括 `_`）以及执行 UUID，不接受路径分隔符、点或 Windows 路径语法。存储错误按标识、已删除对话、版本冲突、锁冲突、容量和权限分类，不展示原始路径或请求内容。恢复前校验原始任务输入、预算和待执行位置；资料库权限读取失败立即停止，不用默认授权代替读取失败的配置。

模型请求前预留预算，模型返回后先保存整批调用，再执行工具；工具执行前记录 intent，完成后保存结果及证据。主/子 actor 分别记录 transcript、待执行位置，共享预算和 SourceLedger。恢复复用原任务合同、上下文快照、已完成结果、待审核提案及读取快照；重新装配当前工具权限，模型/Agent 身份改变时拒绝沿用旧上下文。UI 的“继续任务”为显式恢复入口，无自动启动和自动重放写操作。

只读工具可以重试未完成的调用；已完成调用不重做。创建条目或外部 MCP 出现结果不明、取消或错误时停止自动恢复，要求人工核对；不承诺跨外部系统的 exactly-once，也不会声称取消可以撤销已提交副作用。提案工具只构造候选内容，真实写入仍走原有 Verified Proposal/digest/hash/journal。最终结果先存入检查点，Conversation 成功保存后才确认交付；确认失败不会抹去已经保存的回答和提案。

对话控制器结束时停止接收流事件，等待已排队草稿落盘后再保存终态；模型的迟到事件不能继续更新已结束任务。答案交付后历史列表刷新等外围错误只能提示刷新失败，不能覆盖已保存的答案、来源和提案。原 AssistantPanel 保持状态/滚动、键盘与拖动所有权，无新增交互容器。

内核提供可等待事件、steer、followUp 和 waitForIdle；当前聊天 UI 仍使用既有队列交互，不新增中途插话 UI。任务可在 WebView 重载或应用重启后由用户显式恢复，但关闭应用后不会继续后台执行，没有引入 Node sidecar 或独立 daemon。恢复格式仅适用于本次开始保存的新任务，旧日志不是执行检查点。

## 参考实现与许可证

- [Aurelio Semantic Router](https://github.com/aurelio-labs/semantic-router)（MIT）：借鉴“示例句向量 → 路线候选 → 未命中回退”，没有引入 Python 服务或复制源码。[vLLM Semantic Router 架构](https://github.com/vllm-project/semantic-router/blob/main/website/docs/overview/semantic-router-overview.md)：借鉴检测信号和执行策略分离，不引入其服务端基础设施。
- [multilingual-e5-small 模型说明](https://huggingface.co/intfloat/multilingual-e5-small)：复用已有 MIT 许可本地权重，Mean pooling、对称任务两端 `query:` 前缀及余弦比较；模型的高相似度不是业务分类准确率。本次没有下载或替换模型资源。
- [Pi 只读计划扩展](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts)：计划属于可选宿主策略，同一循环通过缩小工具集进入只读模式，由用户决定后续执行。本地采用更保守的明确只读白名单，不复制其 Bash 或 UI 代码。
- [Pi agent loop](https://github.com/earendil-works/pi/blob/7f06f9cf1626504cde95683f1c81a72a7bc7a0cb/packages/agent/src/agent-loop.ts)、[Agent](https://github.com/earendil-works/pi/blob/7f06f9cf1626504cde95683f1c81a72a7bc7a0cb/packages/agent/src/agent.ts)：事件顺序、等待订阅者、轮次边界输入和截断输出的安全处理；[compaction](https://github.com/earendil-works/pi/blob/7f06f9cf1626504cde95683f1c81a72a7bc7a0cb/packages/coding-agent/docs/compaction.md)：区分完整会话与请求投影、保留工具调用配对。上游 MIT，Copyright (c) 2025 Mario Zechner。
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) 和 [fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)：持久化检查点、恢复边界和显式重试策略。[仓库](https://github.com/langchain-ai/langgraphjs)。

本次参考上述设计，自行实现 NeuInk 适配，没有复制上游源文件，也没有引入 Pi/LangGraph 运行依赖。直接替换 Pi 包会同时引入其消息、Provider 和宿主依赖体系；当前保留 AI SDK 单轮驱动，避免为恢复任务同时迁移模型协议与特殊溯源。若以后复制代码，须按固定版本保留上游版权与完整许可，不能仅以致谢替代。

## 验证范围

确定性测试覆盖真实 Provider 适配层与主/子循环接线、工具参数、共享引用、待确认笔记、预算、取消和权限。Rust 使用合成 stdio 服务器验证 MCP 握手、分页、调用、取消。`agent.live.test.ts` 默认跳过；显式设置 `NEUINK_LIVE_SETTINGS` 为本地安装配置路径才进行小规模真实请求，只发送合成文本，不输出凭据。
