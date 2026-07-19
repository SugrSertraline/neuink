<p align="center">
  <img src="apps/desktop/src-tauri/logo_assets/neuink_logo_transparent_1024.png" width="108" alt="Neuink logo">
</p>

<h1 align="center">Neuink</h1>

<p align="center">
  <strong>简体中文</strong> · <a href="README_EN.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/SugrSertraline/neuink">GitHub Repository</a>
</p>

<p align="center">
  <strong>让每一次阅读，都留下可追溯的理解。</strong><br>
  A local-first workspace for reading, thinking, and building knowledge from PDFs.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/desktop-Windows%20%7C%20macOS-1f2937?style=flat-square" alt="Desktop platforms: Windows and macOS">
  <img src="https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square" alt="Tauri 2">
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square" alt="React 18">
  <img src="https://img.shields.io/badge/license-Apache--2.0-2563eb?style=flat-square" alt="Apache-2.0 license">
</p>

<p align="center">
  <img src="docs/assets/screenshots/reading-workspace.png" alt="Neuink 阅读工作台：PDF 原文、来源片段和双语预览" width="100%">
</p>

> **Neuink** 是一个面向论文、报告、标准和书籍章节的本地优先知识工作台。它把 PDF 阅读、结构化解析、笔记、检索和 AI 协作放进同一个 Workspace，并让结论始终能够回到原始证据。

## 从 PDF 到可验证的理解

```text
导入资料  →  解析结构  →  阅读与标注  →  连接笔记与来源  →  检索、提问与沉淀
```

Neuink 不把文献阅读理解成“看完一份文件”。它帮助你把页面、段落、表格和公式变成可定位的上下文；把笔记与证据相连；再用搜索和 AI 协作把零散阅读变成可以复查、复用的知识。

| 原文与结构化阅读 | 来源驱动的笔记 | 本地检索与 AI 协作 |
| :--- | :--- | :--- |
| 在 PDF 原始排版和 Reflow 重排阅读之间切换，定位章节、段落、列表、公式、表格与视觉块。 | 用 Markdown 记录想法，并插入可展开、可跳转、可导出脚注的 Source Link。 | 搜索条目、标签、字段、笔记、页面和片段；用显式上下文获得带来源的回答。 |

## 看得见的工作流

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/assets/screenshots/assistant-and-notes.png" alt="Neuink 的 AI 助手与学习笔记编辑器" />
      <br /><br />
      <strong>在上下文中写笔记</strong><br />
      AI 助手、来源链接和 Markdown 编辑器位于同一工作区。助手读取的是明确选择的上下文，任何笔记或元数据修改都会先以 Proposal 提出，等待你确认应用。
    </td>
    <td width="50%" valign="top">
      <img src="docs/assets/screenshots/pdf-notes-split-view.png" alt="Neuink 的 PDF 与笔记分屏阅读界面" />
      <br /><br />
      <strong>让原文与思考并排出现</strong><br />
      左侧保留 PDF 的原始版式和片段导航，右侧整理你的学习笔记。每个关键论断都可以带着页码和片段回到证据本身。
    </td>
  </tr>
</table>

## 核心能力

### 读得更深，而不是更快地翻页

- 导入 PDF，追踪解析状态，失败后可重试；保留原始 PDF 与规范化后的 Source Segment。
- 使用 PDF.js 阅读原文，利用悬停预览、片段定位、右键操作和来源面板保持阅读上下文。
- 在 Reflow 视图中阅读解析后的主体文本、列表、公式、表格与视觉内容；需要时可执行全文翻译、暂停、重试与导出。

### 让笔记成为证据网络

- 使用 TipTap Markdown 编辑器编写标题、列表、引用、代码、数学公式、图片、提示块和表格。
- 为笔记、批注、标签和自定义字段建立结构；Source Link 保留条目、页码、片段和文本快照。
- 从笔记预览原文、跳转回 PDF、查看反向引用，导出的 Markdown 仍保留可读脚注。

### 在本地资料库中检索与协作

- Keyword 搜索覆盖条目、标签、字段、Markdown Note、Segment Note、PDF 页面和 PDF Segment。
- 选配本地 embedding 模型后可使用 Semantic 与 Hybrid 搜索；模型不可用时，界面会明确提示并回退，不伪装为语义结果。
- AI 对话使用显式 `@` 上下文、资料库搜索和来源链接；工具过程、会话和提案状态会保存到 Workspace 中。

## 本地优先，但不牺牲扩展能力

| 默认在本地完成 | 按需接入的能力 | 你始终拥有控制权 |
| :--- | :--- | :--- |
| Workspace 是普通本地文件夹，是 PDF、笔记、标签、会话和派生文件的权威来源。阅读、编辑和关键词搜索不依赖网络。 | 解析可连接 MinerU Cloud 或兼容的自定义端点；AI 模型由你自行选择和配置。 | API Key 不写入 Workspace 或导出内容；缓存可删除重建；AI 不会静默写入，需由你确认 Proposal 后才会应用。 |

### MinerU、模型与服务边界

