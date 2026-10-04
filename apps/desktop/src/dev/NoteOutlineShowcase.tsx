import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MarkdownNoteEditor } from '@/modules/notes/components/MarkdownNoteEditor';
import { ToastContext } from '@/shared/hooks/useToast';
import '@/styles/globals.css';

// Isolated real-editor fixture: synthetic notes, no workspace or model requests.
const markdown = ['# 论文阅读笔记', '研究主题、方法与证据。',
  ...Array.from({ length: 18 }, (_, index) => `## ${index + 1}. ${index ? '实验结果与方法对比' : '研究问题'}\n\n${'这是一段用于检查目录定位和窄屏排版的示例文字。'.repeat(12)}\n\n### 关键结论\n\n- 观察与证据\n- 适用范围`)].join('\n\n');
const notifications = { dismiss: () => {}, notify: () => 'fixture' };
const load = async () => ({ note_id: 'outline-showcase', title: '论文阅读笔记', markdown, links: [], revision: '1' });
const save = async (title: string, body: string) => ({ note_id: 'outline-showcase', title, markdown: body, links: [], revision: '2' });

function Showcase() {
  const [width, setWidth] = useState(900);
  const [scale, setScale] = useState(1);
  const [appearance, setAppearance] = useState(false);
  useEffect(() => {
    if (appearance) document.documentElement.dataset.appearance = 'atelier';
    else delete document.documentElement.dataset.appearance;
  }, [appearance]);
  return <TooltipProvider><ToastContext.Provider value={notifications}>
    <main className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
        <span className="text-xs text-muted-foreground">示例笔记 · 不读写资料库</span>
        {[900, 650, 540, 280, 200].map(value => <Button key={value} size="sm" variant={width === value ? 'secondary' : 'ghost'} onClick={() => setWidth(value)}>{value}px</Button>)}
        <Button size="sm" variant="outline" onClick={() => setScale(value => value === 1 ? 1.25 : 1)}>{Math.round(scale * 100)}%</Button>
        <Button size="sm" variant="outline" onClick={() => setAppearance(value => !value)}>切换拟物</Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden" style={{ zoom: scale }}>
        <div data-outline-fixture className="h-full max-w-full border-r bg-card" style={{ width }}>
          <MarkdownNoteEditor entryId="outline-showcase" noteId="outline-showcase" fallbackTitle="论文阅读笔记" onLoadNote={load} onSaveNote={save} />
        </div>
      </div>
    </main>
  </ToastContext.Provider></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Showcase />);
