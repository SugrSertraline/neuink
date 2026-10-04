# 第三方组件与许可证

Neuink 自身采用 [Apache License 2.0](../../LICENSE)。项目使用下列主要直接依赖；它们各自的许可证与声明在分发构建产物时仍然有效。

| 组件 | 在 Neuink 中的作用 | 许可证 |
| :--- | :--- | :--- |
| [Tauri](https://tauri.app/) 与 Tauri Plugins | 桌面运行时、原生对话框、HTTP | Apache-2.0 OR MIT |
| [React](https://react.dev/)、[Vite](https://vite.dev/)、[Tailwind CSS](https://tailwindcss.com/) | 用户界面与构建工具 | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) | PDF 渲染与文字提取 | Apache-2.0，字体／CMap／WASM 保留各自声明 |
| [Mozilla Readability](https://github.com/mozilla/readability) | 已加载网页正文提取，固定 0.6.0 原始源码 | Apache-2.0 |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp)／[EJS](https://github.com/yt-dlp/ejs) | 公开视频字幕及元信息 | Unlicense；EJS 捆绑组件另含 MIT／ISC |
| [CPython](https://www.python.org/)／[QuickJS-NG](https://github.com/quickjs-ng/quickjs) | 隔离媒体读取运行时 | PSF 及随附组件许可／MIT 及随附组件许可 |
| [subtp](https://crates.io/crates/subtp) | SRT／WebVTT 字幕语法解析 | MIT OR Apache-2.0 |
| [TipTap](https://tiptap.dev/)、[KaTeX](https://katex.org/)、[Mermaid](https://mermaid.js.org/) | Markdown 编辑、数学公式、图表 | MIT |
| [assistant-ui](https://www.assistant-ui.com/) | AI 对话界面 | MIT |
| [Vercel AI SDK](https://ai-sdk.dev/) 与 `@ai-sdk/openai-compatible` | 模型服务接入与流式响应 | Apache-2.0 |
| [FastEmbed](https://crates.io/crates/fastembed)、[Tokio](https://tokio.rs/)、[Reqwest](https://crates.io/crates/reqwest)、[Serde](https://serde.rs/)、[Rayon](https://github.com/rayon-rs/rayon) | 本地 embedding、异步、网络、序列化与并行搜索 | Apache-2.0、MIT 或 MIT OR Apache-2.0（以各 crate 声明为准） |
| [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small) | 可选本地 embedding 模型 | MIT |
| [MinerU](https://github.com/opendatalab/MinerU) | 可选 PDF 解析集成，不随本仓库分发 | MinerU Open Source License（基于 Apache-2.0，含附加条款） |

这是主要组件的可读摘要，不替代完整的第三方声明。精确的解析版本分别锁定在 [`package-lock.json`](../../package-lock.json) 与 [`Cargo.lock`](../../Cargo.lock)。发布安装包前，请为所有已解析的 npm / Cargo 依赖生成完整 notices，并复核任何一并分发的模型文件和外部服务条款。

媒体运行时另由 `apps/desktop/scripts/browser-reader-lock.json` 锁定官方来源和 SHA256，使用 PyPI wheel 而不是含额外 GPL 组件的官方 yt-dlp.exe。原始许可证与第三方声明随运行时保留；Readability、PDF.js 和 subtp 的声明随 `resources/reader-licenses` 分发。上游源码未改写，Neuink 仅负责目标授权、调度、输出整理及资源清理。

