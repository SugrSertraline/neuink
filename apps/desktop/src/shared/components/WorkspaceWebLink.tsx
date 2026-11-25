import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { normalizeBrowserUrl, requestBrowserTab } from '@/modules/browser/browserUrl';

export function WorkspaceWebLink({ href, children, asButton = false }: { href?: string; children: ReactNode; asButton?: boolean }) {
  const unavailable = (title?: string) => asButton
    ? <Button size="sm" variant="outline" disabled title={title}>{children}</Button>
    : <span title={title}>{children}</span>;
  let url: string;
  try {
    if (!href || !/^https?:\/\//i.test(href)) return unavailable();
    url = normalizeBrowserUrl(href);
  } catch { return unavailable('此链接不是可打开的外部网页'); }
  const link = <a href={url} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); requestBrowserTab(url);
  }}>{children}</a>;
  return asButton ? <Button asChild size="sm" variant="outline">{link}</Button> : link;
}
