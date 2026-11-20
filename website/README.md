# Neuink 产品介绍与使用手册

**[打开 Neuink 官网 →](https://sugrsertraline.github.io/neuink/)**

从翻译与双语、MinerU/Zotero 接入、阅读笔记与 TextFold，到自选模型、本地 Codex 和本地数据，按任务了解产品：[开始阅读](https://sugrsertraline.github.io/neuink/start.html) · [核心概念](https://sugrsertraline.github.io/neuink/concepts.html) · [完整窗口功能图集](https://sugrsertraline.github.io/neuink/screenshots.html)。

位于 Neuink 仓库 `website/` 的静态网站，发布到 GitHub Pages，包含中文首页与按任务组织的专题指南。不是另一个官网仓库。原有 `docs/` 继续承担产品、架构、开发状态与工程规范；本站只组织用户使用说明，不维护第二份开发流水账。

## 本地预览

在仓库根目录运行：

```powershell
npm ci --prefix website
npm run build --prefix website
npm run check --prefix website
npm run preview --prefix website
```

打开 `http://127.0.0.1:4175/neuink/`。子路径与 GitHub 项目 Pages 一致；正文为构建时生成的 HTML，无需 JavaScript 也能阅读。搜索、主题与首页切换由少量本地脚本增强，无第三方统计、远程字体或运行时 CDN。

## 内容与构建

- `pages.json`：导航分组、页面顺序与摘要。
- `content/*.md`：完整使用说明。源文档链接使用 `pdf.md` 一类相对路径，构建时转为 HTML，GitHub 与网站都可浏览。
- `public/`：网站样式与渐进增强脚本。
- `scripts/templates.mjs`：首页与手册共用框架。
- `scripts/build.mjs`：生成独立 HTML、章节搜索索引、sitemap 和 404。
- `dist/`：唯一发布目录，已忽略，不提交构建产物。

Markdown 渲染使用独立锁定的 markdown-it，不修改桌面应用依赖。原始 HTML 默认禁用；发布检查验证内部链接、锚点、搜索覆盖与产物白名单。不复制 Workspace、演示论文、服务地址或 `.env`。`public/screenshots/` 只发布审核过的界面截图；原生窗口实拍与浏览器中运行真实组件的示例图分别标明。新增图保留完整窗口或完整示例视口，仅遮挡服务地址和私人路径（历史图曾裁掉底栏）；首页流程示意与实机截图分别标明。图片点击后打开原尺寸，无需额外脚本。新增图片时同步更新 `screenshots.json` 尺寸白名单，并人工核对画面、脱敏区域、步骤说明及实际完成状态。完整窗口实拍分布于专题教程及截图导航；优先替换有对应当前画面的旧图；仍用于说明具体配置的旧图需在图注中明确标为较早版本。

推荐上手路线为 MinerU 客户端解析 → Neuink 读取结果目录并明确导入本地 → 小牛翻译 → 阅读与笔记，大模型按需选择。产品介绍顺序为翻译与原文双语、MinerU/Zotero、阅读笔记与 TextFold、自选模型与本地 Codex、本地优先。云端提供后端源码可自行部署，也可完全不用；账号解析使用已部署后端，不暗示公共免费服务。当前仅维护 Windows x64，不展示 macOS 下载入口。下载链接使用稳定的 CDN 对象名，文案更新不能被表述为远程文件已替换；包内容以发行说明为准。专题页与图集使用 2026-11-18 的完整窗口实拍（3840 × 2100）；本地 Codex 图包含实际会话与来源引用。没有对应新图的少数设置、筛选和导出面板保留较早示例并明确标注。素材按功能说明，不对论文、译文或模型回答作质量评价；没有追加补拍前置要求。不公开服务地址、测试账号或凭据。

更新功能说明前核对当前实现和 `docs/development/dev-plan.md`。涉及可用性变化时同时检查相关专题、FAQ 和 README；不要把计划功能写成已支持。

## GitHub Pages

工作流位于 `.github/workflows/pages.yml`。网站相关 PR 只构建和检查；经用户确认的 alpha、beta 或 main 提交均可发布，网站相关 push 或手动运行可触发部署，不要求先合并 main。部署 job 独占 `pages: write` 与 `id-token: write`，只上传 `website/dist`。发布任务共享并发组，避免同时覆盖。发布时记录来源提交和本地验证结果。

作者主页统一链接到 `https://sugrsertraline.top/`，不在 Neuink 内维护个人主页内容；本仓库继续发布到 `/neuink/`。构建的 `GUIDE_SOURCE_REF` 让“查看本页源文档”链接指向实际构建分支。

首次需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。之后推送网站变更或从 Actions 手动运行 **Documentation Pages**。仅当部署 job 成功且访问确认后，才能声称网站已上线。

已上线地址：`https://sugrsertraline.github.io/neuink/`。仓库更名或迁移时同步修改构建脚本的站点地址、404 返回地址和模板中的仓库链接。

官方配置参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 教程插图

`public/diagrams/` 保存五张经过文字和关系校对的生图插画，`diagrams.json` 校验图片尺寸。使用内置 image_gen 生成与修订，完整提示词保存在 `diagram-prompts.json`。提示词要求微软雅黑风格的无衬线中文；生成字形不是字体文件的确定性排版，不应声称已嵌入真实字体。站点不分发字体文件。

修改时保留条目与标签的层级、分类与来源引用的区别，以及解析和 AI 的可选性质。检查中文、箭头和实际支持的功能后更新图片。`scripts/draw-guides.py` 是早期简图的生成器，不能用于覆盖现有生图版本。网站正常构建不需要 Python 或生图服务。

## 2026-11-18 官网更新记录

本次网站更新基于 beta 的 `8aaf5b16f05541eaea8d0594d6261b47bb5911bf`，仅修改 `website/`，不包含客户端、后端或下载包发布。使用用户提供的 28 张完整窗口原图，来源文件名、尺寸和 SHA-256 记录在 `screenshot-sources.json`；本次原图未裁切或改写。首页按翻译、MinerU/Zotero、阅读与笔记、模型与本地 Codex、本地优先组织，配套更新功能手册。

本地构建与检查通过：27 个 HTML 页面、1917 个内部链接及锚点、270 条搜索记录和发布文件白名单。浏览器验证了 390、1024、1280 像素宽度下的页面布局，以及目录展开、深浅主题、Codex 搜索、28 张图集和原尺寸图片入口。现有 CDN 下载地址保持不变；本次没有替换远程压缩包。
