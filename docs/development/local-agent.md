# 本地 Agent 接入

本地 Agent 是默认关闭的本机设置，入口为“设置 → 工具与扩展 → 本地 Agent”。预设使用官方名称 **Claude Code、Codex、OpenCode**，检测列表直接平铺；聊天顶部提供对应的“名称 · 本地 Agent”。无需填写程序路径，也没有内嵌终端。检测只验证原生程序及版本，不发送模型请求；安装检测与模型连接测试分别显示。用户主动点击“测试连接”后，在临时目录发送固定示例并验证真实模型响应和一次 NeuInk MCP 往返；不发送资料库内容，可能消耗少量额度。测试可取消，离开设置或关闭开关时取消并忽略迟到结果。认证、额度、模型、网络及工具验证失败使用固定分类提示，不自动测试或修改原生配置。

## 各工具的官方接入方式

| 工具 | 协议 | 会话与原生能力 |
| --- | --- | --- |
| Claude Code | 官方程序化 `stream-json`，HTTP MCP | 保留 `claude` provider 和旧 UUID；`--resume` 续接，原生授权通过权限回调 |
| Codex | 官方 App Server 的 stdio JSON-RPC | `thread/start`／`thread/resume`，流式消息、原生命令／文件授权；保存实际返回的 thread ID |
| OpenCode | 官方 `opencode acp`，ACP v1 | 检查 HTTP MCP 与 loadSession 能力，`session/new`／`session/load`；忽略恢复时的旧消息回放，保留原生工具 |

Windows 检测 native exe，包括官方 npm 包的平台 payload；不执行 `.cmd`／`.ps1` 包装器。协议驱动、授权翻译和通知适配拆为独立模块，共用 NeuInk 的权限、读取、来源及提案执行器，无新增依赖。

Codex 每轮注入临时 `neuink` MCP 配置，不修改全局配置；设为 required，并确认实际取得工具目录再开始模型调用。默认原生沙箱 read-only、授权 untrusted、审核交给用户；保留原始系统指令，通过 developerInstructions 追加 NeuInk 规则。重复服务连接错误最多继续三次后返回明确错误。OpenCode 使用进程级 inline config 要求原生工具本次确认，NeuInk 工具沿用宿主校验与授权；同样检查 MCP 工具目录已连通。两种接入不把原生子 Agent 的独立回复当成主回答。

切换任意不同 Agent 或普通模型会新建独立对话，保留当前阅读对象和输入草稿。默认开关、检测状态、滚动与键盘所有权沿用原有设计；一个 Agent 检测失败不阻止其他 Agent 或普通模型使用。

## 执行与界面

- `AssistantPanel` 保留输入、阅读对象、历史、队列和滚动的所有权；后台任务与授权仍由原运行注册表管理。切换模型与本地 Agent 时新建对话并保留阅读对象，避免把两种执行上下文混在一份历史里。
- `local-agent/runner.ts` 的 `runLocalAgentHarness` 使用真实的 `createAssistantTools` 和参数校验执行器。各本地工具负责自己的 Agent 循环；NeuInk 不再套一层模型循环，不要求配置普通模型 API Key。
- Rust 以隐藏子进程启动用户已配置的 Claude Code，读取 `stream-json`，通过 Tauri Channel 转为原有文本、思考及工具轨迹。部分消息与完整消息会重叠，完整内容不能重复追加。并发 MCP 事件不能丢失未读完的 JSON 行。
- 对话消息的 `local-agent` part 保存 Claude session ID 与初始化状态，后续使用 `--resume`。每个资料库和对话使用单独的缓存工作目录，不以实际资料库为执行 cwd。CLI 自行管理其会话记录；清理或迁移 CLI 会话后，旧对话可能无法续接，应新建对话。
- 三种本地 Agent 共用 NeuInk 持久任务检查点，保存冻结输入、原生会话身份、工具状态、来源和待交付提案；显式“继续未完成任务”恢复原请求，普通新消息开启新的宿主任务。原生程序继续持有自己的模型历史，应用退出后不提供后台 daemon。
- 工具效果执行前先保存进行中记录，完成后保存回执。同参数的已完成写入和提案复用回执，不以新的调用 ID 重做；恢复后新笔记修改仍须重新读取。发生结果不明的宿主写入或中断的已授权原生操作时，整项任务禁用后续外部写入，仅允许只读核对和说明。恢复时重新检查当前权限及工具目录，权限／提供商不匹配时停止。结果保存与交付确认复用内置流程，恢复已交付任务不重复产生提案。
- PDF 每次最多读取 5 页。已确认因 `page_count > 5` 被拒绝的请求，仅在同一文档的后续成功调用扫描完原请求页码时标记“已纠正”，原失败轨迹保留并随消息持久化；其他执行失败不据此标记恢复。回答前由宿主补充本轮 PDF 文字读取范围、截断／省略页和无文字页，不将扫描全部页码等同于完整阅读。Claude 的 MCP 工具轨迹在界面沿用 NeuInk 的工具名称。
- 已解析正文默认每次最多返回 8,000 字符（请求上限 12,000），与模型总上下文窗口独立。返回 `next_read` 包含续读位置、限额和内容版本，模型通过同一工具继续；正文变化后须从头读取。优先按片段边界分段，超长片段保留续读引用，仅登记本次实际返回的来源。宿主合并本轮同版本的已读范围，存在缺口时说明只取得部分正文，单独读到末尾不代表全文读取。