- **MinerU**：Neuink 集成 MinerU Cloud 和兼容解析端点，用于将 PDF 转换为适合重排阅读、片段定位和来源链接的结构化结果。MinerU 是可选外部解析能力，不随本仓库或主应用捆绑；使用云端服务时请自行核对其服务条款与数据处理规则。
- **本地语义模型**：Semantic / Hybrid 搜索使用可选的本地 `intfloat/multilingual-e5-small` 兼容资源。模型文件很大、默认不提交 Git，也不会在运行时静默下载；没有模型时，应用依然可用，只是不提供语义搜索。
- **LLM**：Neuink 不内置大语言模型。你可在设置中配置自己的模型服务；基础阅读、笔记和关键词搜索不依赖 LLM。

## 快速开始

### 环境要求

- Node.js 与 npm
- Rust stable，以及 [Tauri 2 平台前置依赖](https://v2.tauri.app/start/prerequisites/)
- 仅在需要 PDF 解析时准备 MinerU Cloud Token 或兼容 Parser Endpoint
- 仅在需要 AI 协作时配置 LLM Profile

```powershell
npm install
npm run desktop:dev
```

首次启动后可以创建或打开一个本地 Workspace。即使未配置 `.env`、模型或 LLM，也可以进行基础阅读、笔记和关键词搜索。

<details>
<summary><strong>可选：配置 MinerU Cloud</strong></summary>

复制模板后按需填写。不要提交真实的 `.env` 或任何 API Key。

```powershell
Copy-Item .env.example .env
```

</details>

<details>
<summary><strong>可选：启用本地语义搜索</strong></summary>

将兼容的 `intfloat/multilingual-e5-small` 资源置于：

```text
apps/desktop/src-tauri/resources/embedding-models/default/
```

模型目录受 Git 忽略规则保护。完整发行带模型的应用前，请核对模型许可证、文件完整性和实际加载结果。

</details>

## 构建与验证

```powershell
# TypeScript 检查与前端构建
npm run desktop:build

# Rust 检查、Rust 测试、前端测试
npm run check
npm run test
npm --workspace apps/desktop run test:frontend

# 构建原生 Tauri bundle
npm --workspace apps/desktop run tauri -- build
```

构建 Windows 便携版 ZIP：

```powershell
npm run desktop:release:portable
```

该命令输出 `release/Neuink-portable-<timestamp>.zip`，仅携带 `.env.example`，不会打包本机 `.env` 凭据。当前便携版流程要求本地 embedding 资源存在。

## 项目结构

```text
apps/desktop/   Tauri 桌面壳、React UI 与打包脚本
crates/         Rust 领域、Workspace、解析、搜索、任务、配置与 IPC
docs/           产品、架构、工程规范、回归与发行文档
```

从 [文档索引](docs/README.md) 开始；进一步可查看[产品需求](docs/product/01-prd.md)、[系统架构](docs/architecture/system-architecture.md)和[打包与发行](docs/deployment/packaging-and-distribution.md)。

## 开源组件与许可证

Neuink 自身采用 [Apache License 2.0](LICENSE)。项目使用下列主要直接依赖；它们各自的许可证与声明在分发构建产物时仍然有效。

| 组件 | 在 Neuink 中的作用 | 许可证 |
| :--- | :--- | :--- |
| [Tauri](https://tauri.app/) 与 Tauri Plugins | 桌面运行时、原生对话框、HTTP | Apache-2.0 OR MIT |
| [React](https://react.dev/)、[Vite](https://vite.dev/)、[Tailwind CSS](https://tailwindcss.com/) | 用户界面与构建工具 | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) | 原始 PDF 渲染 | Apache-2.0 |
| [TipTap](https://tiptap.dev/)、[KaTeX](https://katex.org/)、[Mermaid](https://mermaid.js.org/) | Markdown 编辑、数学公式、图表 | MIT |
| [assistant-ui](https://www.assistant-ui.com/) | AI 对话界面 | MIT |
| [Vercel AI SDK](https://ai-sdk.dev/) 与 `@ai-sdk/openai-compatible` | 模型服务接入与流式响应 | Apache-2.0 |
| [FastEmbed](https://crates.io/crates/fastembed)、[Tokio](https://tokio.rs/)、[Reqwest](https://crates.io/crates/reqwest)、[Serde](https://serde.rs/)、[Rayon](https://github.com/rayon-rs/rayon) | 本地 embedding、异步、网络、序列化与并行搜索 | Apache-2.0、MIT 或 MIT OR Apache-2.0（以各 crate 声明为准） |
| [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small) | 可选本地 embedding 模型 | MIT |
| [MinerU](https://github.com/opendatalab/MinerU) | 可选 PDF 解析集成，不随本仓库分发 | MinerU Open Source License（基于 Apache-2.0，含附加条款） |

这是主要组件的可读摘要，不替代完整的第三方声明。精确的解析版本分别锁定在 [`package-lock.json`](package-lock.json) 与 [`Cargo.lock`](Cargo.lock)。发布安装包前，请为所有已解析的 npm / Cargo 依赖生成完整 notices，并复核任何一并分发的模型文件和外部服务条款。

## License

Neuink is licensed under [Apache-2.0](LICENSE). Third-party component guidance is available in [NOTICE](NOTICE).
