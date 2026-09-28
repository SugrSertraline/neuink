import type { ReactNode } from 'react';
import { normalizeBrowserUrl, requestBrowserTab } from '@/modules/browser/browserUrl';

export function WorkspaceWebLink({ href, children }: { href?: string; children: ReactNode }) {
  let url: string;
  try {
    if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
    url = normalizeBrowserUrl(href);
  } catch { return <span title="此链接不是可打开的外部网页">{children}</span>; }
  return <a href={url} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); requestBrowserTab(url);
  }}>{children}</a>;
}
