# Neuink 文档

**想了解功能或学习使用？请访问 [Neuink 官网与图文教程](https://sugrsertraline.github.io/neuink/)。**

[开始阅读](https://sugrsertraline.github.io/neuink/start.html) · [核心概念](https://sugrsertraline.github.io/neuink/concepts.html) · [实机界面图解](https://sugrsertraline.github.io/neuink/screenshots.html)

本目录只保留长期维护的权威文档。历史方案、阶段审计和已经完成的实施计划由 Git 历史保存，不再作为独立文件留在仓库。

面向用户的完整操作说明见[产品与使用手册](../website/README.md)，含 22 篇专题、站内搜索与 GitHub Pages 发布配置。网站源码与用户指南位于 `website/`；实现状态仍统一由本目录的开发计划维护。

## 权威文档

- [第三方组件与许可证](deployment/third-party-components.md)：主要依赖的许可证摘要与分发声明入口。

- [产品需求](product/01-prd.md)：产品定位、核心模型、能力边界和优先级。
- [系统架构](architecture/system-architecture.md)：当前真实模块、数据、搜索、Assistant 与写盘边界。
- [开发计划](development/dev-plan.md)：当前完成度、剩余工作和近期顺序。
- [工程规范](development/engineering-guidelines.md)：当前仓库实际执行的约束。
- [UI 设计与交互规范](development/ui-design-system.md)：桌面界面的视觉层级、组件复用、滚动、拖动、编辑器和验收标准。
- [本地 Agent 接入](development/local-agent.md)：Claude Code、Codex、OpenCode 的官方协议、MCP 工具桥接与笔记审阅边界。
- [P0 回归清单](development/p0-regression-checklist.md)：高风险用户闭环验收。
- [打包与发行](deployment/packaging-and-distribution.md)：当前可执行的构建方式和未完成发行项。
- [MinerU 输出参考](references/ref-mineru-output-files.md)：解析结果格式参考。

模块目录中的 Markdown 只有两类例外：

- 程序运行时 Prompt；
- 构建或模块边界确实需要的就近说明。

实现状态只在开发计划维护，避免 PRD、架构和多个专项状态页互相矛盾。
