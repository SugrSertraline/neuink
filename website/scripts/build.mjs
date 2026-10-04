import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { shell, home } from './templates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const pages = JSON.parse(await fs.readFile(path.join(root, 'pages.json'), 'utf8'));
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
const escape = md.utils.escapeHtml;
const search = [];
await fs.mkdir(path.join(out, 'assets'), { recursive: true });
const siteUrl = 'https://sugrsertraline.github.io/neuink/';
const plain = value => value.replace(/!?(\[([^\]]+)\])\([^)]+\)/g, '$2').replace(/[`*_>#|]/g, '').replace(/\s+/g, ' ').trim();
const renderLink = md.renderer.rules.link_open ?? ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  const href = tokens[index].attrGet('href');
  if (href && /^[a-z-]+\.md(?:#.*)?$/.test(href)) tokens[index].attrSet('href', href.replace('.md', '.html'));
  return renderLink(tokens, index, options, env, renderer);
};
const renderImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index];
  const src = token.attrGet('src');
  if (src?.startsWith('../public/screenshots/')) {
    token.attrSet('src', src.replace('../public/', 'assets/'));
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    token.attrSet('width', '1600');
    token.attrSet('height', '876');
    return '<a class="screenshot-link" href="' + escape(token.attrGet('src')) + '" aria-label="打开原尺寸截图">' + renderImage(tokens, index, options, env, renderer) + '</a>';
  }
  return renderImage(tokens, index, options, env, renderer);
};
md.renderer.rules.table_open = () => '<div class="table-scroll" tabindex="0" role="region" aria-label="表格，可横向滚动"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

for (const [index, page] of pages.entries()) {
  const source = await fs.readFile(path.join(root, 'content', `${page.id}.md`), 'utf8');
  const tokens = md.parse(source, {});
  const toc = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'heading_open') continue;
    const label = tokens[i + 1].content;
    const id = `section-${toc.length + 1}`;
    tokens[i].attrSet('id', id);
    toc.push({ id, label });
  }
  const sections = source.split(/^## /m);
  search.push({ title: page.title, page: page.title, url: `${page.id}.html`, text: page.description, group: page.group });
  sections.slice(1).forEach((section, n) => {
    const [heading, ...lines] = section.split('\n');
    search.push({ title: heading.trim(), page: page.title, url: `${page.id}.html#section-${n + 1}`, text: plain(lines.join(' ')), group: page.group });
  });
  const content = `<div class="doc-heading"><p class="eyebrow">${escape(page.group)} / 使用手册</p><h1>${escape(page.title)}</h1><p class="lead">${escape(page.description)}</p></div><div class="prose">${md.renderer.render(tokens, md.options, {})}</div>`;
  const neighbors = { prev: pages[index - 1], next: pages[index + 1] };
  await fs.writeFile(path.join(out, `${page.id}.html`), shell({ page, pages, content, toc, neighbors, siteUrl }));
}
await fs.writeFile(path.join(out, 'index.html'), shell({ pages, content: home(pages), siteUrl }));
await fs.writeFile(path.join(out, '404.html'), shell({ pages, page: { id: '404', title: '页面未找到', description: '请从目录重新找到所需内容。' }, content: '<div class="doc-heading"><p class="eyebrow">404</p><h1>这页暂时找不到了。</h1><p class="lead">链接可能已经变更。返回首页，或用搜索找到功能说明。</p><a class="button primary" href="https://sugrsertraline.github.io/neuink/">返回 Neuink 首页</a></div>', siteUrl, absoluteAssets: true }));
for (const file of ['style.css', 'app.js']) await fs.copyFile(path.join(root, 'public', file), path.join(out, 'assets', file));
await fs.cp(path.join(root, 'public/screenshots'), path.join(out, 'assets/screenshots'), { recursive: true });
await fs.copyFile(path.join(root, '../apps/desktop/src-tauri/logo_assets/neuink_logo_transparent_1024.png'), path.join(out, 'assets', 'logo.png'));
await fs.writeFile(path.join(out, 'search.json'), JSON.stringify(search));
await fs.writeFile(path.join(out, '.nojekyll'), '');
await fs.writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}sitemap.xml\n`);
await fs.writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['index', ...pages.map(p => p.id)].map(id => `<url><loc>${siteUrl}${id === 'index' ? '' : `${id}.html`}</loc></url>`).join('')}</urlset>`);
console.log(`Built ${pages.length} guides, homepage, 404, and ${search.length} searchable sections → website/dist`);
