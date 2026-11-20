# Neuink 工程规范

> 2026-11-13 发布规则更新：经用户确认的 alpha、beta 或 main 提交均可发布官网和发行包，不再要求先合并 main。保留来源提交记录、版本一致性、测试、空 data、凭据排除及下载校验。下文历史流程中限定 main 的表述不再适用。


> 这里只写当前仓库应执行的规则。尚未建立的 CI、schema 或模块不能写成既成事实。

## 1. 基本原则

1. 本地用户文件是权威数据，缓存必须可重建。
2. UI、IPC、Rust 服务和落盘形成完整调用链。
3. 高风险写入必须可审查、可冲突检测、可恢复。
4. 优先拆分高内聚模块，不为“未来可能需要”创建空抽象。

## 分支与交付

开发顺序为 `alpha → beta → main`：

- `alpha`：最新功能开发与集成，功能分支从这里建立。`beta` 稳定性修复和 `main` 紧急修复及时回流，避免开发分支落后。
- `beta`：接收用户确认保留的功能候选，固定交付提交号与范围，集中处理稳定性、数据兼容和实际使用效果；测试期间不混入无关的新功能。
- `main`：接收已经在 beta 完成验收并获用户确认的候选，作为正式安装包、发布标签与官网部署的来源。

每次 alpha 交付 beta，必须在开发计划中记录：来源提交号、功能保留清单、主动改变／移除／隐藏的行为与入口、已有数据兼容性、测试结果和已知限制。用户确认功能范围后才晋级；不能用“提交已包含”代替“功能已保留”。若 alpha 同时有未完成功能，从已确认的提交准备候选，或选择独立改动并重新验证，不把 alpha 最新 HEAD 整体自动合并。

beta 晋级 main 前，补齐有关模块的自动化回归、原生 Tauri 关键使用流程及稳定性验证；记录真实模型／网络服务的实测范围与未验证项。原生视觉未验收、故障恢复缺口等不能因 CI 通过而被隐去，剩余限制须在交付时明确确认。CI 不自动晋级分支。

`branch-validation.yml` 在 alpha/beta 的 push 和目标为 alpha/beta 的 pull request 上执行 Windows 前端、类型／构建、打包脚本与 Rust 服务测试，不生成公开安装包、不部署网站、不调用真实模型。它不替代原生交互、长时间运行和 macOS 验收，也不是 GitHub 服务端分支保护规则。

## 2. 模块边界

- `neuink-domain` 不做文件、网络、UI 或 Tauri 工作；
- `neuink-workspace` 是用户数据写盘入口；
- `neuink-parser` 负责 Provider 和 MinerU 归一化；
- `neuink-search` 只保存可重建索引；
- `neuink-ipc` command 负责解析输入、校验边界并调用服务；
- 前端通过 `shared/ipc` 封装调用，不在组件中散落 `invoke`；
- Conversation 存储不负责调用 LLM；
- Assistant 模型不能绕过 Verified Proposal 直接写盘。

助手工具实现按 `modules/assistant/sdk/toolInput`、`toolExecution`、`toolOutput`、`toolSchema`、`toolNoteProposal`、`noteProposalPreview`、`toolValues` 分工。生产调用者导入具体职责模块；`toolSupport` 只保留兼容导出，底层模块不得反向依赖它。纯笔记修改预览不得引入工具执行或外部服务调用。

设置页的资料库选择流程由 `useWorkspaceSelection` 持有待确认对象与忙碌状态；`WorkspaceSelectionDialog` 仅呈现与转发操作。目录检查不能直接创建或切换资料库，确认后先执行现有未保存内容保护。模型目录缓存沿用既有存储键，由 `modelCatalog` 统一读写／合并，不把密钥写入目录缓存。

## 3. 文件与函数

- 新增大型组件前先判断能否拆为状态 hook、纯函数和小组件；
- 单文件接近 400 行时必须说明继续保留的理由或拆分；
- IPC command 不承载长业务流程；
- 禁止在业务代码中随意 `unwrap`、`expect` 或吞掉 `Result`；
- 参数过多时使用结构化请求对象；
- 注释解释约束和原因，不复述代码。

这些是评审约束；在建立自动检查前，不得声称由 CI 强制。

## 4. 命名

- Rust：模块和函数使用 `snake_case`，类型使用 `PascalCase`；
- TypeScript：函数使用 `camelCase`，组件和类型使用 `PascalCase`；
- IPC：Rust command 为 `snake_case`，前端包装为对应 `camelCase`；
- 领域词统一使用 Workspace、Entry、Segment、Annotation、Note、Source Link、Tag、Field、Conversation、TaskState、Proposal。

UI 中文可以使用“资料库、条目、片段、批注、笔记、来源链接”，代码中不要引入第二套同义类型。

## 5. 写盘规范

