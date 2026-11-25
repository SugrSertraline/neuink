import { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { researchPapersFromResult, runResearchTool, type ResearchPaper } from '@/shared/ipc/researchApi';
import type { FieldDefinition } from '@/shared/ipc/fieldDefinitionsApi';
import type { EntryFieldDraft } from './EntryFieldsEditor';

/** Only populate enabled, empty properties; preserve unsupported and existing values. */
export function fillEmptyPaperFields(fields: EntryFieldDraft[], definitions: FieldDefinition[], paper: ResearchPaper): EntryFieldDraft[] {
  const eligible = (name: string) => definitions.find(definition => definition.name === name && !definition.hidden);
  const candidates: Record<string, string> = {};
  if (/^\d{4}$/.test(paper.year)) candidates['发表年份'] = paper.year;
  if (paper.doi.trim()) candidates.DOI = paper.doi.trim();
  if (paper.url.trim()) candidates['论文链接'] = paper.url.trim();
  if (paper.provider.toLowerCase() === 'arxiv') candidates['出版类型'] = '预印本';
  const next = fields.map(field => ({ ...field }));
  for (const [name, value] of Object.entries(candidates)) {
    const definition = eligible(name);
    if (!definition) continue;
    if (definition.kind === 'select' && !definition.options.includes(value)) continue;
    if (name === '发表年份' && !(definition.kind === 'number' || (definition.kind === 'date' && (definition.date_precision ?? 'day') === 'year'))) continue;
    if ((name === 'DOI' || name === '论文链接') && definition.kind !== 'text') continue;
    if (name === '出版类型' && definition.kind !== 'select' && definition.kind !== 'text') continue;
    const existing = next.find(field => field.key === name);
    if (existing) { if (!existing.value.trim()) existing.value = value; }
    else next.push({ id: `lookup-${name}-${next.length}`, key: name, value });
  }
  return next;
}

export function EntryMetadataLookup({ root, title, disabled, onApply }: { root: string | null; title: string; disabled?: boolean; onApply: (paper: ResearchPaper) => number }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [busy, setBusy] = useState(false);
  const [papers, setPapers] = useState<ResearchPaper[]>([]), [error, setError] = useState(''), [searched, setSearched] = useState(false), [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null), sequence = useRef(0);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  const close = () => { sequence.current++; controller.current?.abort(); controller.current = null; setBusy(false); setOpen(false); };
  const search = async () => {
    if (!root || !query.trim() || busy) return;
    const current = ++sequence.current, abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setNotice(''); setPapers([]); setSearched(true);
    try {
      const term = query.trim();
      const arxivTerm = term.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
      const sources = await Promise.allSettled([
        runResearchTool('search_papers', { root, query: `all:"${arxivTerm}"`, source: 'arxiv', limit: 10 }, abort.signal),
        runResearchTool('search_papers', { root, query: term, source: 'crossref', limit: 10 }, abort.signal),
      ]);
      if (sequence.current !== current) return;
      const names = ['arXiv', 'Crossref'];
      const failed = sources.flatMap((result, index) => result.status === 'rejected' ? [names[index]] : []);
      if (failed.length === sources.length) {
        const first = sources[0];
        throw first.status === 'rejected' ? first.reason : new Error('检索服务不可用，请稍后重试。');
      }
      const seen = new Set<string>();
      const results = sources.flatMap(result => result.status === 'fulfilled' ? researchPapersFromResult(result.value) : []);
      setPapers(results.filter(paper => {
        const key = paper.doi.trim().toLowerCase() || paper.id;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }));
      if (failed.length) setNotice(`部分数据源不可用：${failed.join('、')}。`);
    } catch (caught) {
      if (sequence.current === current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally { if (sequence.current === current) { controller.current = null; setBusy(false); } }
  };
  return <><Button type="button" size="sm" variant="outline" disabled={disabled || !root} onClick={() => { setQuery(title); setPapers([]); setError(''); setNotice(''); setSearched(false); setOpen(true); }}><Search size={14} aria-hidden="true" />在线查找属性</Button>
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}><DialogContent layout="bounded" className="max-w-2xl"><DialogHeader><DialogTitle>在线查找论文信息</DialogTitle><DialogDescription>将搜索词发送到 arXiv 和 Crossref。请核对标题和作者；选择后仅填充空白属性，保存条目时才写入资料库。</DialogDescription></DialogHeader><DialogBody className="space-y-3"><form className="flex gap-2" onSubmit={event => { event.preventDefault(); void search(); }}><Input aria-label="论文检索词" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} placeholder="输入论文标题或 DOI"/><Button type="submit" disabled={busy || !query.trim()}>{busy ? <><Loader2 size={14} className="animate-spin" />查找中</> : '查找'}</Button></form>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}{notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}{!busy && searched && !error && papers.length === 0 && <p className="py-4 text-sm text-muted-foreground">没有找到候选论文，请检查标题或更换关键词。</p>}<div className="divide-y divide-border rounded-md border border-border">{papers.map(paper => <div key={paper.id} className="flex items-start gap-3 p-3"><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{paper.title}</p><p className="mt-1 text-xs text-muted-foreground">{paper.authors.length ? paper.authors.join('、') : '作者未提供'} · {paper.year || '年份未提供'} · {paper.provider}</p>{paper.doi && <p className="mt-1 break-all text-xs text-muted-foreground">DOI：{paper.doi}</p>}</div><Button type="button" size="sm" variant="outline" onClick={() => { const count = onApply(paper); setNotice(count ? `已填充 ${count} 项空白属性，请检查后保存。` : '没有可填充的空白属性，已有内容未被覆盖。'); }}>填充空白</Button></div>)}</div></DialogBody><DialogFooter><Button type="button" variant="outline" onClick={close}>关闭</Button></DialogFooter></DialogContent></Dialog></>;
}
