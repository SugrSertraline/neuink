import { BookPlus, ChevronDown, Database, ExternalLink, FileText, GitBranch, Loader2, TableProperties, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  SciverseConversationSourceLink,
  SciverseLibraryImportResult
} from '@/shared/ipc/assistantApi';

import {
  getSciversePaperRelations,
  getSciverseMetaCatalog,
  getSciversePaperSchema,
  readSciverseContent,
  searchSciverseMetadata
} from '../api/sciverseApi';
import type { SciverseContentResponse, SciverseJsonResponse, SciversePaperMetadata } from '../types';

type SciversePaperDetailDrawerProps = {
  source: SciverseConversationSourceLink;
  onClose: () => void;
  onImport: (source: SciverseConversationSourceLink) => Promise<SciverseLibraryImportResult>;
};

const INITIAL_CONTENT_LIMIT = 8_000;
const NEXT_CONTENT_LIMIT = 8_000;

export function SciversePaperDetailDrawer({
  source,
  onClose,
  onImport
}: SciversePaperDetailDrawerProps) {
  const [content, setContent] = useState<SciverseContentResponse | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [relation, setRelation] = useState<'CITATIONS' | 'REFERENCES' | 'RELATED_WORKS'>('REFERENCES');
  const [relationItems, setRelationItems] = useState<Array<Record<string, unknown>>>([]);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [relationLoading, setRelationLoading] = useState(false);
  const [uniqueId, setUniqueId] = useState<string | null>(null);
  const [metadataRecord, setMetadataRecord] = useState<SciversePaperMetadata | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<SciverseJsonResponse | null>(null);
  const [schema, setSchema] = useState<SciverseJsonResponse | null>(null);
  const [structuredLoading, setStructuredLoading] = useState(false);
  const [importState, setImportState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { result: SciverseLibraryImportResult; status: 'done' }
    | { message: string; status: 'error' }
  >({ status: 'idle' });

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setContentError(null);
    setImportState({ status: 'idle' });
    setRelationItems([]);
    setRelationError(null);
    setUniqueId(null);
    setMetadataRecord(null);
    setMetadataError(null);
    setLoadingContent(true);

    void readSciverseContent({
      doc_id: source.doc_id,
      limit: INITIAL_CONTENT_LIMIT,
      offset: source.offset ?? 0
    })
      .then((response) => {
        if (!cancelled) setContent(response);
      })
      .catch((error) => {
        if (!cancelled) setContentError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false);
      });

    return () => {
      cancelled = true;
    };
  }, [source.doc_id, source.offset]);

  useEffect(() => {
    let cancelled = false;
    void searchSciverseMetadata({
      fields: ['unique_id', 'doc_id', 'title'],
      filters: [],
      page: 1,
      page_size: 10,
      query: source.title
    })
      .then((response) => {
        const results = Array.isArray(response.results) ? response.results : [];
        const match = results.find((item): item is Record<string, unknown> =>
          isRecord(item) && item.doc_id === source.doc_id
        );
        const value = match?.unique_id;
        if (!cancelled) {
          setMetadataRecord(match ?? null);
          if (typeof value === 'string' && value.trim()) setUniqueId(value);
          if (!match) setMetadataError('Sciverse 未返回与当前文档匹配的结构化元数据。');
        }
      })
      .catch((error) => {
        if (!cancelled) setMetadataError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [source.doc_id, source.title]);

  useEffect(() => {
    let cancelled = false;
    setStructuredLoading(true);
    void Promise.all([getSciverseMetaCatalog(), getSciversePaperSchema()])
      .then(([nextCatalog, nextSchema]) => {
        if (!cancelled) {
          setCatalog(nextCatalog);
          setSchema(nextSchema);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setStructuredLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!uniqueId) return;
    let cancelled = false;
    setRelationLoading(true);
    setRelationError(null);
    void getSciversePaperRelations({ page: 1, page_size: 12, relation, unique_id: uniqueId })
      .then((response) => {
        const values = Array.isArray(response.items)
          ? response.items
          : Array.isArray(response.results)
            ? response.results
            : [];
        if (!cancelled) setRelationItems(values.filter(isRecord));
      })
      .catch((error) => {
        if (!cancelled) setRelationError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setRelationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [relation, uniqueId]);

  const loadMore = async () => {
    if (!content?.more || loadingContent) return;
    setLoadingContent(true);
    setContentError(null);
    try {
      const next = await readSciverseContent({
        doc_id: source.doc_id,
        limit: NEXT_CONTENT_LIMIT,
        offset: content.next_offset
      });
      setContent((current) =>
        current
          ? {
              ...next,
              chars_returned: current.chars_returned + next.chars_returned,
              text: `${current.text}${current.text && next.text ? '\n\n' : ''}${next.text}`
            }
          : next
      );
    } catch (error) {
      setContentError(errorMessage(error));
    } finally {
      setLoadingContent(false);
    }
  };

  const saveToLibrary = async () => {
    setImportState({ status: 'loading' });
    try {
      const result = await onImport(source);
      setImportState({ result, status: 'done' });
    } catch (error) {
      setImportState({ message: errorMessage(error), status: 'error' });
    }
  };

  const metadata = [
    source.publication_year ? String(source.publication_year) : null,
    source.venue,
    source.authors?.join(', '),
    source.citation_count != null ? `被引 ${source.citation_count}` : null
  ].filter((value): value is string => Boolean(value));
  const hasDownloadablePdf = Boolean(
    source.resource_file_name?.toLowerCase().endsWith('.pdf') || source.access_oa_url
  );
  const importLabel =
    importState.status === 'loading'
      ? '正在保存…'
      : importState.status === 'done'
        ? importState.result.status === 'created_with_pdf'
          ? '已保存并解析'
          : importState.result.status === 'created_with_remote_content'
            ? '已保存远程全文'
          : importState.result.status === 'already_exists'
            ? '已在本地文库'
            : '已保存（元数据）'
        : '保存到本地文库';

  return (
    <aside
      aria-label="Sciverse 远程论文详情"
      className="absolute inset-y-0 left-0 z-20 flex w-[90%] flex-col border-r bg-background shadow-2xl"
    >
      <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium text-primary">Sciverse 外部论文</div>
          <h2 className="mt-1 text-sm font-semibold leading-5">{source.title}</h2>
          {metadata.length > 0 ? (
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{metadata.join(' · ')}</p>
          ) : null}
        </div>
        <Button aria-label="关闭论文详情" size="icon-sm" title="关闭论文详情" type="button" variant="ghost" onClick={onClose}>
          <X size={16} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <Tabs defaultValue="overview">
          <TabsList className="mb-3 w-full justify-start overflow-x-auto" variant="line">
            <TabsTrigger className="text-xs" value="overview"><FileText size={13} />概览</TabsTrigger>
            <TabsTrigger className="text-xs" value="content"><FileText size={13} />正文</TabsTrigger>
            <TabsTrigger className="text-xs" value="resources"><Database size={13} />资源</TabsTrigger>
            <TabsTrigger className="text-xs" value="relations"><GitBranch size={13} />关系</TabsTrigger>
            <TabsTrigger className="text-xs" value="structured"><TableProperties size={13} />结构化字段</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
        <section className="grid gap-2 text-xs leading-5">
          {source.doi ? <div><span className="text-muted-foreground">DOI </span>{source.doi}</div> : null}
          <div className="break-all text-[11px] text-muted-foreground">doc_id: {source.doc_id}</div>
          {source.quote ? (
            <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground">{source.quote}</blockquote>
          ) : null}
          {hasDownloadablePdf ? (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px] text-primary">
              检索结果提供可下载 PDF；保存到本地文库时会自动下载并导入。
            </div>
          ) : null}
        </section>
          {metadataRecord?.abstract ? (
            <section className="mt-4 border-t pt-4">
              <h3 className="mb-2 text-xs font-semibold">摘要</h3>
              <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{metadataRecord.abstract}</p>
            </section>
          ) : null}
          </TabsContent>

        <TabsContent value="content">
        <section className="border-t pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold">远程全文</h3>
            {source.page_no != null ? <span className="text-[10px] text-muted-foreground">第 {source.page_no} 页附近</span> : null}
          </div>
          {loadingContent && !content ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="animate-spin" size={14} />正在读取正文…</div>
          ) : null}
          {contentError ? <p className="text-xs leading-5 text-destructive">{contentError}</p> : null}
          {content?.text ? (
            <div className="assistant-markdown break-words text-xs leading-6">
              <ReactMarkdown
                rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
                remarkPlugins={[remarkGfm, remarkMath]}
              >
                {normalizeMathDelimiters(content.text)}
              </ReactMarkdown>
            </div>
          ) : null}
          {content?.more ? (
            <Button className="mt-4" disabled={loadingContent} size="sm" type="button" variant="outline" onClick={() => void loadMore()}>
              {loadingContent ? <Loader2 className="animate-spin" size={14} /> : <ChevronDown size={14} />}
              继续读取
            </Button>
          ) : null}
        </section>
        </TabsContent>

        <TabsContent value="relations">
        <section className="border-t pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold">论文关系</h3>
            {!uniqueId ? <span className="text-[10px] text-muted-foreground">正在解析论文标识…</span> : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {([
              ['REFERENCES', '参考文献'],
              ['CITATIONS', '被引论文'],
              ['RELATED_WORKS', '相关工作']
            ] as const).map(([value, label]) => (
              <Button
                className="h-6 px-2 text-[10px]"
                key={value}
                size="xs"
                type="button"
                variant={relation === value ? 'secondary' : 'outline'}
                onClick={() => setRelation(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {relationLoading ? <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="animate-spin" size={13} />正在读取关系…</div> : null}
          {relationError ? <p className="mt-3 text-[11px] leading-5 text-destructive">{relationError}</p> : null}
          {!relationLoading && !relationError && uniqueId && relationItems.length === 0 ? <p className="mt-3 text-[11px] text-muted-foreground">当前接口未返回可展示的论文关系。</p> : null}
          {relationItems.length > 0 ? (
            <div className="mt-3 grid gap-1.5">
              {relationItems.map((item, index) => (
                <div className="rounded-md border bg-muted/20 px-2.5 py-2" key={String(item.unique_id ?? item.doc_id ?? index)}>
                  <div className="text-[11px] font-medium leading-4">{stringField(item, 'title') ?? '未命名论文'}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{[stringField(item, 'publication_published_year'), stringField(item, 'doi')].filter(Boolean).join(' · ')}</div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
        </TabsContent>

        <TabsContent value="resources">
          <section className="grid gap-3 border-t pt-4 text-xs leading-5">
            <div>
              <h3 className="font-semibold">可获取资源</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">资源下载仅会在你点击“保存到本地文库”后执行；优先使用 Sciverse resource，再尝试开放获取 PDF。</p>
            </div>
            {resourceCandidates(source, metadataRecord).length > 0 ? resourceCandidates(source, metadataRecord).map((candidate) => (
              <div className="rounded-md border bg-muted/20 px-2.5 py-2" key={candidate}>
                <div className="break-all text-[11px] font-medium">{candidate}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">Sciverse resource 候选</div>
              </div>
            )) : <p className="text-[11px] text-muted-foreground">当前元数据未提供可直接请求的资源文件名。保存时仍会尝试开放获取链接和服务端候选资源。</p>}
            {source.access_oa_url || metadataRecord?.access_oa_url ? <a className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline" href={String(metadataRecord?.access_oa_url ?? source.access_oa_url)} rel="noreferrer" target="_blank">开放获取链接 <ExternalLink size={12} /></a> : null}
          </section>
        </TabsContent>

        <TabsContent value="structured">
          <section className="grid gap-4 border-t pt-4 text-xs">
            <div>
              <h3 className="mb-2 font-semibold">当前论文元数据</h3>
              {metadataError ? <p className="text-[11px] text-destructive">{metadataError}</p> : null}
              {metadataRecord ? <StructuredRecord value={metadataRecord} /> : <p className="text-[11px] text-muted-foreground">正在读取元数据…</p>}
            </div>
            <div>
              <h3 className="mb-2 font-semibold">元数据字段目录</h3>
              {structuredLoading ? <p className="text-[11px] text-muted-foreground">正在读取字段目录和 Paper Schema…</p> : <JsonPreview value={catalog} emptyText="字段目录不可用。" />}
            </div>
            <div>
              <h3 className="mb-2 font-semibold">Paper Schema</h3>
              <JsonPreview value={schema} emptyText="Paper Schema 不可用。" />
            </div>
          </section>
        </TabsContent>
        </Tabs>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3">
        <Button disabled={importState.status === 'loading' || importState.status === 'done'} size="sm" type="button" onClick={() => void saveToLibrary()}>
          {importState.status === 'loading' ? <Loader2 className="animate-spin" size={14} /> : <BookPlus size={14} />}
          {importLabel}
        </Button>
        {source.access_oa_url ? (
          <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={source.access_oa_url} rel="noreferrer" target="_blank">
            开放获取链接 <ExternalLink size={12} />
          </a>
        ) : null}
        {importState.status === 'error' ? <span className="max-w-full text-[10px] text-destructive">{importState.message}</span> : null}
        {importState.status === 'done' && importState.result.pdfPath ? (
          <div className="w-full rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5 text-[10px] leading-4 text-emerald-800 dark:text-emerald-300">
            PDF 已下载并写入本地文库：
            <code className="mt-0.5 block break-all text-[9px]">{importState.result.pdfPath}</code>
          </div>
        ) : null}
        {importState.status === 'done' && !importState.result.pdfPath ? (
          <div className="w-full text-[10px] leading-4 text-muted-foreground">{importState.result.message}</div>
        ) : null}
        {importState.status === 'done' && importState.result.resourceAttempts?.length ? (
          <details className="w-full text-[10px] text-muted-foreground">
            <summary className="cursor-pointer">查看资源获取报告（{importState.result.resourceAttempts.length} 项）</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">{importState.result.resourceAttempts.map((attempt, index) => <li className="break-words" key={`${attempt}-${index}`}>{attempt}</li>)}</ul>
          </details>
        ) : null}
      </footer>
    </aside>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeMathDelimiters(markdown: string) {
  return markdown
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, latex: string) => `\n$$${latex.trim()}$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, latex: string) => `$${latex.trim()}$`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  return typeof field === 'string' || typeof field === 'number' ? String(field) : null;
}

function resourceCandidates(
  source: SciverseConversationSourceLink,
  metadata: SciversePaperMetadata | null
) {
  const candidates = new Set<string>();
  if (source.resource_file_name) candidates.add(source.resource_file_name);
  const collect = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if ((key.includes('file') || key.includes('resource') || key.includes('path')) && normalized.toLowerCase().endsWith('.pdf')) candidates.add(normalized);
      return;
    }
    if (Array.isArray(value)) value.forEach((item) => collect(item, key));
    if (isRecord(value)) Object.entries(value).forEach(([childKey, child]) => collect(child, childKey.toLowerCase()));
  };
  collect(metadata ?? {});
  return [...candidates];
}

function StructuredRecord({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value).filter(([, field]) => field !== null && field !== undefined && field !== '');
  return <div className="grid gap-1.5">{entries.map(([key, field]) => (
    <div className="grid grid-cols-[minmax(7rem,0.35fr)_1fr] gap-2 rounded-sm border bg-muted/15 px-2 py-1.5" key={key}>
      <span className="break-words text-[10px] text-muted-foreground">{key}</span>
      <span className="break-words text-[11px]">{formatField(field)}</span>
    </div>
  ))}</div>;
}

function JsonPreview({ value, emptyText }: { value: SciverseJsonResponse | null; emptyText: string }) {
  if (!value) return <p className="text-[11px] text-muted-foreground">{emptyText}</p>;
  return <pre className="max-h-72 overflow-auto rounded-md border bg-muted/20 p-2 text-[10px] leading-4 whitespace-pre-wrap break-words">{JSON.stringify(value, null, 2)}</pre>;
}

function formatField(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
