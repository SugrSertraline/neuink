import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Loader2, Minus, Plus, RotateCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { browserTitle, normalizeBrowserUrl, requestBrowserTab } from './browserUrl';
import { useBrowserViewport } from './useBrowserViewport';
import { adjacentBrowserZoom, BROWSER_MAX_ZOOM, BROWSER_MIN_ZOOM } from './browserZoom';

export type BrowserSurfaceMetadata = { navigationId?: string; loading?: boolean };

export function BrowserSurface({ id, initialUrl = '', active, onChange, onFocus }: { id: string; initialUrl?: string; active: boolean; onChange?: (url: string, title: string, metadata?: BrowserSurfaceMetadata) => void; onFocus?: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(''); const [draft, setDraft] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1); const [zoomBusy, setZoomBusy] = useState(false);
  const zoomRequest = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [error, setError] = useState<string | null>(null);
  const [zoomError, setZoomError] = useState<string | null>(null);
  // Navigation and native events update this synchronously; render state may still be pending.
  const current = useRef({ url, title: '新网页' });
  const metadata = useRef<BrowserSurfaceMetadata>({ loading: false });
  const publishLoading = (nextLoading: boolean) => {
    metadata.current = { navigationId: undefined, loading: nextLoading };
    setLoading(nextLoading);
    onChange?.(current.current.url, current.current.title, { ...metadata.current });
  };
  const browser = useBrowserViewport(id, viewport, active, event => {
    if (event.zoom !== undefined) {
      // Native zoom is presentation state, not a new document or an assistant read target.
      if (Number.isFinite(event.zoom) && event.zoom > 0) { setZoom(event.zoom); setZoomError(null); }
      return;
    }
    if (event.openTab) {
      if (!active) return;
      // Popup results are not navigation events; they must not invalidate the source document.
      if (event.openTab.error) { setError(event.openTab.error); return; }
      try {
        if (!event.openTab.url || !event.openTab.requestId) throw new Error('新标签链接不可用。');
        requestBrowserTab(event.openTab.url, { sourceId: id, requestId: event.openTab.requestId });
        setError(null);
      } catch { setError('无法打开新标签：只支持有效的外部 HTTP(S) 网页链接。'); }
      return;
    }
    if (event.focused) { if (active) onFocus?.(); return; }
    const nextUrl = event.url ?? current.current.url, nextTitle = event.title ?? (event.url && event.url !== current.current.url ? browserTitle(event.url) : current.current.title);
    current.current = { url: nextUrl, title: nextTitle };
    if (event.url) { setUrl(event.url); if (document.activeElement !== input.current) setDraft(event.url); }
    if (event.loading != null) setLoading(event.loading);
    if (event.error) setError(event.error);
    metadata.current = { navigationId: event.error ? undefined : event.navigation_id ??
      (event.loading === true ? undefined : metadata.current.navigationId),
      loading: event.loading ?? metadata.current.loading };
    onChange?.(nextUrl, nextTitle, { ...metadata.current });
  });
  const navigate = async (raw: string) => {
    try {
      const next = normalizeBrowserUrl(raw); setError(null);
      const nextTitle = browserTitle(next);
      current.current = { url: next, title: nextTitle };
      setUrl(next); setDraft(next);
      // Invalidate the previous document before the native navigation starts.
      publishLoading(browser.native);
      if (browser.native) await browser.navigate(next);
    } catch (caught) { publishLoading(false); setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const initial = useRef(initialUrl);
  useEffect(() => { if (initial.current) void navigate(initial.current); }, [id]);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => { publishLoading(false); setError('网页加载较久，请检查网络，或停止后刷新重试。'); }, 30_000);
    return () => clearTimeout(timer);
  }, [loading, url]);
  const command = async (action: 'back' | 'forward' | 'reload' | 'stop') => {
    try { setError(null); publishLoading(action !== 'stop'); await browser.action(action); }
    catch { publishLoading(false); setError('网页操作失败，请重试。'); }
  };
  const zoomDisabled = !active || !url || !browser.native || loading || zoomBusy;
  const changeZoom = async (next: number) => {
    if (zoomDisabled || zoomRequest.current) return;
    zoomRequest.current = true; setZoomBusy(true); setZoomError(null);
    try {
      await browser.zoom(next);
      // The native zoom event supplies the actual ratio, including keyboard/wheel changes.
    } catch { if (live.current) setZoomError('网页缩放失败，请再次点击缩放按钮重试。'); }
    finally { zoomRequest.current = false; if (live.current) setZoomBusy(false); }
  };
  return <section className="@container/browser flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="网页浏览器"
    onKeyDown={event => {
      if (!active || event.nativeEvent.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'l') {
        event.preventDefault(); event.stopPropagation(); input.current?.focus(); input.current?.select();
      } else if (['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        void changeZoom(event.key === '0' ? 1 : adjacentBrowserZoom(zoom, event.key === '-' ? -1 : 1));
      }
    }}>
    <form className="grid min-w-0 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 border-b bg-muted p-2" onSubmit={event => { event.preventDefault(); void navigate(draft); }}>
      <div className="col-start-1 row-start-2 flex items-center @min-[28rem]/browser:row-start-1">
      <Button type="button" size="icon-sm" variant="ghost" aria-label="网页后退" title="网页后退" disabled={!url || !browser.native} onClick={() => void command('back')}><ArrowLeft size={15} /></Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="网页前进" title="网页前进" disabled={!url || !browser.native} onClick={() => void command('forward')}><ArrowRight size={15} /></Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={loading ? '停止加载网页' : '刷新网页'} title={loading ? '停止加载网页' : '刷新网页'} disabled={!url || !browser.native} onClick={() => void command(loading ? 'stop' : 'reload')}>{loading ? <X size={15} /> : <RotateCw size={15} />}</Button>
      </div>
      <div className="col-span-3 col-start-1 row-start-1 flex min-w-0 items-center gap-1 @min-[28rem]/browser:col-span-1 @min-[28rem]/browser:col-start-2">
      <div className="relative min-w-0 flex-1">
        {loading ? <Loader2 className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin motion-reduce:animate-none text-muted-foreground" aria-hidden="true" />
          : <Globe className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />}
        <Input ref={input} className="h-7 min-w-0 pl-7 text-sm" aria-label="网页地址" aria-busy={loading} placeholder="输入网址，例如 arxiv.org" value={draft} onChange={event => setDraft(event.target.value)} onFocus={event => event.currentTarget.select()} />
      </div>
      <Button type="submit" variant="outline" size="sm">访问</Button>
      </div>
      <div className="col-start-3 row-start-2 flex items-center @min-[28rem]/browser:row-start-1" role="group" aria-label="网页缩放" aria-busy={zoomBusy}>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="缩小网页" title="缩小网页（Ctrl/⌘ −）" disabled={zoomDisabled || zoom <= BROWSER_MIN_ZOOM} onClick={() => void changeZoom(adjacentBrowserZoom(zoom, -1))}><Minus aria-hidden="true" /></Button>
        <Button type="button" size="sm" variant="ghost" className="w-14 px-1 tabular-nums" aria-label={`网页缩放 ${Math.round(zoom * 100)}%，恢复为 100%`} title="恢复为 100%（Ctrl/⌘ 0）" disabled={zoomDisabled} onClick={() => void changeZoom(1)}>{Math.round(zoom * 100)}%</Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="放大网页" title="放大网页（Ctrl/⌘ +）" disabled={zoomDisabled || zoom >= BROWSER_MAX_ZOOM} onClick={() => void changeZoom(adjacentBrowserZoom(zoom, 1))}><Plus aria-hidden="true" /></Button>
      </div>
    </form>
    {(error || browser.error || zoomError) && <p className="shrink-0 border-b px-3 py-2 text-sm text-destructive" role="alert">{error || browser.error || zoomError}</p>}
    {loading && <span className="sr-only" role="status">正在加载网页…</span>}
    <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden">
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
        <Globe size={24} aria-hidden="true" />
        <p>{!url ? '在上方输入网址，打开网页。' : browser.native ? '网页由独立浏览器视图显示。' : '普通浏览器预览不支持内嵌桌面网页，请在 NeuInk 桌面端使用。'}</p>
        {!browser.native && url && <a className="inline-flex items-center gap-1 text-primary underline" href={url} target="_blank" rel="noopener noreferrer">在外部浏览器打开<ExternalLink size={14} /></a>}
      </div>
    </div>
  </section>;
}
