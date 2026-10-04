import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const files = await fs.readdir(out);
const pages = JSON.parse(await fs.readFile(path.join(root, 'pages.json'), 'utf8'));
const failures = [];
let count = 0;
const htmlByFile = new Map();
for (const file of files.filter(f => f.endsWith('.html'))) htmlByFile.set(file, await fs.readFile(path.join(out, file), 'utf8'));
async function checkLink(link, from) {
  if (/^(https?:|data:|mailto:)/.test(link)) return;
  const [file, fragment] = link.split('#');
  const target = file || from;
  if (!target || target.startsWith('/')) { failures.push(`${from}: root-absolute or empty URL ${link}`); return; }
  try { await fs.access(path.join(out, target)); } catch { failures.push(`${from}: missing ${link}`); return; }
  if (fragment && htmlByFile.has(target) && !htmlByFile.get(target).includes(`id="${fragment}"`)) failures.push(`${from}: missing anchor ${link}`);
  count++;
}
for (const [file, html] of htmlByFile) {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  if (new Set(ids).size !== ids.length) failures.push(`${file}: duplicate IDs`);
  if ((html.match(/<h1[ >]/g) || []).length !== 1) failures.push(`${file}: expected one h1`);
  if (!html.includes('lang="zh-CN"') || !html.includes('name="description"')) failures.push(`${file}: missing page metadata`);
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) await checkLink(match[1], file);
}
const index = JSON.parse(await fs.readFile(path.join(out, 'search.json'), 'utf8'));
for (const entry of index) await checkLink(entry.url, 'index.html');
for (const page of pages) {
  if (!htmlByFile.has(`${page.id}.html`)) failures.push(`Missing guide ${page.id}`);
  if (!index.some(entry => entry.url === `${page.id}.html`)) failures.push(`Not searchable: ${page.id}`);
}
const allowed = new Set(['assets', 'index.html', '404.html', 'search.json', 'robots.txt', 'sitemap.xml', '.nojekyll', ...pages.map(p => `${p.id}.html`)]);
for (const file of files) if (!allowed.has(file)) failures.push(`Unexpected publish file: ${file}`);
for (const file of await fs.readdir(path.join(out, 'assets'))) if (!['logo.png', 'style.css', 'app.js', 'screenshots'].includes(file)) failures.push(`Unexpected asset: ${file}`);
const screenshotSizes = {
  'reading-workspace.png': [1600, 876],
  'assistant-and-notes.png': [1600, 876],
  'pdf-notes-split-view.png': [1600, 876],
  'mineru-step-1-download-and-parse.png': [2100, 1215],
  'mineru-step-2-zip-results.png': [2652, 1409]
};
const screenshots = Object.keys(screenshotSizes);
for (const file of await fs.readdir(path.join(out, 'assets/screenshots'))) if (!screenshots.includes(file)) failures.push('Unexpected screenshot: ' + file);
for (const file of screenshots) {
  const bytes = await fs.readFile(path.join(out, 'assets/screenshots', file));
  if (bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== screenshotSizes[file][0] || bytes.readUInt32BE(20) !== screenshotSizes[file][1]) failures.push('Screenshot must match reviewed PNG dimensions: ' + file);
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`PASS: ${htmlByFile.size} HTML pages; ${count} local links/anchors; ${index.length} search records; publish allowlist.`);
