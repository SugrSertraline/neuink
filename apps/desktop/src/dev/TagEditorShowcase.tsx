import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { TagEditorPage } from '@/modules/library/components/TagEditorPage';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import { AppearanceProvider } from '@/shared/components/AppearanceProvider';
import type { TagMeta } from '@/shared/types/domain';
import '@/styles/globals.css';

const seed: TagMeta[] = ['机器学习', '软件工程', '知识管理'].flatMap((name, index) => [
  { id: `root-${index}`, name, parent_id: null, created_at: '', updated_at: '' },
  ...['研究方法', '数据与评估', '长期研究中的跨论文阅读、来源关联与可解释性分析'].flatMap((child, i) => [
    { id: `child-${index}-${i}`, name: child, parent_id: `root-${index}`, created_at: '', updated_at: '' },
    { id: `leaf-${index}-${i}`, name: `方向 ${i + 1}`, parent_id: `child-${index}-${i}`, created_at: '', updated_at: '' }
  ])
]);

function TagEditorShowcase() {
  const [tags, setTags] = useState(seed);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [failure, setFailure] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [scale, setScale] = useState(1);
  const [message, setMessage] = useState('虚构标签，仅修改本页内存，不连接资料库。');
  useEffect(() => {
    // Match the desktop policy so an unmarked custom menu cannot pass this preview.
    const guard = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-allow-context-menu="true"]')) event.preventDefault();
    };
    document.addEventListener('contextmenu', guard, true);
    return () => document.removeEventListener('contextmenu', guard, true);
  }, []);
  const check = () => { if (failure) throw new Error('示例保存失败，请关闭失败模拟后重试。'); };
  return <main className="flex flex-col overflow-hidden bg-background text-foreground" style={{ width: `calc(100dvw / ${scale})`, height: `calc(100dvh / ${scale})` }}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
      <Button size="sm" variant="outline" onClick={() => setNarrow(value => !value)}>{narrow ? '完整宽度' : '分屏宽度'}</Button>
      <Button size="sm" variant="outline" onClick={() => setEmpty(value => !value)}>{empty ? '显示标签' : '空标签'}</Button>
      <Button size="sm" variant="outline" onClick={() => setFailure(value => !value)}>{failure ? '恢复保存' : '模拟保存失败'}</Button>
      {[1, 1.25].map(value => <Button key={value} size="sm" variant={scale === value ? 'secondary' : 'ghost'} onClick={() => { document.documentElement.style.zoom = String(value); setScale(value); window.dispatchEvent(new Event('resize')); }}>界面 {value * 100}%</Button>)}
    </div>
    <div className="min-h-0 flex-1" style={{ width: narrow ? 'min(100%, 560px)' : '100%' }}>
      <TagEditorPage standalone activeTag={activeTag} tags={empty ? [] : tags} entries={[]}
        onSelectTag={id => { setActiveTag(id); setMessage(`打开标签：${tags.find(tag => tag.id === id)?.name ?? '全部'}`); }}
        onRenameTag={(id, name) => { check(); setTags(current => current.map(tag => tag.id === id ? { ...tag, name } : tag)); }}
        onCreateTagPath={path => {
          check(); setEmpty(false);
          setTags(current => {
            const next = [...current]; let parent: string | null = null;
            for (const name of path.split('/').map(part => part.trim()).filter(Boolean)) {
              let tag = next.find(item => item.name === name && item.parent_id === parent);
              if (!tag) { tag = { id: crypto.randomUUID(), name, parent_id: parent, created_at: '', updated_at: '' }; next.push(tag); }
              parent = tag.id;
            }
            return next;
          });
        }}
        onDeleteTag={id => {
          check(); const paths = buildTagPathById(tags), target = paths.get(id);
          setTags(current => current.filter(tag => tag.id !== id && !paths.get(tag.id)?.startsWith(`${target}/`)));
        }} />
    </div>
    <footer role="status" className="shrink-0 border-t px-3 py-1 text-xs text-muted-foreground">{message}</footer>
  </main>;
}

if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!);
  root.render(<AppearanceProvider><TagEditorShowcase /></AppearanceProvider>);
  import.meta.hot?.dispose(() => root.unmount());
}
