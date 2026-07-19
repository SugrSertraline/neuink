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

## 8. 文档规则

- PRD 维护产品边界，不记录每日实现流水账；
- 系统架构只描述当前代码和稳定约束；
- 开发计划是实现状态唯一来源；
- 临时调查和实施计划完成后合并有效结论并删除；
- 不为每个短模块放重复 README；
- 程序运行时 Prompt 虽为 Markdown，但按代码资产管理。
