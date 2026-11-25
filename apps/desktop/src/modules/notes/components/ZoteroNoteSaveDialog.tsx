import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { overwriteZoteroNote, previewZoteroNote, type ZoteroNoteOrigin, type ZoteroNotePreview } from '@/shared/ipc/zoteroApi';
import { useToast } from '@/shared/hooks/useToast';
import { ZoteroNoteChangePreview } from './ZoteroNoteChangePreview';

export function ZoteroNoteSaveDialog({ open, onOpenChange, root, entryId, noteId, origin, getHtml, onSaveLocal }: {
  open: boolean; onOpenChange: (open: boolean) => void; root: string; entryId: string; noteId: string;
  origin: ZoteroNoteOrigin; getHtml: () => string | null; onSaveLocal: () => Promise<boolean>;
}) {
  const { notify } = useToast();
  const [preview, setPreview] = useState<ZoteroNotePreview | null>(null);
  const [proposedHtml, setProposedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourceReadError, setSourceReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0), pending = useRef(false), live = useRef(true);
  const latest = useRef({ getHtml, onSaveLocal, onOpenChange }); latest.current = { getHtml, onSaveLocal, onOpenChange };
  useEffect(() => { live.current = true; return () => { live.current = false; request.current++; }; }, []);
  const refresh = async () => {
    if (pending.current) return;
    const id = ++request.current;
    setProposedHtml(latest.current.getHtml()); setPreview(null); setLoading(true); setError(null); setSourceReadError(null);
    try { const next = await previewZoteroNote(root, entryId, noteId); if (live.current && id === request.current) setPreview(next); }
    catch (caught) { if (live.current && id === request.current) setSourceReadError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (live.current && id === request.current) setLoading(false); }
  };
  useEffect(() => {
    if (open) void refresh();
    return () => { request.current++; };
  }, [open, root, entryId, noteId]);

  const save = async (writeSource: boolean) => {
    if (pending.current || writeSource && (!preview || proposedHtml === null || loading)) return;
    pending.current = true; setBusy(true); setError(null);
    let localSaved = false;
    try {
      if (writeSource && latest.current.getHtml() !== proposedHtml) throw new Error('本地内容已变化，请刷新差异后再确认替换。');
      if (writeSource && new DOMParser().parseFromString(proposedHtml!, 'text/html').querySelector('img')) throw new Error('本地内容含图片，暂不能直接写回 Zotero。请在 Zotero 中处理图片；本地草稿保留。');
      if (!await latest.current.onSaveLocal()) throw new Error('NeuInk 本地保存失败，请重试。未写入 Zotero。');
      localSaved = true;
      if (!live.current) return;
      if (writeSource) {
        if (latest.current.getHtml() !== proposedHtml) throw new Error('保存期间本地内容已变化，请刷新差异后再确认替换。');
        await overwriteZoteroNote(root, entryId, noteId, proposedHtml!, preview!);
        if (!live.current) return;
        notify({ tone: 'success', title: '已覆盖 Zotero 原笔记', description: 'NeuInk 本地笔记也已保存。' });
      } else {
        notify({ tone: 'success', title: '已保存到 NeuInk 本地', description: 'Zotero 原笔记保持不变。' });
      }
      request.current++; latest.current.onOpenChange(false);
    } catch (caught) {
      if (live.current) {
        const reason = caught instanceof Error ? caught.message : String(caught);
        setError(writeSource && localSaved ? `NeuInk 本地保存已完成，Zotero 写回未完成：${reason}` : reason);
        if (writeSource) setPreview(null);
      }
    } finally { pending.current = false; if (live.current) setBusy(false); }
  };
  const beforeHtml = preview?.html ?? origin.source_html;
  return <Dialog open={open} onOpenChange={value => { if (!pending.current) { if (!value) request.current++; onOpenChange(value); } }}>
    <DialogContent layout="bounded" className="max-w-4xl sm:max-w-4xl">
      <DialogHeader><DialogTitle>保存笔记</DialogTitle><DialogDescription>下方直接展示原文、本地内容和修改差异。保存到本地无需连接 Zotero；只有替换 Zotero 原笔记时，才需要 Zotero 10 及以上版本运行并允许本机应用访问。</DialogDescription></DialogHeader>
      <DialogBody className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{loading ? '正在核实 Zotero 当前原文…' : preview ? `已读取 Zotero 当前原文 · 版本 ${preview.version}` : '尚未核实 Zotero 当前原文'}</p>
          <Button size="xs" variant="ghost" disabled={loading || busy} onClick={() => void refresh()}>{loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <RefreshCw aria-hidden="true" />}刷新 Zotero 原文</Button>
        </div>
        {sourceReadError && <div role="status" aria-label="Zotero 原文读取状态" className="space-y-1 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">暂时无法获取 Zotero 最新原文，不影响保存到本地。</p>
          <p>直接点击下方“保存到本地”即可。需要替换原笔记时，再打开 Zotero 并刷新原文。</p>
          <details><summary className="cursor-pointer">查看读取详情</summary><p className="mt-1 break-words">{sourceReadError}</p></details>
        </div>}
        {!preview && beforeHtml != null && <p className="text-xs text-warning">当前比较使用 NeuInk 上次保留的 Zotero 原文，可能与来源最新内容不同。读取当前原文后才能确认替换；仍可直接保存到本地。</p>}
        {beforeHtml != null && proposedHtml !== null ? <ZoteroNoteChangePreview beforeHtml={beforeHtml} afterHtml={proposedHtml} /> : <p className="text-xs text-muted-foreground">{loading ? '正在读取原文并生成差异…' : '没有可比较的来源原文。打开 Zotero 后可刷新差异，或直接保存到本地。'}</p>}
        {preview && new DOMParser().parseFromString(preview.html, 'text/html').querySelector('img') && <p className="text-xs text-warning">原笔记含图片；覆盖后原图片可能无法保留，请在 Zotero 中确认。</p>}
        {preview && <p className="text-xs text-warning">确认替换会改写 Zotero 原笔记；Zotero 启用同步时，修改也会随之同步。写入时 Zotero 可能另行请求本机授权。</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => { request.current++; onOpenChange(false); }}>取消</Button><Button variant={preview ? 'outline' : 'default'} disabled={busy} onClick={() => void save(false)}>保存到本地</Button><Button variant={preview ? 'default' : 'outline'} disabled={busy || loading || !preview || proposedHtml === null} onClick={() => void save(true)}>确认替换 Zotero 笔记</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
