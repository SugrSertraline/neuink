/** A URL, never executable content, a workspace path, or silently interpreted search text. */
export function normalizeBrowserUrl(input: string): string {
  const raw = input.trim();
  if (!raw || raw.length > 8192 || /[\u0000-\u0020\u007f]/.test(raw)) throw new Error('请输入有效网址，例如 https://arxiv.org');
  const normalized = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try { url = new URL(normalized); } catch { throw new Error('网址格式不正确。'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || !host || url.username || url.password || raw.includes('\\')) throw new Error('只支持不含账号密码的 HTTP(S) 网页链接。');
  if (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '[::1]' || host === '0.0.0.0') throw new Error('不能在网页标签中打开本机应用地址。');
  return url.href;
}
export function browserTitle(url: string) { try { return new URL(url).hostname; } catch { return '新网页'; } }

export const BROWSER_OPEN_EVENT = 'neuink:open-browser';
export type BrowserTabSource = { sourceId: string; requestId: string };
export type BrowserOpenDetail = string | (BrowserTabSource & { url: string });
export function requestBrowserTab(url: string, source?: BrowserTabSource) {
  const normalized = normalizeBrowserUrl(url);
  const detail: BrowserOpenDetail = source ? { url: normalized, sourceId: source.sourceId, requestId: source.requestId } : normalized;
  window.dispatchEvent(new CustomEvent<BrowserOpenDetail>(BROWSER_OPEN_EVENT, { detail }));
}
