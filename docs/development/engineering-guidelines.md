# Neuink 工程规范

> 这里只写当前仓库应执行的规则。尚未建立的 CI、schema 或模块不能写成既成事实。

## 1. 基本原则

1. 本地用户文件是权威数据，缓存必须可重建。
2. UI、IPC、Rust 服务和落盘形成完整调用链。
3. 高风险写入必须可审查、可冲突检测、可恢复。
4. 优先拆分高内聚模块，不为“未来可能需要”创建空抽象。

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

Windows 开发版可以直接使用现有便携版资料。先关闭 `D:\NeuInk\Neuink.exe`，再运行 `npm --workspace apps/desktop run dev:d-data`。该命令默认读取 `D:\NeuInk\data`；如需其它目录，设置 `NEUINK_DEV_DATA_DIR` 为包含 `library` 的绝对路径。`npm --workspace apps/desktop run dev:d-data -- --check` 只检查路径；`npm --workspace apps/desktop run audit:sentences` 只读统计已保存的段落译文及逐句配对失败位置。

开发版会直接写入这份资料，调试前按需要自行备份。它和便携版共用资料锁，不能同时打开。路径覆盖只在 debug 构建生效，正式版仍使用程序旁的 `data`。

本机日常测试默认使用此开发入口，不在每次修改后替换 D 盘便携版。桌面“Neuink 开发测试”快捷方式通过 `apps/desktop/scripts/start-dev-windows.ps1` 后台启动同一流程；重复点击不会创建第二个开发进程组，启动记录位于 `target/desktop-dev/launcher.log`。前端修改由 Vite 更新，原生修改由 Tauri 开发进程重新编译；关闭开发窗口后，下次仍从该快捷方式启动。源码和 D 盘资料均保持原位置。

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
