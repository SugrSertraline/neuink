import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PointerPreview, type PreviewAnchor } from '@/components/ui/pointer-preview';
import { useReaderPreviewVisible } from '@/components/ui/hover-interactions';
import '../styles/globals.css';

const summary = '这篇论文比较了多篇文献中的研究方法。笔记保留原文来源，标签组织研究主题。';

function Preview({ label, long = false, side = 'right' }: { label: string; long?: boolean; side?: 'right' | 'left' | 'top' | 'bottom' }) {
  return <HoverCard><HoverCardTrigger asChild openOnClick><Button variant="outline">{label}</Button></HoverCardTrigger>
    <HoverCardContent side={side} align="start" className="w-96">
      <p className="font-medium">论文详情</p><p className="mt-1 text-xs text-muted-foreground">软件工程 / 需求理解 · 12 页</p>
      <p className="mt-2 whitespace-pre-wrap text-sm">{long ? Array.from({ length: 32 }, (_, i) => `${i + 1}. ${summary}`).join('\n') : summary}</p>
    </HoverCardContent></HoverCard>;
}

function ReadingPreview({ anchor }: { anchor: PreviewAnchor }) {
  const visible = useReaderPreviewVisible('sample');
  return visible ? <PointerPreview anchor={anchor} width={480}>
    <div className="border-b px-3 py-2 text-xs font-medium">原文 · 第 3 页</div>
    <div className="p-3">{summary.repeat(8)}</div>
  </PointerPreview> : null;
}

function HoverShowcase() {
  const [scale, setScale] = useState(1);
  const [anchor, setAnchor] = useState<PreviewAnchor | null>(null);
  const [page, setPage] = useState(1);
  const [violet, setViolet] = useState(false);
  const dragged = useRef(false);
  const changeScale = (next: number) => {
    document.documentElement.style.zoom = String(next);
    window.dispatchEvent(new Event('resize'));
    setScale(next);
  };
  return <TooltipProvider><main className="min-h-full bg-background p-6 text-foreground">
    <header className="mb-5 flex flex-wrap items-center gap-3 border-b pb-4">
      <h1 className="mr-auto text-base font-semibold">悬停组件检查</h1>
      <Button size="sm" variant="outline" onClick={() => { document.documentElement.dataset.theme = violet ? 'blue' : 'violet'; setViolet((value) => !value); }}>{violet ? '蓝色主题' : '紫色主题'}</Button>
      {[0.7, 1, 1.25, 1.5].map((value) => <Button size="sm" variant={scale === value ? 'secondary' : 'outline'} key={value} onClick={() => changeScale(value)}>{value * 100}%</Button>)}
    </header>
    <p className="mb-4 text-xs text-muted-foreground">示例数据。检查悬停、点击、Tab、Esc、滚动、窗口边缘与缩放，不会读取或修改工作区。</p>
    <div className="flex flex-wrap items-center gap-3 border-b pb-4">
      <Preview label="摘要预览" />
      <Preview label="长文本预览" long />
      <Tooltip><TooltipTrigger asChild><Button variant="outline" aria-label="阅读设置">工具提示</Button></TooltipTrigger><TooltipContent>调整阅读显示</TooltipContent></Tooltip>
      <Dialog><DialogTrigger asChild><Button variant="outline">弹窗内预览</Button></DialogTrigger><DialogContent layout="bounded"><DialogTitle>翻译任务</DialogTitle><DialogDescription>检查弹窗内的预览层级和内部滚动。</DialogDescription><div className="flex flex-1 items-center justify-center"><Preview label="查看原文" long side="left" /></div></DialogContent></Dialog>
      <Button variant="outline" onClick={() => { setPage((value) => value + 1); window.dispatchEvent(new Event('neuink:reader-surface-change')); }}>切换页面 {page}</Button>
      <span draggable className="cursor-grab rounded border px-3 py-1.5 text-xs" onDragStart={() => { dragged.current = true; }} onDragEnd={() => { dragged.current = false; }}>拖动示例</span>
    </div>
    <div className="mt-5 max-h-56 overflow-auto border bg-card p-3">
      {Array.from({ length: 8 }, (_, i) => <div className="flex min-h-11 items-center justify-between border-b py-1" key={i}><span className="text-sm">条目 {i + 1} · 多文献阅读与来源笔记</span><Preview label={`查看条目 ${i + 1}`} /></div>)}
    </div>
    <div className="mt-5 h-48 border bg-card p-4 text-sm text-muted-foreground"
      onPointerMove={(event) => setAnchor(event.buttons || dragged.current ? null : { x: event.clientX, top: event.clientY, bottom: event.clientY })}
      onPointerLeave={() => setAnchor(null)}>阅读区域：移动鼠标查看原文预览；按住鼠标移动时停止预览。</div>
    {anchor ? <ReadingPreview anchor={anchor} /> : null}
    <div className="fixed bottom-3 left-3"><Preview label="左下边缘" long side="left" /></div>
    <div className="fixed right-3 bottom-3"><Preview label="右下边缘" long side="right" /></div>
  </main></TooltipProvider>;
}

// A separate Vite development entry: never part of the production app or workspace navigation.
if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!);
  root.render(<StrictMode><HoverShowcase /></StrictMode>);
  import.meta.hot?.dispose(() => root.unmount());
}