- 单文件使用临时文件加 rename 等原子写策略；
- 多文件一致性操作使用 journal 或明确恢复步骤；
- Note 正文与 Source Link sidecar 不允许静默半完成；
- Proposal Apply 使用后端保存的不可变内容，客户端不重新提交 patch；
- 更新前校验基础版本或内容 hash；
- 删除操作优先回收站；彻底删除必须明确触发；
- API Key、隐私路径和正文不得进入日志。

## 6. 前端交互

- 所有 UI 新增和重构必须先阅读并遵循 [UI 设计与交互规范](ui-design-system.md)；
- 删除、覆盖和 AI 写入必须确认或提供可撤销路径；
- 加载、空状态、失败和重试不能共用模糊文案；
- 分屏拖动期间避免触发 hover preview 和高开销渲染；
- 长列表和大文档先测量再引入缓存或虚拟化；
- 组件沿用仓库已有 shadcn/Radix 风格和共享 UI。

## 7. 验证命令

```powershell
npm run check
npm run test
npm --workspace apps/desktop exec tsc -- --noEmit
npm --workspace apps/desktop run test:frontend
npm run desktop:build
```

按改动范围选择最小充分验证。涉及写盘、解析、搜索缓存或 Proposal Apply 时必须运行对应 Rust/前端测试，不以编译通过代替行为验证。

### 使用 D 盘现有资料调试阅读器

本机日常使用和本地验收统一使用 `D:\NeuInk\portable\Neuink.exe`，桌面入口为“Neuink”。用户要求“启动”时默认打开这份独立程序，不启动开发服务器，也不另建日常测试副本。修复验证后，将新程序和配套资源直接更新到 `portable`，保留 `portable/data`；更新前关闭程序，备份将被替换的程序文件，并在启动前核对资料目录未被更新操作修改。

只有明确需要热更新或原生调试时，才先关闭便携程序，再运行 `npm --workspace apps/desktop run dev:d-data`。该命令默认读取仓库内 `portable/data`；如需其它目录，设置 `NEUINK_DEV_DATA_DIR` 为包含 `library` 的绝对路径。`npm --workspace apps/desktop run dev:d-data -- --check` 只检查路径；`npm --workspace apps/desktop run audit:sentences` 只读统计已保存的段落译文及逐句配对失败位置。开发版直接写入同一份资料，与便携版共用资料锁，不能同时打开。路径覆盖只在 debug 构建生效；日常独立程序使用程序旁的 `data`。

`apps/desktop/scripts/start-dev-windows.ps1` 保留为显式调试入口，重复运行会恢复已有开发窗口，启动记录位于 `target/desktop-dev/launcher.log`。它不作为日常桌面入口。前端修改由 Vite 更新，原生修改由 Tauri 开发进程重新编译。本地独立程序更新可以来自已验证的 `beta`，仅用于本机；这不授权合入 `main`、发布安装包或部署网站。

## 8. 文档规则

- PRD 维护产品边界，不记录每日实现流水账；
- 系统架构只描述当前代码和稳定约束；
- 开发计划是实现状态唯一来源；
- 临时调查和实施计划完成后合并有效结论并删除；
- 不为每个短模块放重复 README；
- 程序运行时 Prompt 虽为 Markdown，但按代码资产管理。

## 9. Windows 安装包

- `npm --workspace apps/desktop run installer:test` 从当前开发树构建未签名的本地 NSIS 预览安装包，产品名 `Neuink Preview`、标识 `com.neuink.preview`；输出在 `target/debug/bundle/nsis`。不要把它当作 main 正式发行，也不要用它替换用户现有 D 盘程序。
- `npm --workspace apps/desktop run release:installer` 仅允许 main 或符合既有发布规则的 CI。正式产物在 `target/release/bundle/nsis`。Windows 工作流同时准备便携 ZIP 与 NSIS 安装包，`installer-artifacts.cjs` 生成 `installer-info.json` 和校验和；当前流程不配置或验证代码签名。
- NSIS 默认当前用户安装，支持简体中文／英文、开始菜单与 Windows 卸载入口。安装脚本与便携包复用 Visual Studio x64 CRT 定位器，在程序旁附带运行库；NSIS hooks 只清理明确的运行库文件，不递归删除资料。安装目录需可写，沿用程序旁 `data` 的存储行为；更新只更新程序资源，默认卸载保留用户产生的 data。新位置不会自动复制原 D 盘资料。WebView2 缺失时由安装器联网准备。
- Research 为用户主动安装的可选运行环境；当前安装包携带 `component.zip` 和清单，设置“检索与工具 → 可选服务 → 深度研究”点击后才验证、展开和启用，支持阶段进度、取消和重试。不需要用户装 Python。尚未接入联网下载组件，不宣称安装包已去掉压缩组件。

当前构建流程不配置或验证 Windows 代码签名，发布前应核验实际签名状态。未签名的程序可能显示未知发布者或受到 Windows 安全策略限制。