## 工具适配

每轮在随机回环端口启动带独立 bearer token 的短期 Streamable HTTP MCP 服务，仅暴露本轮权限允许的工具。服务不提供直接资料库写入端点，拒绝带 Origin 的浏览器请求；运行结束关闭服务。参数与响应有容量限制，未知工具不能调用。

服务名为 `neuink`；Claude Code 显示的 `mcp__neuink__read_pdf_pages` 是服务名和工具名组合。实际目录由 `createAssistantTools` 的权限、可用服务及本次阅读对象决定，不是硬编码开放所有工具：

| 能力 | MCP 工具名称 | 范围与条件 |
| --- | --- | --- |
| PDF 文字层 | `read_pdf_pages`、`search_pdf_text` | 按物理页提取／字面检索，不做 OCR 或图像理解；读取每次最多 5 页，搜索最多 20 页 |
| 已解析正文 | `read_entry_assistant_context`、`search_segments`、`read_segment_content` | 条目正文按 `next_read` 分段续读；片段检索／读取适用于局部问题，保留页码和来源；没有解析片段时条目读取自动回退到前 3 页以内的 PDF 文字层 |
| 笔记读取 | `read_current_note`、`read_note` | 读取已选择或明确引用的目标笔记 |
| 笔记提案 | `note_propose_create`、`note_propose_patch`、`segment_note_propose_patch` | 有提案权限时生成待审阅内容，不直接保存 |
| 文献与网络 | `search_papers`、`search_web`、`read_webpage`、`import_papers`、`search_sciverse_evidence`、`read_sciverse_content` | 依赖已启用工具与相关服务配置；导入需要确认 |
| 当前网页 | `read_browser_tab` | 仅本轮明确关联、加载身份仍有效的网页 |
| 新建条目 | `create_entry` | 有提案权限及宿主创建回调时提供，执行前确认 |
| 展示与交互 | `present_diagram`、`ask_user`、`app_set_appearance` | 图表展示、问题表单；外观修改需要确认；依赖宿主回调 |
| 权限桥接 | `approve_tool` | CLI 内部授权回调，不是文档读取工具 |

条目标题／简介和标签创建／附加／移除／重命名接入原有待确认提案，不直接写入资料库；只读模式或缺少提案权限时不暴露。执行契约复用普通助手，兼容只读规划请求并禁止原生操作绕过限制。不嵌套 NeuInk 内置子助手，Claude 原生 Agent 仍可用。已授权的外部 MCP 工具可经宿主继续提供，其实际名称依服务目录决定。

PDF 原始字节由本机读取，前端 PDF.js worker 提取文字并缓存；模型接收的是工具返回的限量文字、页码、引用和截断说明。已解析资料则读取现有解析结果。两条路径均按需调用，不把整份 PDF 默认塞入初始消息。

NeuInk 的读取和提案工具经现有执行器校验参数、资料库范围和权限。已有宿主写入工具仍请求自己的确认，MCP 许可回调不额外重复确认只读和提案调用。现有外部 MCP 工具可以沿用宿主授权；NeuInk 的内置子助手不额外套入 Claude 循环，Claude 自带 Agent 工具保持可用。

宿主返回的结构化 `AgentToolFailure` 在 MCP 响应中携带 `isError: true`，同时保留安全错误类型、诊断和恢复建议；不把失败对象包成成功的文本结果。普通参数错误允许 Claude 纠正后继续。提示词同时说明失败处理规则、PDF 分批范围及文字层／截断限制。

Claude 原生 `Read` 报告 token 长度超限时，轨迹显示固定中文说明与 NeuInk 分段读取建议，不透出缓存路径或原始错误。该失败不等于论文损坏，也不会因其他工具成功而无依据地标记恢复。分段协议避免整篇解析结果超限后被 CLI 转存为难以按行读取的单行缓存；历史失败记录保持原样。

