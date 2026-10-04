<p align="center">
  <img src="apps/desktop/src-tauri/logo_assets/neuink_logo_transparent_1024.png" width="108" alt="Neuink logo">
</p>

<h1 align="center">Neuink</h1>

## Downloads and updates

- [Published releases](https://github.com/SugrSertraline/neuink/releases): check the release date and notes. Download `Neuink-windows-x64-portable.zip`, not GitHub's Source code archive. The old Beta 1 executable does not represent current main-branch features.
- [Development builds](https://github.com/SugrSertraline/neuink/actions/workflows/windows-portable.yml): open a successful `main` run and download its commit-labelled artifact (GitHub sign-in required; retained for 14 days). Artifacts become available only after the workflow has been pushed and completed successfully.
- Extract the artifact, then fully extract the portable ZIP and run `Neuink.exe`. Windows 10 1903+/11 x64 and WebView2 are required. Windows builds are currently unsigned.
- macOS preview builds: use `Neuink-macos-arm64.app.zip` for Apple Silicon or `Neuink-macos-x64.app.zip` for Intel, extract and move `Neuink.app` to Applications. Embedding is inside the app bundle, while user data is separate. Builds are ad-hoc signed, not notarized, and may be blocked by Gatekeeper; do not disable system security globally. Native Mac validation is pending. Windows-only embedded browser and video subtitle runtime have not been ported. Downloads appear only after successful cloud builds.
- Packages include embedding resources and browser-reading dependencies. Demo assets are optional: consult `build-info.json` (`demoIncluded`). Cloud builds omit the untracked tutorial paper by default.
- Back up your workspace, close the old app, and extract updates to a new folder. Do not delete your workspace. Verify the source commit in `build-info.json` and download integrity with `SHA256SUMS.txt`.

Main-branch pushes run tests and build artifacts; version tags create reviewable Release drafts rather than automatically publishing untested releases.

<p align="center">
  <a href="README.md">简体中文</a> · <strong>English</strong>
</p>

<p align="center">
  <a href="https://github.com/SugrSertraline/neuink">GitHub Repository</a>
</p>

<p align="center">
  <strong>Make every reading insight traceable.</strong><br>
  A local-first workspace for literature, evidence-linked notes, and AI-assisted research.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/desktop-Windows%20%7C%20macOS-1f2937?style=flat-square" alt="Desktop platforms: Windows and macOS">
  <img src="https://img.shields.io/badge/Tauri-2-24c8db?style=flat-square" alt="Tauri 2">
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square" alt="React 18">
  <img src="https://img.shields.io/badge/license-Apache--2.0-2563eb?style=flat-square" alt="Apache-2.0 license">
  <a href="https://linux.do"><img src="https://img.shields.io/badge/LINUX-DO-FFB003.svg?logo=data:image/svg%2bxml;base64,DQo8c3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiPjxwYXRoIGQ9Ik00Ni44Mi0uMDU1aDYuMjVxMjMuOTY5IDIuMDYyIDM4IDIxLjQyNmM1LjI1OCA3LjY3NiA4LjIxNSAxNi4xNTYgOC44NzUgMjUuNDV2Ni4yNXEtMi4wNjQgMjMuOTY4LTIxLjQzIDM4LTExLjUxMiA3Ljg4NS0yNS40NDUgOC44NzRoLTYuMjVxLTIzLjk3LTIuMDY0LTM4LjAwNC0yMS40M1EuOTcxIDY3LjA1Ni0uMDU0IDUzLjE4di02LjQ3M0MxLjM2MiAzMC43ODEgOC41MDMgMTguMTQ4IDIxLjM3IDguODE3IDI5LjA0NyAzLjU2MiAzNy41MjcuNjA0IDQ2LjgyMS0uMDU2IiBzdHlsZT0ic3Ryb2tlOm5vbmU7ZmlsbC1ydWxlOmV2ZW5vZGQ7ZmlsbDojZWNlY2VjO2ZpbGwtb3BhY2l0eToxIi8+PHBhdGggZD0iTTQ3LjI2NiAyLjk1N3EyMi41My0uNjUgMzcuNzc3IDE1LjczOGE0OS43IDQ5LjcgMCAwIDEgNi44NjcgMTAuMTU3cS00MS45NjQuMjIyLTgzLjkzIDAgOS43NS0xOC42MTYgMzAuMDI0LTI0LjM4N2E2MSA2MSAwIDAgMSA5LjI2Mi0xLjUwOCIgc3R5bGU9InN0cm9rZTpub25lO2ZpbGwtcnVsZTpldmVub2RkO2ZpbGw6IzE5MTkxOTtmaWxsLW9wYWNpdHk6MSIvPjxwYXRoIGQ9Ik03Ljk4IDcwLjkyNmMyNy45NzctLjAzNSA1NS45NTQgMCA4My45My4xMTNRODMuNDI2IDg3LjQ3MyA2Ni4xMyA5NC4wODZxLTE4LjgxIDYuNTQ0LTM2LjgzMi0xLjg5OC0xNC4yMDMtNy4wOS0yMS4zMTctMjEuMjYyIiBzdHlsZT0ic3Ryb2tlOm5vbmU7ZmlsbC1ydWxlOmV2ZW5vZGQ7ZmlsbDojZjlhZjAwO2ZpbGwtb3BhY2l0eToxIi8+PC9zdmc+" alt="LINUX DO"></a>
</p>

> **Neuink** brings library management, PDF and web reading, cross-paper comparison, evidence-linked notes, search, and AI research into one local workspace. Return from an insight to its source, or export your work as independent files.

**Organize → Read and compare → Connect notes to evidence → Search and research → Export and share**

[Core features](#core-features) · [Getting started](#getting-started) · [Local and online capabilities](#local-and-online-capabilities) · [Development and builds](#development-and-builds) · [Documentation](#documentation)

## Complete product guide

The [documentation website](website/README.md) contains 21 detailed guides in Chinese, covering workflows, controls, data boundaries, and troubleshooting, with section search and mobile navigation. It is published on GitHub Pages at [Neuink Product & User Guide](https://sugrsertraline.github.io/neuink/). The [guide sources](website/content) can also be read directly in this repository.

## Core features

### 1. A library organized around research topics

- Create entries, import or batch-drop PDFs, and manage titles, descriptions, hierarchical tags, and custom fields. Browse in a table or bookshelf.
- Import MinerU client result ZIPs or connect a self-hosted compatible parser. Track queued, running, and failed parsing jobs and retry failures.
- Browse papers by tag and descendant tags, with reading progress, page positions, and notes. Use the corresponding trash views to recover deleted entries, notes, and tags.
- Explore tag hierarchies, paper membership, note ownership, and source references in the relationship graph. Search, filter, and open related content. These are stored relationships, not an automatically discovered academic citation network.

### 2. A reading workspace for originals, reflow, and comparison

- **Original PDFs:** retain page layout with outlines, zoom, segment navigation, hover previews, annotations, and segment notes. PDFs can be read before parsing.
- **Reflow:** read parsed paragraphs, lists, formulas, tables, and figures, switching between original images and parsed content where available.
- **Translation:** use a configured model for selections, segments, or full papers. View original and translated text; pause, resume, cancel, or retry full-paper translation tasks.
- **Parallel reading by tag:** open a paper and a comparison paper from the same topic. Read each pane independently and work with document notes or tag-level synthesis notes.
- **Tabs and split views:** arrange PDFs, reflow, notes, complete assistant replies, and web pages using sortable, pinnable tabs and left/right panes. A task panel collects parsing, translation, paper-import, and assistant activity.

### 3. Evidence-linked notes

- Write document notes and tag-level synthesis notes in a Markdown editor with an outline, tables, images, code, math, and Mermaid diagrams.
- Capture segment notes and annotations; Source Links retain the entry, page, segment, and text snapshot.
- Preview sources, jump back to the original, and inspect backlinks. Document-note Markdown exports retain readable source footnotes.
- Unsaved-content protection covers closing, moving between panes, and switching workspaces; version checks protect against overwriting changed content.

### 4. Local search and AI-assisted research

- **Local search:** keyword search covers entries, tags, fields, document notes, segment notes, PDF pages, and parsed segments. Optional local embeddings enable semantic and hybrid search, with explicit fallback when unavailable.
- **Context-aware conversations:** associate the current reading object, attach entries, tags, notes, or segments with `@`, or disconnect content. Conversations retain sources, tool activity, and proposal states.
- **Reviewable changes:** document-note, tag, and metadata changes are proposed for review before you apply them. General Agent writing to tag-level synthesis notes is not yet connected.
- **Online research:** built-in paper search, web search, and content reading use configured sources including arXiv, Crossref, OpenAlex, and optional Tavily or Sciverse. Adding candidates requires confirmation; results distinguish downloaded PDFs from metadata-only entries.
- **Model choice:** configure OpenAI-compatible, Anthropic, or Google connections and select separate models for the assistant and translation.

### 5. Web reading within your research workspace

On Windows, native web tabs provide an address bar, back/forward navigation, independent zoom, and split views, with up to eight web tabs. Associate a page with the assistant to read its body or selection on demand and propose a document note.

| Content | Current reading scope |
| :--- | :--- |
| Web pages | Extract the loaded article, with bounded visible-text fallback for non-article pages. |
| Public PDFs | Extract text from the first eight pages by default, or a requested range of 1–20 pages per call. Report coverage; no automatic OCR or library import. |
| Individual YouTube / Bilibili videos | Read public descriptions and available Chinese or English captions. Missing captions and restrictions are explicit; this does not analyze video frames or audio. |

Opening a web tab does not automatically send its body to the model. Public PDF and video reads may fetch the resource again without browser cookies. Platform limits are listed below.

### 6. Export and share reading results

| Content | Supported output |
| :--- | :--- |
| Parsed full text, Chinese translation, bilingual manuscript | DOCX, TXT, or a Markdown ZIP with images; includes content checks and previews of missing items. |
| A paper's document notes, segment notes, annotations, and translated segments | Select items for a combined DOCX/TXT or a ZIP of individual DOCX/TXT files. |
| Document-note Markdown | Save a local MD file with readable source footnotes. |

Exports use saved data, independent of collapsed sections or virtual scrolling. Missing translations, stale results, and missing images are listed; you can explicitly export a draft with these caveats. Word output preserves content structure rather than reproducing the PDF's layout. Chinese PDFs, annotated PDFs, and PPTX are not current export formats.

## Interface examples

Read the [illustrated user guide](https://sugrsertraline.github.io/neuink/screenshots.html) (Chinese) for core concepts, feature entry points, and step-by-step workflows. The workspace below places the original PDF beside evidence-linked notes.

![Neuink: original PDF alongside evidence-linked demo notes](website/public/screenshots/pdf-note-workspace.png)


## Getting started

### If you already have a Windows portable build

Extract the complete archive and open `Neuink.exe`, keeping its resource directories beside it. Node.js and Rust are not needed; Microsoft Edge WebView2 Runtime is required. Portable builds use the application's existing workspace and settings locations, so user data is not necessarily stored beside the executable.

The project version is **0.1.0**. A Windows portable build workflow exists; signing, in-app updates, and native distribution validation still have outstanding work. See [packaging and distribution](docs/deployment/packaging-and-distribution.md) for automated builds, downloads, and platform validation status.

### Your first paper

1. **Create or open a workspace** in the data settings. Onboarding introduces the main controls; offline examples depend on the build including demo assets.
2. **Import a PDF** to read immediately. For structured content, follow the in-app MinerU client guide: parse externally, export the complete results as a ZIP, then import them into Neuink.
3. **Organize and compare:** assign topic tags, open PDF or Reflow, and choose another paper from the same-tag list for comparison.
4. **Capture evidence:** create a document or tag-level note, insert Source Links, and save.
5. **Enable AI as needed:** configure connections and assign assistant/translation models, select your context, ask questions, and review proposed changes.
6. **Export:** use the PDF/Reflow export action for manuscripts, or the document note / entry overview for selected reading results.

**MinerU ZIP requirements:** include `content_list_v2.json` or compatible `content_list.json` and referenced images. Creating an entry from a ZIP also requires the original PDF; importing results into an existing PDF entry does not. This path needs no parser URL or API key in Neuink.

Alternatively, configure a self-hosted MinerU-compatible URL and optional API key. Automatic parsing after PDF import is off by default. Parser and LLM settings are independent.

## Local and online capabilities

| Capability | Requirements and data scope |
| :--- | :--- |
| Library management, PDF / parsed-content reading, notes, keyword search, saved-result exports | Local; no LLM or online parser required. |
| Semantic / hybrid search | Optional local embedding resources; no silent runtime model downloads. |
| Structured PDF parsing | Import an existing MinerU ZIP or send the PDF to your configured compatible parser. |
| AI conversations and translation | Your configured model service receives the relevant context. |
| Online paper / web research | Network access; optional services also depend on credentials, permissions, and quotas. |
| Embedded web pages / video captions | Native embedding currently runs on Windows; the bundled video runtime currently targets Windows x64. |

A Workspace is a normal local folder containing PDFs, notes, annotations, tags, translations, and conversations. Search caches can be rebuilt. API keys are not part of the Workspace or sharing bundles. Workspace migration copies and verifies data while retaining the original directory.

**Scope:** the local graph displays existing relationships. Automated research-direction maps, evidence comparison tables, dragging tabs into separate native windows, and team cloud collaboration are not among the implemented features described here. The [development plan](docs/development/dev-plan.md) tracks completion and remaining work.

## Development and builds

### Run from source

Install Node.js, npm, Rust stable, and the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/), then run from the repository root:

```powershell
npm install
npm run desktop:dev
```

Basic reading and notes require no `.env`, LLM, or embedding model. Configure parsers and models in the app. `.env.example` only contains optional legacy MinerU endpoint configuration, not a MinerU Cloud Token template.

<details>
<summary>Optional: enable local semantic search</summary>

Place FastEmbed-compatible `intfloat/multilingual-e5-small` resources in:

```text
apps/desktop/src-tauri/resources/embedding-models/default/
```

See the [model directory guide](apps/desktop/src-tauri/resources/embedding-models/default/README.md) for required files. Actual model files are Git-ignored. Restart after preparing them; keyword search and the app remain usable without them.

</details>

<details>
<summary>Windows x64: prepare web / video reading resources</summary>

```powershell
npm --workspace apps/desktop run prepare:browser-reader
npm --workspace apps/desktop run verify:browser-reader
```

Preparation explicitly downloads and verifies pinned Python, yt-dlp, EJS, and QuickJS-NG resources; users do not need a separate Python installation. The [resource lockfile](apps/desktop/scripts/browser-reader-lock.json) records versions, sources, and SHA256 hashes. Normal operation does not install or update these resources automatically. Missing resources warn in development and fail Windows x64 release builds. See [packaging](docs/deployment/packaging-and-distribution.md) for details.

</details>

### Verify and package

```powershell
# TypeScript checks and frontend build
npm run desktop:build

# Rust checks, Rust tests, frontend tests
npm run check
npm run test
npm --workspace apps/desktop run test:frontend

# Prepare and verify Windows x64 reading resources before release
npm --workspace apps/desktop run prepare:browser-reader
npm --workspace apps/desktop run verify:browser-reader

# Native Tauri bundle
npm --workspace apps/desktop run tauri -- build

# Or a Windows portable ZIP
npm run desktop:release:portable
```

The portable workflow produces `release/Neuink-portable-<timestamp>.zip`, currently requires complete local embedding resources, and excludes local `.env` credentials. Optional tutorial assets are not required for a normal build.

`desktop:build` only builds the frontend; it does not update a standalone executable. `desktop:dev` and debug executables depend on a local frontend server. Rebuild a native bundle or portable package to use current code independently.

## Documentation

```text
apps/desktop/   Tauri desktop shell, React UI, packaging scripts
crates/         Rust domain, Workspace, parsing, search, jobs, config, research, IPC
docs/           Product, architecture, engineering, regression, distribution
```

- [Documentation index](docs/README.md)
- [Product requirements](docs/product/01-prd.md) and [system architecture](docs/architecture/system-architecture.md)
- [Development plan](docs/development/dev-plan.md): implementation status and pending validation
- [Engineering guidelines](docs/development/engineering-guidelines.md), [UI design system](docs/development/ui-design-system.md), and [system test cases](docs/development/system-test-cases.md)

## Open-source components and licences

Neuink itself is licensed under [Apache License 2.0](LICENSE). The project uses the following important direct dependencies; their own licences and notices remain applicable when you distribute a build.

| Component | Role in Neuink | Licence |
| :--- | :--- | :--- |
| [Tauri](https://tauri.app/) and Tauri plugins | Desktop runtime, native dialogs, HTTP | Apache-2.0 OR MIT |
| [React](https://react.dev/), [Vite](https://vite.dev/), [Tailwind CSS](https://tailwindcss.com/) | User interface and build tooling | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) | Original PDF rendering | Apache-2.0 |
| [TipTap](https://tiptap.dev/), [KaTeX](https://katex.org/), [Mermaid](https://mermaid.js.org/) | Markdown editing, mathematics, and diagrams | MIT |
| [assistant-ui](https://www.assistant-ui.com/) | AI chat interface | MIT |
| [Vercel AI SDK](https://ai-sdk.dev/) and `@ai-sdk/openai-compatible` | Model-service integration and streaming responses | Apache-2.0 |
| [FastEmbed](https://crates.io/crates/fastembed), [Tokio](https://tokio.rs/), [Reqwest](https://crates.io/crates/reqwest), [Serde](https://serde.rs/), [Rayon](https://github.com/rayon-rs/rayon) | Local embeddings, async runtime, networking, serialization, and parallel search | Apache-2.0, MIT, or MIT OR Apache-2.0, as declared by each crate |
| [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small) | Optional local embedding model | MIT |
| [MinerU](https://github.com/opendatalab/MinerU) | Optional PDF parsing integration; not distributed by this repository | MinerU Open Source License (Apache-2.0 based, with additional terms) |

This is a readable summary of primary components, not a replacement for complete third-party notices. Exact resolved versions are locked in [`package-lock.json`](package-lock.json) and [`Cargo.lock`](Cargo.lock). Before publishing an installer, generate full notices for every resolved npm and Cargo dependency, and review the terms of every model file or external service you distribute or operate.

## Licence

Neuink is licensed under [Apache-2.0](LICENSE). Third-party component guidance is available in [NOTICE](NOTICE).
