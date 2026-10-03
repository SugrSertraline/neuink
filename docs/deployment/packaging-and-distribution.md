# 打包与发行

> 当前版本：0.1.0
>
> 状态：Tauri bundle 配置已存在；正式签名、更新和发布流水线尚未建立。

## 1. 当前构建

环境需要 Node.js、npm、Rust 和 Tauri 2 对应的系统依赖。

```powershell
npm install
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

## 5. 尚未完成

- Windows 代码签名和 SmartScreen 验收；
- macOS codesign、notarization 和实际 bundle 验收；
- CI 构建与 Release artifact；
- Tauri updater、stable/preview 渠道和回滚；
- 安装包体积基准；
- 自动化全新机器冒烟测试。

这些完成前不能把“正式跨平台发行”标记为已完成。
