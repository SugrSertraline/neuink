import { ExternalLink, Focus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RELATION_LABELS, type RelationGraph, type RelationNode, type RelationEvidence } from './relationGraph';
import { RelationIcon } from './RelationIcon';

const STATUS_LABELS = { Parsed: '已解析', 'No PDF': '无 PDF', Queued: '排队中', Uploading: '上传中', Parsing: '解析中', Failed: '解析失败', Canceled: '已取消' };

export function RelationDetails({ node, graph, onSelect, onClose, onOpen, onSource, onFocus }: {
  node: RelationNode; graph: RelationGraph; onSelect: (id: string) => void; onClose: () => void;
  onOpen: (node: RelationNode) => void; onSource: (evidence: RelationEvidence) => void; onFocus: () => void;
}) {
  const edges = graph.edges.filter(edge => edge.from === node.id || edge.to === node.id);
  const byId = new Map(graph.nodes.map(item => [item.id, item]));
  const sources = edges.filter(edge => edge.kind === 'source' && edge.from === node.id).flatMap(edge => edge.evidence);
  return <section className="relation-details flex min-h-0 flex-col" aria-label="关系详情">
    <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2"><h2 className="flex-1 text-sm font-medium">详情</h2><Button variant="ghost" size="icon-sm" aria-label="关闭详情，返回关系图" onClick={onClose}><X size={14} /></Button></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-xs">
      <div className="space-y-2">
        <Badge variant="secondary" className="gap-1"><RelationIcon kind={node.kind} />{node.kind === 'tag' ? '标签' : node.kind === 'entry' ? '论文' : node.subtitle}</Badge>
        <h3 className="break-words text-sm font-medium">{node.title}</h3>
        {node.subtitle && node.subtitle !== node.title ? <p className="break-words text-muted-foreground">{node.subtitle}</p> : null}
        {!node.available ? <p role="status" className="text-muted-foreground">此对象不可打开，已有关系与引用快照仍保留。</p> : null}
        {node.note?.error ? <p role="alert" className="text-destructive">{node.note.error}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" disabled={!node.available} onClick={() => onOpen(node)}><ExternalLink size={12} />{node.kind === 'tag' ? '打开标签' : node.kind === 'entry' ? '打开条目' : '打开笔记'}</Button>
          <Button size="sm" variant="ghost" onClick={onFocus}><Focus size={12} />只看关联</Button>
        </div>
      </div>
      {node.tag ? <section className="space-y-1"><h3 className="font-medium">描述</h3><p className="whitespace-pre-wrap break-words text-muted-foreground">{node.tag.description || '暂无描述'}</p></section> : null}
      {node.entry ? <dl className="space-y-2 border-t pt-3">
        <div><dt className="text-muted-foreground">解析状态</dt><dd>{STATUS_LABELS[node.entry.status]}</dd></div>
        {Object.entries(node.entry.fields).map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{key}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
      </dl> : null}
      <section className="space-y-1 border-t pt-3"><h3 className="mb-2 font-medium">直接关系 · {edges.length}</h3>
        {!edges.length ? <p className="text-muted-foreground">尚未建立关系</p> : edges.map(edge => {
          const other = byId.get(edge.from === node.id ? edge.to : edge.from);
          if (!other) return null;
          const label = edge.kind === 'source' ? edge.from === node.id ? '引用来源' : '被笔记引用'
            : edge.kind === 'hierarchy' ? edge.from === node.id ? '下级标签' : '上级标签'
              : edge.kind === 'ownership' ? edge.from === node.id ? '拥有笔记' : '笔记归属' : RELATION_LABELS.membership;
          return <Button key={edge.id} variant="plain" className="h-auto w-full min-w-0 justify-start gap-2 px-2 py-2 text-left" onClick={() => onSelect(other.id)}>
            <RelationIcon kind={other.kind} /><span className="min-w-0 flex-1"><span className="block truncate text-xs">{other.title}</span><span className="block text-[11px] text-muted-foreground">{label}{edge.evidence.length ? ` · ${edge.evidence.length} 处` : ''}</span></span>
          </Button>;
        })}
      </section>
      {sources.length ? <section className="space-y-2 border-t pt-3"><h3 className="font-medium">原文快照 · {sources.length}</h3>
        {sources.map((item, index) => <div key={`${item.anchorId}:${index}`} className="space-y-1 border-l-2 border-border pl-2">
          <p className="text-muted-foreground">{byId.get(`entry:${item.source.entry_id}`)?.title} · 第 {item.source.page} 页</p>
          {item.message ? <p className="text-muted-foreground">{item.message}</p> : null}
          <p className="whitespace-pre-wrap break-words">{item.source.snapshot_text || '此引用未保存文字快照'}</p>
          <Button variant="ghost" size="xs" disabled={!item.canLocate} onClick={() => onSource(item)}>定位原文</Button>
        </div>)}
      </section> : null}
    </div>
  </section>;
}