Claude 的原生工具、个人配置与个人 MCP 保留。三种 Agent 的原生权限请求统一进入现有操作确认；Claude 通过 `--permission-prompt-tool` 接入，原生 AskUserQuestion 继续使用问题表单。用户可选择“仅允许本次”或“以后都允许”，后者在本机按资料库、Agent 和稳定工具名保存授权，适用于这一类操作的不同命令／文件；不保存命令参数、不修改 CLI 全局配置。每次宿主回调先经过只读、恢复和资料库写入约束，再读取当前授权，向 CLI 仍只返回本次决定。不同 Agent、工具与资料库不共享许可，提案审阅、资料导入和用户提问不能由此自动确认。

授权存于 `neuink.localAgent.permissions.v1` 本机偏好，重启后保留；可在“设置 → 工具与扩展 → 本地 Agent → 本地操作授权”逐项撤销或全部恢复询问，关闭 Agent 开关时仍可管理。保存失败保留待确认操作并允许单次批准；取消后的旧按钮不产生授权；损坏或不可读的授权数据按无授权处理。设置页复用原滚动容器，确认区沿用独立限高滚动、原生按钮焦点与键盘行为，无新增拖动或依赖。撤销对之后的权限请求生效，不停止已开始的操作。拒绝按当前 UI 合同停止本轮。工具配置不等于操作系统沙箱，已批准的 shell/外部工具副作用不会因取消而自动撤销。

提示词要求 NeuInk 文档只通过宿主工具处理，不能直接编辑其后备文件。原生 Write/Edit 指向资料库或包含上级路径时拒绝并指导使用 MCP；原生 shell 操作在用户确认或已明确授予该类操作权限后继续。本轮来源编号与读取结果不可从旧轮次猜测复用。

## 网页读取与搜索

Claude Code、Codex、OpenCode 每轮都从实际工具目录取得网页能力状态，续接会话时重新计算，不沿用旧会话中的可用性推断。当前网页仅在提交时的活跃阅读面为 browser 时关联：模型收到去除查询参数与片段的标题／地址元数据，宿主保留完整的标签及加载身份；打开页面或普通问候不自动读取正文。

- `read_browser_tab` 读取当前请求冻结的网页，复用普通助手的 Readability、公开 PDF 文字和视频字幕适配说明；切换、关闭、加载失败或空内容不能伪装成成功读取。
- `read_webpage` 读取用户明确提供或检索返回的公开 URL，`search_web` 做公开网页检索。这些能力经 NeuInk MCP 由宿主执行，不依赖本地 Agent 原生 WebFetch／WebSearch 是否可用，也不需要放宽原生命令的网络或文件沙箱。
- 提示词优先选择实际可用的宿主网页工具；关闭／撤销的工具继续不可用，目录读取失败的说明传给模型。当前网页读取失败不能借换网址绕过身份检查、登录或访问限制。
- 公共检索失败以结构化错误回传安全诊断分类及恢复建议，重复失败仍由现有执行器拦截；不向模型转发原始异常中的凭据或私密路径。已成功读取的外部来源按返回的真实 URL 引用，并在回答结果中保留与本轮工具观察匹配的链接，不分配本地 `[S#]`。

网页能力状态与请求上下文归 local runner，底层工具继续持有权限、参数校验和读取范围。此次适配未增加 UI 状态、滚动区域、键盘／拖动契约或依赖。

## 笔记修改

普通助手与本地 Agent 共用最终回答核验：检查真实引用、论文展示记录、空回答和所需工具结果；最多两轮纠正，纠正提示保留原请求及已完成操作，不能只确认规则或重复下载。笔记提案继续经过来源与不可变内容校验；宿主只将已验证结果交付。

上下文使用普通助手的 Typed Mention Map、标签展开条目、近期对话、已有摘要和上一轮任务／图表信息，并继续发送冻结的阅读对象；旧历史不能授权读取新网页。新用户任务的来源编号重新登记，显式恢复同一任务时保留检查点中的来源与编号。原生程序仍管理自身长期会话及压缩，不额外调用普通模型生成本地 Agent 摘要。

修改现有 Markdown 笔记前，必须在本轮成功调用 `read_note` 或 `read_current_note`；不能仅凭 Claude 自身记忆、旧会话或文件路径生成可保存提案。提案沿用原始内容、补丁坐标、内容 hash、digest 和幂等键。只有会话成功保存后的已核实提案进入审阅页，用户确认后才由 `neuink-workspace` 写入；来源、冲突检测和重复确认处理沿用已有实现。失败或取消不交付新提案，也不自动保存笔记。

