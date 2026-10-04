# 打包与发行

> 当前版本：0.1.0
>
> 状态：Tauri 与 Windows Actions 构建流程已配置；云端运行结果以 Actions 为准。签名、应用内自动更新及 macOS 验收尚未完成。

## 1. 当前构建

环境需要 Node.js、npm、Rust 和 Tauri 2 对应的系统依赖。

```powershell
npm install
node apps/desktop/scripts/embedding-resources.cjs
npm --workspace apps/desktop run prepare:browser-reader
npm run desktop:build
npm --workspace apps/desktop run tauri -- build
```

前端构建执行 TypeScript 检查和 Vite build。Tauri 配置位于：

```text
apps/desktop/src-tauri/tauri.conf.json
```

当前 bundle：

- `productName`：Neuink；
- `identifier`：`com.neuink.workspace`；
- `targets`：`all`；
- 包含 `resources/embedding-models/default/**/*`；
- 使用仓库内 Windows/macOS 图标资源。

Windows x64 免安装 ZIP 使用：

```powershell
npm run desktop:release:portable
```

脚本先执行前端类型检查与构建，再生成 Tauri release 程序，输出到 `release/Neuink-portable-时间戳.zip`。压缩包包含 `Neuink.exe`、本地 embedding 模型、空值配置模板和中文使用说明；不包含模型下载缓存、个人资料库或本机密钥。已有同名发行目录不会被覆盖。完整解压后双击 `Neuink.exe`，不需要 Node.js、Rust 或开发服务；系统需有 Microsoft Edge WebView2 Runtime。

免安装版沿用应用资料库及设置位置，并非所有用户数据都随 EXE 存放。模型与 MinerU 服务仍由使用者配置；同机启动会使用已有设置。`--skip-build` 只适合重新组装已核验的 release 产物，不应代替新版本构建。

## 2. Embedding 资源

默认模型目录：

```text
apps/desktop/src-tauri/resources/embedding-models/default/
```

真实模型文件不提交 Git。目录中的 README 同时是构建 glob 的占位文件。

- 模型存在：加载本地 `intfloat/multilingual-e5-small` 兼容资源；
- 模型缺失：应用仍可运行，Semantic 不可用；
- 运行时不应静默下载模型。

发布包含语义搜索的安装包前，必须在构建环境放入完整模型并验证文件许可、大小和加载结果。

## 3. 外部能力

- Parser 可连接用户配置的 MinerU 兼容端点，也可直接导入 MinerU 客户端 ZIP；
- LLM 由用户配置，不随安装包内置；
- 本地资料阅读、笔记和关键词搜索不应依赖 LLM；
- 主安装包不捆绑 Python MinerU 服务或大型语言模型。

### 网页内容读取组件

Windows x64 的 `prepare:browser-reader` 从官方固定地址显式下载并校验 Python 嵌入运行时、yt-dlp／EJS wheel 与 QuickJS-NG；不使用系统 Python，不包含官方 yt-dlp.exe。版本和 SHA256 在 `apps/desktop/scripts/browser-reader-lock.json`。运行时约 34 MiB，原始许可证及捆绑组件声明保留在 `resources/browser-reader`；原版 Readability、PDF.js 和 subtp 的许可另随 `resources/reader-licenses` 携带。

`npm --workspace apps/desktop run verify:browser-reader` 检查文件集、哈希及离线版本。`tauri.cjs` 的 dev/build/bundle 入口与便携脚本共用资源校验和复制，Windows x64 发行缺组件时明确失败，开发模式只警告；应用不会后台下载安装。视频仅读公开简介和可用字幕，没有音视频下载、自动播放、登录 cookies 或付费转写。其它平台暂不提供该视频运行时，普通网页／PDF 的读取逻辑独立保留。

## 4. 发布前检查

- [ ] 在无开发依赖的干净 Windows 环境安装和启动；
- [ ] 创建/选择 Workspace，导入 PDF，解析、阅读、笔记和重启恢复；
- [ ] 无 Embedding 模型时安全启动；
- [ ] 带模型构建时 Semantic/Hybrid 正常；
- [ ] 断网时已解析 PDF、笔记、Keyword 搜索和历史数据可用；
- [ ] 卸载不会删除用户 Workspace；
- [ ] 安装包中不包含 API Key、开发 Workspace 或测试资料；
- [ ] 图标、版本、identifier 和升级兼容性核对；
- [ ] Rust 与前端测试通过。

## 5. GitHub 自动构建与下载

工作流：`.github/workflows/windows-portable.yml`（沿用文件名，展示名 Desktop portable），Windows 2022、macOS 15 arm64 和 macOS 15 Intel runner；Node 24、Rust 1.96.0。

