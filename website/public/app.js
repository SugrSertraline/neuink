document.documentElement.classList.add('js');
const themeButton = document.querySelector('.theme-button');
const applyTheme = theme => {
  document.documentElement.dataset.theme = theme;
  themeButton.textContent = theme === 'dark' ? '浅色' : '深色';
  themeButton.setAttribute('aria-label', `切换到${theme === 'dark' ? '浅色' : '深色'}主题`);
};
let savedTheme;
try { savedTheme = localStorage.getItem('neuink-guide-theme'); } catch { /* Reading works without storage. */ }
applyTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
themeButton.hidden = false;
themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem('neuink-guide-theme', theme); } catch { /* Session theme still applies. */ }
});

const menu = document.querySelector('.menu-button');
const nav = document.querySelector('.guide-nav');
if (menu) {
  menu.hidden = false;
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
      menu.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open'); menu.focus();
    }
  });
}

const tabs = [...document.querySelectorAll('[role=tab]')];
function selectTab(tab) {
  tabs.forEach(item => {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  });
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); selectTab(tabs[next]); tabs[next].focus(); }
  });
});

const dialog = document.querySelector('.search-dialog');
const input = document.querySelector('#guide-search');
const results = document.querySelector('.search-results');
const status = document.querySelector('.search-status');
const trigger = document.querySelector('[data-search-open]');
const scriptBase = new URL('.', document.querySelector('script[src$="app.js"]').src);
const siteBase = new URL('../', scriptBase);
let records;
let pending;
let returnFocus;
const normalize = value => value.normalize('NFKC').toLocaleLowerCase();
async function loadIndex() {
  if (records) return records;
  if (!pending) pending = fetch(new URL('search.json', siteBase)).then(response => {
    if (!response.ok) throw new Error('Search index unavailable');
    return response.json();
  }).then(data => { records = data; return data; }).finally(() => { pending = null; });
  return pending;
}
function renderResults() {
  results.replaceChildren();
  const query = normalize(input.value.trim());
  if (!query) { status.textContent = '输入功能名称或遇到的问题。'; return; }
  const terms = query.split(/\s+/).slice(0, 12);
  const hits = records.map(record => {
    const title = normalize(`${record.title} ${record.page}`);
    const text = normalize(record.text);
    const all = `${title} ${text}`;
    const score = terms.every(term => all.includes(term)) ? terms.reduce((n, term) => n + (title.includes(term) ? 10 : 1), 0) : 0;
    return { record, score };
  }).filter(hit => hit.score).sort((a, b) => b.score - a.score);
  status.textContent = hits.length ? `找到 ${hits.length} 处相关说明${hits.length > 30 ? '，先显示前 30 项' : ''}。` : '没有找到匹配内容。试试更短的词，例如“翻译”“来源”或“ZIP”。';
  hits.slice(0, 30).forEach(({ record }) => {
    const link = document.createElement('a'); link.href = new URL(record.url, siteBase).href;
    const title = document.createElement('strong'); title.textContent = record.title;
    const label = document.createElement('small'); label.textContent = `${record.group} / ${record.page}`;
    const excerpt = document.createElement('p');
    const at = Math.max(0, normalize(record.text).indexOf(terms[0]) - 35);
    excerpt.textContent = `${at > 0 ? '…' : ''}${record.text.slice(at, at + 150)}${record.text.length > at + 150 ? '…' : ''}`;
    link.append(title, label, excerpt); results.append(link);
  });
}
async function search() {
  status.textContent = '正在准备本地搜索…';
  try { await loadIndex(); renderResults(); }
  catch { status.textContent = '搜索索引加载失败，请检查网络后重新输入重试。仍可通过章节目录阅读全部内容。'; }
}
function openSearch() {
  if (dialog.open) return;
  returnFocus = document.activeElement;
  dialog.showModal(); input.focus(); void search();
}
trigger.hidden = false;
trigger.addEventListener('click', openSearch);
document.querySelector('[data-search-close]').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus(); });
dialog.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); }
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
input.addEventListener('input', () => void search());
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
});
const tocLinks = [...document.querySelectorAll('.toc a')];
if ('IntersectionObserver' in window && tocLinks.length) {
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (!visible.length) return;
    tocLinks.forEach(link => {
      if (link.hash === `#${visible[0].target.id}`) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-100px 0px -65% 0px', threshold: 0 });
  document.querySelectorAll('.prose h2').forEach(heading => observer.observe(heading));
}
