import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EntryLibraryView } from '@/modules/reader/components/EntryLibraryView';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { WorkspaceNotesProvider } from '@/modules/notes/WorkspaceNotesContext';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import { ToastContext } from '@/shared/hooks/useToast';
import type { TagMeta } from '@/shared/types/domain';
import '../styles/globals.css';

const initialTags: TagMeta[] = [
  { id: 'software', name: '软件工程', parent_id: null, description: '', created_at: '', updated_at: '' },
  ...['人机交互', '会议', '期刊', 'CCF 等级'].map((name, i) => ({ id: `root-${i}`, name, parent_id: null, created_at: '', updated_at: '' })),
  ...['基准测试', '形式化验证', '自动逻辑规范生成'].map((name, i) => ({ id: `child-${i}`, name, parent_id: 'software', created_at: '', updated_at: '' })),
  { id: 'alignment', name: '需求对齐', parent_id: 'software', description: '比较多篇论文如何表达需求、验证结果，以及保留可回查的原文证据。'.repeat(8), created_at: '', updated_at: '' },
  { id: 'long', name: '长期软件演化中的需求理解、验证与人机协作：跨论文阅读与证据索引', parent_id: 'alignment', created_at: '', updated_at: '' },
  ...Array.from({ length: 36 }, (_, i) => ({ id: `more-${i}`, name: `研究方向 ${i + 1}`, parent_id: null, created_at: '', updated_at: '' }))
];
const titles = [
  'Bridging the Gap between User Intent and LLM: A Requirement Alignment Approach',
  'SlopCodeBench: Benchmarking How Coding Agents Degrade Over Long-Horizon Iterative Tasks',
  'SR-Eval: Evaluating LLMs on Code Generation under Stepwise Requirement Refinement',
  'Shift-Left Requirements Verification',
  '跨论文阅读中的需求分析与来源关联：面向长期知识管理的设计、验证以及比较研究'
];
const initialEntries: LibraryEntry[] = Array.from({ length: 24 }, (_, i) => ({
  id: `sample-${i}`, title: `${titles[i % titles.length]}${i < titles.length ? '' : ` (${i + 1})`}`,
  contents: [], fields: {}, tagIds: i % 4 === 0 ? [] : [i % 3 === 0 ? 'long' : 'alignment'],
  tags: i % 4 === 0 ? [] : [i % 3 === 0 ? '软件工程/需求对齐/长期软件演化中的需求理解、验证与人机协作：跨论文阅读与证据索引' : '软件工程/需求对齐'],
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z',
  pdfFileName: i % 5 === 0 ? null : `research-paper-${i + 1}.pdf`,
  parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100
}));
const noop = () => undefined;

function LibraryShowcase() {
  const [tags, setTags] = useState(initialTags);
  const [entries, setEntries] = useState(initialEntries);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [status, setStatus] = useState<'ready' | 'loading' | 'error'>('ready');
  const [empty, setEmpty] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [manyTags, setManyTags] = useState(false);
  const [scale, setScale] = useState(1);
  const [message, setMessage] = useState('示例数据；只在此页演示，不读取工作区。');
  const displayTags = manyTags ? tags : tags.filter(tag => !tag.id.startsWith('more-'));
  return <TooltipProvider><ToastContext.Provider value={{ dismiss: noop, notify: toast => { setMessage(toast.title); return 'preview'; } }}>
    <WorkspaceNotesProvider root={null} refreshKey="preview">
      <main className="flex flex-col overflow-hidden bg-background" style={{ width: `calc(100dvw / ${scale})`, height: `calc(100dvh / ${scale})` }}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
          {([['全部条目场景', null], ['标签场景', 'software'], ['长描述', 'alignment'], ['深层标签', 'long']] as const).map(([label, tag]) => <Button key={label} size="sm" variant={activeTag === tag ? 'secondary' : 'ghost'} onClick={() => setActiveTag(tag)}>{label}</Button>)}
          <Button size="sm" variant="outline" onClick={() => setEmpty(value => !value)}>{empty ? '显示条目' : '空列表'}</Button>
          <Button size="sm" variant="outline" onClick={() => setManyTags(value => !value)}>{manyTags ? '常规标签' : '多标签'}</Button>
          <Button size="sm" variant="outline" onClick={() => setStatus(value => value === 'ready' ? 'loading' : value === 'loading' ? 'error' : 'ready')}>{status === 'ready' ? '模拟加载' : status === 'loading' ? '模拟失败' : '恢复正常'}</Button>
          <Button size="sm" variant="outline" onClick={() => setNarrow(value => !value)}>{narrow ? '完整宽度' : '分屏宽度'}</Button>
          {[1, 1.25, 1.5].map(value => <Button key={value} size="sm" variant={scale === value ? 'secondary' : 'ghost'} onClick={() => { document.documentElement.style.zoom = String(value); setScale(value); window.dispatchEvent(new Event('resize')); }}>{value * 100}%</Button>)}
        </div>
        <div className="min-h-0 flex-1 p-3">
          <div className="h-full min-h-0 overflow-hidden border bg-card" style={{ width: narrow ? 'min(100%, 560px)' : '100%' }}>
            <EntryLibraryView standalone activeTag={activeTag} entries={empty ? [] : entries} tags={displayTags} status={status} libraryView="all"
              workspaceRoot={null} filterResetKey={0} isRefreshingParseStatus={false} recentReadingEntryIds={[]} selectedEntryId="sample-1"
              trashItems={[]} trashedEntries={[]} onSelectTag={setActiveTag} onSelectEntry={noop} onOpenEntryExplorer={id => setMessage(`打开详情：${id}`)}
              onOpenEntryInSidePane={id => setMessage(`在右侧打开：${id}`)} onDeleteEntry={noop} onOpenCreateEntryTab={() => setMessage('创建条目入口')}
              onPurgeEntry={noop} onPurgeTrashItem={noop} onRefreshParseStatus={noop} onReparseEntry={noop} onRestoreEntry={noop} onRestoreTrashItem={noop}
              onOpenTagNote={noop} onManageTags={() => setMessage('管理标签入口')} onOpenTagReading={id => setMessage(`平行阅读：${id}`)}
              onUpdateEntry={(id, request) => {
                const tagIds = [...buildTagPathById(displayTags)].filter(([, path]) => request.tagPaths.includes(path)).map(([tagId]) => tagId);
                setEntries(current => current.map(entry => entry.id === id ? { ...entry, title: request.title, fields: request.fields, tags: request.tagPaths, tagIds } : entry));
              }}
              onUpdateTagDescription={async (id, description) => {
                const saved = { ...tags.find(tag => tag.id === id)!, description };
                setTags(current => current.map(tag => tag.id === id ? saved : tag)); return saved;
              }} />
          </div>
        </div>
        <p role="status" className="shrink-0 border-t px-3 py-1 text-xs text-muted-foreground">{message}</p>
      </main>
    </WorkspaceNotesProvider>
  </ToastContext.Provider></TooltipProvider>;
}

if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!);
  root.render(<LibraryShowcase />);
  import.meta.hot?.dispose(() => root.unmount());
}
