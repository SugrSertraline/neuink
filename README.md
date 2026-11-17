<p align="center">
  <img src="apps/desktop/src-tauri/logo_assets/neuink_logo_transparent_1024.png" alt="Neuink" width="108">
</p>

<h1 align="center">Neuink</h1>
<p align="center"><strong>让每一次阅读，都留下可追溯的理解。</strong></p>
<p align="center">本地优先的 Windows 文献阅读与知识工作台</p>
<p align="center">
  <a href="https://sugrsertraline.github.io/neuink/">官网与使用手册</a> ·
  <a href="https://cdn.sugrsertraline.top/Neuink-windows-x64-portable.zip">下载 Windows 便携版</a> ·
  <a href="https://github.com/SugrSertraline/neuink/releases">GitHub 下载</a> ·
  <a href="README_EN.md">English</a>
</p>

Neuink 把论文整理、PDF 阅读、双语对照、证据笔记和 AI 助手放在同一个工作台里。你可以从一篇 PDF 开始，也可以接入已有的 Zotero 资料，在阅读过程中逐步形成自己的知识库。

资料默认保存在本机。基础阅读与笔记不要求登录；解析、翻译、AI 和校园网同步按需启用。

## 一边阅读，一边留下证据

- **PDF 与重排阅读**：保留原始版式，也能按段落、公式、表格和图片连续阅读。多标签与左右分屏方便原文、译文和笔记相互对照。
- **双语与阅读详略**：从原文切换到精简、要点、结论或主题；生成中英对应结果，按需要切换详略。支持划词、片段和全文翻译。
- **带来源的笔记**：文档笔记、标签综合笔记、片段记录和批注各有位置。来源链接保留快照，点击即可回到对应原文。
- **接着上次读**：保留阅读位置、收藏与阅读记录，从最近阅读继续；同主题论文可以平行阅读。

## 按你的方式整理资料

条目库有 **纯表格、纯标签文件夹、标签与表格** 三种视图。像浏览文件夹一样逐层寻找论文，也可以在表格里比较年份、期刊、会议和其他属性。

**标签负责归类，属性负责描述。** 同一篇论文可以属于多个主题，无需重复复制 PDF。

| 能力 | 可以怎样使用 |
| --- | --- |
| 统一属性管理 | 在独立页面定义整个资料库的属性；支持文本、数字、日期、单选、多选和是否。日期可精确到年、月或日。 |
| 常用发表信息 | 内置出版类型、期刊／会议名称、发表年份、DOI、JCR 分区、CCF 等级等字段，也可添加自己的属性。 |
| 表格内快速编辑 | 点击属性值即可编辑；选项更换后自动保存，也可以留空，无需逐篇打开详情。 |
| 自定义表头 | 在表头设置对话框中拖动排序、调整显示列；表格支持改变列宽，操作按空间自动收进“更多”。 |
| 在线查找属性 | 从 arXiv、Crossref 搜索候选，核对后填充支持的空白属性；保留已有值。论文评价等级由你填写。 |

已有 Zotero 资料可以直接接入，先浏览来源缓存，再按需导入独立本地副本。查看、隐藏来源不会删除 Zotero 原件，也不会自动把整库变成 Neuink 本地论文。需要沿用笔记时，可以导入、比较差异，再决定是否明确写回。

## 让解析和 AI 按需参与

**先读 PDF，再决定是否解析。** 原文阅读不依赖 MinerU。需要重排、结构化片段和图表时，可以选择：

- **账号解析服务**：在支持的校园网环境连接 Neuink 服务器并登录，使用统一的 MinerU 解析队列；右下角查看排队、进度和失败原因。
- **自建 MinerU 服务**：填写自己的兼容服务地址和可选密钥，与账号解析服务二选一。
- **导入已有结果**：导入 MinerU 结果目录、ZIP 或 RAR，沿用已经生成的解析内容。

AI 助手可以结合当前论文、笔记和选中的材料回答问题，保留来源引用，并在修改前提供审阅。可配置自己的大模型服务，或接入本机已安装和登录的 Claude Code、Codex、OpenCode。

还可以用关键词、语义或混合检索找回本地内容，在线查找文献与网页，核对候选后导入论文。模型生成的摘要、翻译和研究卡片用于辅助理解，原文始终是核对依据。

## 本地使用，也能按需同步

Windows 便携版把资料和设置保存在程序旁的 `data` 文件夹。退出程序后备份整个 `data`，就能保存论文、笔记和自己的配置。

云端同步默认关闭。当前账号服务面向**东北大学校园网内测环境**：先填写管理员提供的服务器地址，验证连接，再登录；核对同步范围并确认后才开启。账号由管理员提供，暂不开放自助注册。

开启后可同步支持的本地论文与阅读成果，在条目库查看云端状态，在账户页查看云端内容；下载、解析和同步任务集中在右下角。Zotero 来源缓存不按本地论文上传。云端同步不能替代独立备份，也不会迁移整套模型凭据或本机工具环境。

## 下载与开始使用

当前仅维护 **Windows 10 / Windows 11 x64** 版本，不再提供或维护 macOS 版本。

**[下载 Windows x64 便携版](https://cdn.sugrsertraline.top/Neuink-windows-x64-portable.zip)** · [查看 GitHub 发行版本](https://github.com/SugrSertraline/neuink/releases)

1. 完整解压到可写文件夹，双击 `Neuink.exe`。不要在压缩包内运行。
2. 导入一篇 PDF，或在“导入与解析”中接入 Zotero。
3. 打开论文，建立笔记；需要时再配置解析、翻译与模型。

运行便携版不需要安装 Node.js 或 Rust；Windows 需要 WebView2 Runtime。更新前退出程序并备份 `data`，替换程序时保留自己的数据目录。下载包的具体内容以对应发行说明为准。

## 继续了解

| 想做什么 | 使用指南 |
| --- | --- |
| 完成第一次阅读 | [第一次使用](https://sugrsertraline.github.io/neuink/start.html) |
| 整理论文与属性 | [条目、标签与属性](https://sugrsertraline.github.io/neuink/library.html) |
| 配置解析 | [PDF 导入与 MinerU](https://sugrsertraline.github.io/neuink/import.html) |
| 双语精读 | [重排与阅读详略](https://sugrsertraline.github.io/neuink/reflow.html) · [翻译](https://sugrsertraline.github.io/neuink/translation.html) |
| 积累可追溯的笔记 | [来源与反向引用](https://sugrsertraline.github.io/neuink/sources.html) |
| 导出与分享 | [Word、Markdown 与阅读成果](https://sugrsertraline.github.io/neuink/export.html) |
| 连接其他设备 | [云端同步](https://sugrsertraline.github.io/neuink/sync.html) · [备份与恢复](https://sugrsertraline.github.io/neuink/data.html) |

## 反馈与参与

遇到问题或有新的想法，欢迎在 [GitHub Issues](https://github.com/SugrSertraline/neuink/issues) 反馈。请附版本、操作步骤和必要截图，并遮挡密钥、服务器凭据及私人资料。

Neuink 使用 [Apache-2.0](LICENSE) 开源协议。开发者可从[开发指南](docs/development/engineering-guidelines.md)与[构建说明](docs/deployment/packaging-and-distribution.md)了解项目。

[作者主页](https://sugrsertraline.top/)
