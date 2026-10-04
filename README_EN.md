<p align="center">
  <img src="apps/desktop/src-tauri/logo_assets/neuink_logo_transparent_1024.png" width="108" alt="Neuink logo">
</p>

<h1 align="center">Neuink</h1>

<p align="center">
  <strong><a href="https://sugrsertraline.github.io/neuink/">Explore Neuink — Product Website →</a></strong><br>
  Features, real app screenshots, core concepts, and step-by-step tutorials.<br>
  <a href="https://sugrsertraline.github.io/neuink/start.html">Start reading</a> · <a href="https://sugrsertraline.github.io/neuink/screenshots.html">Screenshot guide</a> · <a href="https://cdn.sugrsertraline.top/Neuink-windows-x64-portable.zip">Download for Windows</a>
</p>

## Downloads and updates

**[Download Windows x64 portable ZIP (CDN)](https://cdn.sugrsertraline.top/Neuink-windows-x64-portable.zip)**

Fully extract the ZIP, keep the bundled resource folders, and run `Neuink.exe`. Do not run it from inside the archive.

Windows requires Windows 10 1903+ / 11 x64 and WebView2. To update, close the app, extract the new version to a new folder, and reopen your existing workspace.

macOS preview builds for Apple Silicon and Intel are available from successful [automated builds](https://github.com/SugrSertraline/neuink/actions/workflows/windows-portable.yml). They are not notarized or validated on a physical Mac; Gatekeeper may block launch. Embedded web pages and the video-caption runtime have not been ported. See [downloads and platform details](docs/deployment/packaging-and-distribution.md).

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

For parsing, reflow, or translation, follow the [PDF import and parsing tutorial](https://sugrsertraline.github.io/neuink/import.html) (Chinese). Reading an ordinary PDF does not require a parser service.

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

Install Node.js, npm, Rust stable, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```powershell
npm install
npm run desktop:dev
```

Basic reading and notes do not require a model service. See [packaging and distribution](docs/deployment/packaging-and-distribution.md) for model resources, browser-reading components, and release builds, and [engineering guidelines](docs/development/engineering-guidelines.md) for development checks.

## Documentation

- [Documentation index](docs/README.md)
- [Product requirements](docs/product/01-prd.md) and [system architecture](docs/architecture/system-architecture.md)
- [Development plan](docs/development/dev-plan.md): implementation status and pending validation
- [Engineering guidelines](docs/development/engineering-guidelines.md), [UI design system](docs/development/ui-design-system.md), and [system test cases](docs/development/system-test-cases.md)

## Licence

Neuink is licensed under [Apache-2.0](LICENSE). Third-party components retain their own licences; see the [component summary](docs/deployment/third-party-components.md) (Chinese) and [NOTICE](NOTICE).
