const repo = 'https://github.com/SugrSertraline/neuink';
const portable = 'https://cdn.sugrsertraline.top/Neuink-windows-x64-portable.zip';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shot(name, alt, caption, eager = false) {
  const src = `assets/screenshots/${name}`;
  return `<figure class="home-shot"><a href="${src}" aria-label="打开原尺寸图片：${esc(alt)}"><img src="${src}" width="3840" height="2100" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" alt="${esc(alt)}"></a><figcaption>${esc(caption)} <span>点击查看原图 ↗</span></figcaption></figure>`;
}

export function home(pages) {
  const groups = [...new Set(pages.map(page => page.group))];
  return `<section class="home-hero section">
    <p class="eyebrow">LOCAL FIRST · READING WORKSPACE</p>
    <h1>从读懂一篇论文，<br>到积累自己的<span>知识。</span></h1>
    <p class="home-lead">一处完成论文阅读、翻译、笔记与研究。保留原文，按需要使用解析服务和大模型。</p>
    <div class="hero-actions"><a class="button primary" href="${portable}">下载 Windows 便携版 ↗</a><a class="button secondary" href="${repo}/releases">GitHub Releases ↗</a><a class="button secondary" href="start.html">开始使用 →</a></div>
    <p class="hero-note">Windows 10 / 11 x64 · 本地阅读无需登录 · 云端同步按需开启</p>
    ${shot('current-translation-parallel.png', 'Neuink 中论文的原文和译文对照阅读界面', '原文与译文并排阅读，在同一个工作台核对细节。', true)}
  </section>

  <section class="home-feature section" id="translation" aria-labelledby="translation-title">
    <div class="home-feature-copy"><p class="eyebrow">01 / 多种翻译</p><h2 id="translation-title">从一个单词，到整篇论文。</h2><p>查询单词、划词翻译、翻译段落与全文，也可以逐句对照。保留 PDF 原始版式，或在重排视图中切换原文、译文和双语。</p><p>小牛、DeepL、Azure、Qwen-MT 及自配大模型可按需选择，不同翻译场景也可以使用不同来源。</p><a class="text-link" href="translation.html">了解翻译与对照阅读 →</a></div>
    ${shot('current-selection-translation.png', '阅读论文时选中文字并查看翻译', '选中文字，查看翻译和上下文。')}
  </section>

  <section class="home-route" aria-labelledby="route-title"><div class="section"><p class="eyebrow">推荐上手方式</p><h2 id="route-title">先解析，再开始阅读。</h2><ol class="home-route-steps"><li><strong>下载 MinerU 客户端</strong><span>将 PDF 导入 MinerU，等待解析完成，保留完整结果目录。</span></li><li><strong>导入 Neuink</strong><span>读取 MinerU 解析结果目录，明确选择需要的论文并导入本地资料库。</span></li><li><strong>配置小牛翻译</strong><span>在翻译设置填写 API Key，验证连接并选择翻译来源。</span></li><li><strong>按需选择大模型</strong><span>需要论文问答、辅助笔记或 TextFold 时，自行选择和配置模型。</span></li></ol><p class="home-route-note">这是推荐组合；也可以选择其他解析方式与翻译服务。基础 PDF 阅读无需配置大模型。</p><a class="text-link" href="start.html">查看入门指南 →</a></div></section>

  <section class="home-feature section" id="sources" aria-labelledby="sources-title">
    <div class="home-feature-copy"><p class="eyebrow">02 / MINERU × ZOTERO</p><h2 id="sources-title">已有资料，接着阅读。</h2><p>导入 MinerU 解析结果，为重排阅读、翻译与来源笔记提供结构化内容；也可选择兼容的自建服务或已部署后端的账号解析队列。</p><p>连接本机 Zotero 后浏览来源与笔记。只有主动导入的条目才成为 Neuink 的独立本地副本。</p><div class="home-links"><a class="text-link" href="import.html">了解解析与导入 →</a><a class="text-link" href="zotero.html">了解 Zotero 接入 →</a></div></div>
    ${shot('current-mineru-source.png', 'Neuink 中的 MinerU 结果来源界面', '读取已解析的 MinerU 结果，再选择需要的论文导入。')}
    ${shot('current-zotero-source.png', 'Neuink 中的 Zotero 来源界面', '浏览已有 Zotero 资料，按需导入本地。')}
  </section>

  <section class="home-feature section" id="reading" aria-labelledby="reading-title">
    <div class="home-feature-copy"><p class="eyebrow">03 / 阅读与笔记</p><h2 id="reading-title">读得深入，也记得清楚。</h2><p>原文和重排阅读、悬停预览、多标签与分屏，把论文、译文和笔记放在合适的位置。笔记可以保留来源，方便回到原文核对。</p><p>TextFold 阅读详略支持在原文、精简、要点、结论和主题之间切换，也可针对段落调整。生成阅读详略需要按需配置模型。</p><div class="home-links"><a class="text-link" href="reflow.html">了解重排与阅读详略 →</a><a class="text-link" href="sources.html">了解笔记与来源 →</a><a class="text-link" href="parallel.html">了解分屏阅读 →</a></div></div>
    ${shot('current-reflow-bilingual.png', '论文重排视图中的中英双语阅读', '重排内容与双语阅读，让段落、图表和公式更便于浏览。')}
    ${shot('current-textfold.png', 'TextFold 阅读详略界面', '在不同详略层次之间切换，再回到原文核对。')}
    ${shot('current-pdf-notes.png', '论文原文和带来源链接的笔记并排显示', '一边阅读原文，一边整理带来源的笔记。')}
  </section>

  <section class="home-feature section" id="assistant" aria-labelledby="assistant-title">
    <div class="home-feature-copy"><p class="eyebrow">04 / 模型与本地 AGENT</p><h2 id="assistant-title">把助手带进阅读过程。</h2><p>自行配置大模型，用于论文问答、翻译或阅读详略；结合论文和笔记提问，并通过回答中的引用核对来源。</p><p>也可以接入本机已安装并登录的 Codex、Claude Code 或 OpenCode。模型和 Agent 的使用取决于各自的配置、安装与登录状态。</p><a class="text-link" href="assistant.html">了解模型与助手 →</a></div>
    ${shot('current-local-codex.png', 'Neuink 中使用本机 Codex 进行阅读问答', '在阅读工作台中使用本机 Codex。')}
  </section>

  <section class="home-feature section home-local" id="local" aria-labelledby="local-title"><div class="home-feature-copy"><p class="eyebrow">05 / 本地优先</p><h2 id="local-title">你的资料，由你选择如何保存。</h2><p>基础阅读、资料整理和笔记无需登录；便携版默认将数据保存在程序旁的 data 文件夹。更新前退出程序并备份数据。</p><p>云端同步按需开启，也可以完全不用。配套后端源码开放，支持自行部署；远程解析、翻译和模型服务会处理你提交给它们的相应内容。</p><div class="home-links"><a class="text-link" href="data.html">数据与隐私 →</a><a class="text-link" href="${repo}/tree/beta/deploy/server">后端源码与部署说明 ↗</a></div></div></section>

  <section class="home-gallery section" aria-labelledby="gallery-title"><p class="eyebrow">更多实机界面</p><h2 id="gallery-title">看看工作台里的其他细节。</h2><div class="home-gallery-grid">
    ${shot('current-hover-figure.png', '阅读论文时悬停预览图表', '悬停查看图表内容。')}
    ${shot('current-assistant.png', '论文助手回答与原文同屏', '围绕论文提问，并查看引用。')}
    ${shot('current-library.png', 'Neuink 条目库列表', '通过标签、属性和表格整理资料。')}
  </div><a class="text-link" href="screenshots.html">查看图文使用教程 →</a></section>

  <section class="directory-section" id="features"><div class="section directory"><div class="directory-heading"><div><p class="eyebrow">完整功能手册</p><h2>每一个功能，<br>都有具体的用法。</h2></div><p>从入口到操作，从结果到边界。<br>${pages.length} 篇专题指南，按你的任务逐步阅读。</p></div><div class="directory-grid">${groups.map((group, i) => `<section class="directory-group"><h3><span>${String(i + 1).padStart(2, '0')}</span>${esc(group)}</h3>${pages.filter(p => p.group === group).map(p => `<a href="${esc(p.id)}.html"><strong>${esc(p.title)}<span>↗</span></strong><p>${esc(p.description)}</p></a>`).join('')}</section>`).join('')}</div></div></section>
  <section class="section closing"><p class="eyebrow">从一篇论文开始</p><h2>让每次阅读，<br>成为可以继续的研究。</h2><div class="hero-actions"><a class="button primary" href="${portable}">下载 Windows 便携版 ↗</a><a class="button secondary" href="${repo}/releases">GitHub Releases ↗</a></div><p>支持 Windows 10 / 11 x64。更新前请备份并保留自己的 data 文件夹。</p></section>`;
}
