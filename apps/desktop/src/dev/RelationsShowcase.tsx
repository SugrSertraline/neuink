import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { RelationsPage } from '@/modules/relations/RelationsPage';
import { relationCatalog, relationEntries, relationTags } from './relationsFixture';
import '../styles/globals.css';

function RelationsShowcase() {
  const [state, setState] = useState('normal'), [narrow, setNarrow] = useState(false), [zoomed, setZoomed] = useState(false);
  const [opened, setOpened] = useState(''), [message, setMessage] = useState('独立示例数据，不连接真实工作区');
  const entries = useMemo(() => state === 'many' ? Array.from({ length: 600 }, (_, i) => ({ ...relationEntries[i % 4], id: `many-${i}`, title: `研究 ${i + 1}`, contents: [] })) : relationEntries, [state]);
  return <main className="flex h-dvh flex-col bg-background text-foreground">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs"><span>关系图检查</span>
      {[['normal', '正常'], ['loading', '加载'], ['error', '错误'], ['empty', '空'], ['many', '600 篇论文']].map(([value, label]) => <Button key={value} size="xs" variant={state === value ? 'secondary' : 'ghost'} onClick={() => setState(value)}>{label}</Button>)}
      <Button size="xs" variant="outline" onClick={() => setNarrow(value => !value)}>窄窗口</Button><Button size="xs" variant="outline" onClick={() => setZoomed(value => !value)}>125%</Button>
    </div>
    <div className="relative min-h-0 flex-1 self-center border-x" style={{ width: narrow ? 560 : '100%', maxWidth: '100%', zoom: zoomed ? 1.25 : 1 }}>
      <div className="h-full" style={{ display: opened ? 'none' : undefined }}><RelationsPage active={!opened} entries={state === 'empty' ? [] : entries} tags={state === 'empty' ? [] : relationTags} trashedEntries={[]}
        catalog={state === 'empty' ? { notes: [], errors: [] } : relationCatalog} loading={state === 'loading'} error={state === 'error' ? '示例：笔记目录暂时不可用' : null}
        onRefresh={() => { setState('normal'); setMessage('关系已刷新'); }} onBack={() => setOpened('条目库')}
        onOpen={node => setOpened(node.title)} onSource={item => setOpened(`原文第 ${item.source.page} 页`)} /></div>
      {opened ? <div className="space-y-3 p-4"><Button variant="outline" onClick={() => setOpened('')}>返回关系图</Button><p>{opened}</p><p className="text-xs text-muted-foreground">此处为原页面跳转示意；正式版打开已有的条目、标签或笔记页面。</p></div> : null}
    </div>
    <p className="shrink-0 border-t px-3 py-1 text-xs text-muted-foreground">{message}</p>
  </main>;
}
if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!); root.render(<RelationsShowcase />);
  import.meta.hot?.dispose(() => root.unmount());
}
