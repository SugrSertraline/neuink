import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { browserTitle, normalizeBrowserUrl } from './browserUrl';
import { useBrowserViewport } from './useBrowserViewport';

export function BrowserSurface({ id, initialUrl = '', active, onChange, onFocus }: { id: string; initialUrl?: string; active: boolean; onChange?: (url: string, title: string) => void; onFocus?: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(''); const [draft, setDraft] = useState(initialUrl);
  const [title, setTitle] = useState('新网页'); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef({ url, title }); current.current = { url, title };
  const browser = useBrowserViewport(id, viewport, active, event => {
    if (event.focused) { if (active) onFocus?.(); return; }
    const nextUrl = event.url ?? current.current.url, nextTitle = event.title ?? (event.url && event.url !== current.current.url ? browserTitle(event.url) : current.current.title);
    current.current = { url: nextUrl, title: nextTitle };
    if (event.url) { setUrl(event.url); if (document.activeElement !== input.current) setDraft(event.url); }
    if (event.title != null || event.url) setTitle(nextTitle);
    if (event.loading != null) setLoading(event.loading);
    if (event.error) setError(event.error);
    onChange?.(nextUrl, nextTitle);
  });
  const navigate = async (raw: string) => {
    try {
      const next = normalizeBrowserUrl(raw); setError(null);
      if (!browser.native) { setUrl(next); setDraft(next); setTitle(browserTitle(next)); onChange?.(next, browserTitle(next)); return; }
      setLoading(true); await browser.navigate(next); setUrl(next); setDraft(next); onChange?.(next, browserTitle(next));
    } catch (caught) { setLoading(false); setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const initial = useRef(initialUrl);
  useEffect(() => { if (initial.current) void navigate(initial.current); }, [id]);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => { setLoading(false); setError('网页加载较久，请检查网络，或停止后刷新重试。'); }, 30_000);
    return () => clearTimeout(timer);
  }, [loading, url]);
  const command = async (action: 'back' | 'forward' | 'reload' | 'stop') => {
    try { setError(null); await browser.action(action); setLoading(action !== 'stop'); } catch { setLoading(false); setError('网页操作失败，请重试。'); }
  };
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="网页浏览器"
    onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); input.current?.focus(); input.current?.select(); } }}>
    <form className="flex min-w-0 shrink-0 flex-wrap items-center gap-1 border-b bg-muted p-2" onSubmit={event => { event.preventDefault(); void navigate(draft); }}>
      <div className="flex shrink-0 items-center gap-1">
      <Button type="button" size="icon-sm" variant="ghost" aria-label="网页后退" title="网页后退" disabled={!url || !browser.native} onClick={() => void command('back')}><ArrowLeft size={15} /></Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="网页前进" title="网页前进" disabled={!url || !browser.native} onClick={() => void command('forward')}><ArrowRight size={15} /></Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={loading ? '停止加载网页' : '刷新网页'} title={loading ? '停止加载网页' : '刷新网页'} disabled={!url || !browser.native} onClick={() => void command(loading ? 'stop' : 'reload')}>{loading ? <X size={15} /> : <RotateCw size={15} />}</Button>
      </div>
      <div className="flex min-w-[10rem] flex-1 items-center gap-1">
      <Input ref={input} className="min-w-0 flex-1" aria-label="网页地址" placeholder="输入网址，例如 arxiv.org" value={draft} onChange={event => setDraft(event.target.value)} onFocus={event => event.currentTarget.select()} />
      <Button type="submit" variant="outline" size="sm">访问</Button>
      </div>
    </form>
    {(error || browser.error) && <p className="shrink-0 border-b px-3 py-2 text-sm text-destructive" role="alert">{error || browser.error}</p>}
    <div className="shrink-0 truncate border-b px-3 py-1 text-xs text-muted-foreground" role="status">{loading ? '正在加载网页…' : url ? title : '网页与本地资料隔离，不会自动交给助手阅读。'}</div>
    <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden">
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
        <Globe size={24} aria-hidden="true" />
        <p>{browser.covered ? '操作浮层期间暂时隐藏网页，关闭后继续浏览。' : !url ? '在上方输入网址，打开网页。' : browser.native ? '网页由独立浏览器视图显示。' : '普通浏览器预览不支持内嵌桌面网页，请在 NeuInk 桌面端使用。'}</p>
        {!browser.native && url && <a className="inline-flex items-center gap-1 text-primary underline" href={url} target="_blank" rel="noopener noreferrer">在外部浏览器打开<ExternalLink size={14} /></a>}
      </div>
    </div>
  </section>;
}