## 验证

确定性测试覆盖安装候选、消息容量、取消前启动、Windows 子进程树释放、真实 HTTP MCP 鉴权与目录、一次性结果回传、参数校验、范围、只读权限、提案读取前置条件、引用编号、流式重复、原生授权与提问、IPC 迟到事件、工具回传失败、对话持久化、设置联动与选择器。已有笔记确认、冲突、来源和幂等性测试继续作为写入回归。

以下测试需配置好的对应本机 Agent，并会发送合成测试请求；不会读取或修改用户文档：

```powershell
cargo test -p neuink-ipc real_claude_mcp_and_resume_smoke --lib -- --ignored --nocapture
cargo test -p neuink-ipc real_codex_mcp_and_resume_smoke --lib -- --ignored --nocapture
cargo test -p neuink-ipc real_opencode_mcp_and_resume_smoke --lib -- --ignored --nocapture
```

网页接入专项使用合成内容与随机验证词，检查真实 Agent 是否通过 MCP 读取并引用返回 URL；不发送资料库正文。每项只发起一轮请求：

```powershell
cargo test -p neuink-ipc real_claude_web_tool_smoke --lib -- --ignored --nocapture
cargo test -p neuink-ipc real_codex_web_tool_smoke --lib -- --ignored --nocapture
cargo test -p neuink-ipc real_opencode_web_tool_smoke --lib -- --ignored --nocapture
cargo test -p neuink-ipc live_keyless_web --lib -- --ignored --nocapture
```

长论文续读测试使用两段合成正文和随机验证词，验证真实 Claude Code 按 `next_read` 取得两段证据、保留引用，且不改用原生 `Read`：

```powershell
cargo test -p neuink-ipc real_claude_paged_paper_smoke --lib -- --ignored --nocapture
```

Claude Code 测试验证真实 MCP 调用、流式输出、续接、原生 Write 被拒绝后无文件副作用，以及等待工具时取消并清理回调。Codex／OpenCode 模型测试验证合成 MCP 读取与续接。另有 `real_codex_mcp_handshake_and_cancel_smoke`，连接实际 MCP 目录，在发送模型请求前取消，不依赖上游模型服务。

2026-10-07 本机 Claude Code 2.1.228 的真实测试通过；Codex 0.137.0 检测、MCP 握手与取消通过，但合成模型测试发生反复服务连接错误并超时，真实读取与续接尚未验收。本机没有 OpenCode，因此仅完成确定性协议和宿主工具回归，未完成真实 OpenCode 验收。原生 Tauri 视觉验收未完成。

常规回归：

```powershell
npm --workspace apps/desktop run test:frontend -- --maxWorkers=2
cargo test -p neuink-ipc --lib
npm --workspace apps/desktop run build:frontend
```

原生 Tauri 窗口的视觉、DPI、滚动和焦点仍需单独验收；jsdom 测试不代表原生视觉验收完成。

## 官方参考

- [Claude Code 程序化调用](https://code.claude.com/docs/en/headless)
- [CLI 参数，包括 MCP 权限回调](https://code.claude.com/docs/en/cli-reference)
- [Claude Code MCP 配置](https://code.claude.com/docs/en/mcp)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Codex MCP 配置](https://developers.openai.com/codex/mcp/)
- [OpenCode ACP](https://opencode.ai/docs/acp/)
- [OpenCode runtime config](https://opencode.ai/docs/config/)
- [ACP 会话与 HTTP MCP](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP 单次授权](https://agentclientprotocol.com/protocol/v1/tool-calls)
- [Agent SDK 与第三方集成要求](https://code.claude.com/docs/en/agent-sdk/overview)

当前适配测试使用 Claude Code 2.1.228。应用不收集或提供 Claude 登录界面，不承诺任何订阅认证方式都允许第三方产品分发使用；发布该集成前应按官方集成要求确认认证方案。


2026-10-08 补齐本地 Agent 回答核验、元数据／标签提案、宿主检查点及复杂上下文，相关 206 项前端回归、TypeScript／生产前端构建与 Rust 全工作区检查通过。设置连接测试的真实 Claude Code 往返通过；Codex 当前仍返回上游服务连接失败，OpenCode 未安装，不能标记两者已通过真实模型验收。连接测试会在 90 秒内结束，可使用下列合成测试独立复现：

```powershell
cargo test -p neuink-ipc real_claude_connection_probe --lib -- --ignored --nocapture
cargo test -p neuink-ipc real_codex_connection_probe --lib -- --ignored --nocapture
cargo test -p neuink-ipc real_opencode_connection_probe --lib -- --ignored --nocapture
```