- PR 到 main：前端、打包脚本与 Rust 测试、前端编译，只读权限，不创建发布。
- main 提交／手动 Run workflow：验证成功后构建 Windows x64 便携 ZIP，上传保留 14 天的 commit 标记 Artifact。
- 推送 `v0.1.0-beta.2` 这类版本标签：同样验证并构建，再生成 **draft Release**；带预发布后缀的标签标记为 prerelease。已有 Release 不会覆盖，失败需人工核对。
- 维护者从草稿下载并人工验收后点 Publish。只有这一步之后普通用户才可从 Releases 页面下载，无需 Actions 登录。不要把构建成功等同于人工验收。
- Release 生成独立低权限构建产物后，只有草稿发布 job 获得 `contents: write`。不使用 `pull_request_target`，不向 PR 暴露发布凭据。Actions 依赖固定到 commit。

embedding 由 `embedding-resources.cjs` 从 Hugging Face 固定 revision 下载并逐文件校验 SHA256，保留模型卡；已有不匹配文件不会覆盖。网页读取组件沿用固定资源锁。缺任一必需组件构建失败，不能发布一个表面成功的残缺包。

演示 PDF/解析文件不在 Git 中，云端不从个人资料库取文件，也不临时下载论文。缺失时沿用现有无演示打包机制，`build-info.json` 与 Release 说明明确标注。当前本地演示素材 NOTICE 要求公开分发前确认授权，不能直接把含该素材的本地包上传为公共发行版。

发行目录 `release/publish/` 包含固定下载文件名 `Neuink-windows-x64-portable.zip`、`build-info.json`、`SHA256SUMS.txt` 和草稿说明。准备脚本要求仅有一个新便携 ZIP，拒绝混入旧包或覆盖已有发布目录。`build-info.json` 同时记录版本、ref、完整 commit、构建时间及演示包含状态。

首次启用：将流程提交推送到 main，等待 Actions 全部成功，再下载测试。需要正式更新 Releases 时创建新的版本标签，不修改旧标签、不覆盖 Beta 1 附件。公共下载推荐链接到 Releases 列表；预发布不会必然成为 `/releases/latest`。

版本门禁：`release-version.cjs` 在构建前检查根目录/桌面端 package.json、npm lock 中的对应版本、Tauri 配置和 Rust workspace 版本一致。标签必须与完整版本严格对应，包括 beta 后缀：发布 `v0.1.0-beta.2` 前，以上版本必须同步为 `0.1.0-beta.2`，并更新 Cargo.lock 后提交。当前 `0.1.0` 不会被自动改版本或以 beta.2 冒名发布。Windows/Mac 附件准备时再次校验。

### macOS 预览包

macOS job 使用 GitHub 的真实 Mac runner 编译，不在 Windows 上伪造交叉构建。Apple Silicon 对应 `aarch64-apple-darwin`，Intel 对应 `x86_64-apple-darwin`。PR 会检查两种目标；主分支与标签还构建 `.app`。

Mac 在原生 `cargo check` 前无条件运行 `prepare:resources`。全新 checkout 缺少演示素材时也生成 `included:false` 状态文件，避免被 Git 忽略的本地生成文件造成云端检查失败；PR 路径同样准备。

embedding 使用 HTTPS curl 下载并校验后安装。Tauri 将 embedding、许可证及可用的演示素材纳入 `Contents/Resources`；不复制 Windows DLL、WebView2 或 Python EXE。打包脚本检查资源、演示状态、Mach-O 架构与签名，用 `ditto` 保留执行权限和符号链接，生成 `Neuink-macos-{arm64,x64}.app.zip`，附独立元数据及 SHA256。三个平台成功后才创建统一 Release 草稿。

Mac 包仅 ad-hoc 签名，不是 Developer ID 签名，也未 notarization；正式分发仍需开发者身份、公证与实机验收。Gatekeeper 可能阻止运行，不建议关闭系统安全防护。Windows 内嵌网页和视频字幕运行时尚未移植，元数据明确为 false。其余功能也需实机验收，不能由脚本测试推断功能完全对等。

## 6. 尚未完成

- Windows 代码签名和 SmartScreen 验收；
- macOS codesign、notarization 和实际 bundle 验收；
- 首次云端完整构建和 Release 草稿人工验收（不能由本地测试代替）；
- Tauri updater、stable/preview 渠道和回滚；
- 安装包体积基准；
- 自动化全新机器冒烟测试。

这些完成前不能把“正式跨平台发行”标记为已完成。
