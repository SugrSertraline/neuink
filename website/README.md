# Neuink 产品介绍与使用手册

面向 GitHub Pages 的独立静态网站，中文首页与 20 篇专题指南。原有 `docs/` 继续承担产品、架构、开发状态与工程规范；本站只组织用户使用说明，不维护第二份开发流水账。

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

Markdown 渲染使用独立锁定的 markdown-it，不修改桌面应用依赖。原始 HTML 默认禁用；发布检查验证内部链接、锚点、搜索覆盖与产物白名单。没有复制 Workspace、演示论文、截图中的服务地址或 `.env`。首页图形为流程示意，不是实机截图。

更新功能说明前核对当前实现和 `docs/development/dev-plan.md`。涉及可用性变化时同时检查相关专题、FAQ 和 README；不要把计划功能写成已支持。

## GitHub Pages

工作流位于 `.github/workflows/pages.yml`。网站相关 PR 只构建和检查；main 与独立文档分支 `codex/product-guide` 上的网站变更可以发布，手动运行也仅允许这两个分支部署。部署 job 独占 `pages: write` 与 `id-token: write`，只上传 `website/dist`。两条发布路径共享并发组，避免同时覆盖。

首次通过独立文档分支发布，避免携带本地尚未发布的客户端改动。合并到 main 后，建议将 Pages 的来源分支设为 main，并移除工作流中的临时文档分支条件，统一从主分支维护。构建的 `GUIDE_SOURCE_REF` 让“查看本页源文档”链接指向实际构建分支。

首次需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。之后推送网站变更或从 Actions 手动运行 **Documentation Pages**。仅当部署 job 成功且访问确认后，才能声称网站已上线。

预期地址：`https://sugrsertraline.github.io/neuink/`。仓库更名或迁移时同步修改构建脚本的站点地址、404 返回地址和模板中的仓库链接。

官方配置参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
