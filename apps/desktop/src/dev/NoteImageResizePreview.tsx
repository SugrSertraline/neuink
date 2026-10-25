import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button } from '@/components/ui/button';
import { NoteImage } from '@/modules/notes/editor/NoteImage';

const chart = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#f3f6fa"/><path d="M60 40V440H760 M60 340H760 M60 240H760 M60 140H760" fill="none" stroke="#bcc5d0"/><path d="M60 410L180 330L300 355L420 190L540 250L650 140L760 60" fill="none" stroke="#4169a1" stroke-width="5"/><text x="90" y="80" font-size="26" fill="#253448">Image resize · Reading notes</text></svg>')}`;

/** Real Tiptap node view, isolated from workspace files and autosave. */
export function NoteImageResizePreview() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [readonly, setReadonly] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit, NoteImage.configure({ entryId: 'preview', noteId: 'preview' })],
    content: { type: 'doc', content: [
      ...Array.from({ length: 10 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `阅读笔记 ${i + 1}：图表的尺寸可以调整，调节控件保持原位。` }] })),
      { type: 'image', attrs: { src: chart, alt: '缩放测试图表', width: 80 } },
      { type: 'paragraph', content: [{ type: 'text', text: '图后说明：可连续缩放、输入百分比、切换对齐方式。' }] }
    ] },
    editorProps: { attributes: { class: 'min-h-full p-4 outline-none text-sm leading-8' } },
  });
  useEffect(() => {
    const previous = document.documentElement.style.zoom;
    document.documentElement.style.zoom = String(zoom);
    return () => { document.documentElement.style.zoom = previous; };
  }, [zoom]);
  const locate = () => {
    let position = -1;
    editor?.state.doc.descendants((node, pos) => { if (node.type.name === 'image') position = pos; });
    if (position >= 0) editor?.commands.setNodeSelection(position);
    const image = scrollRef.current?.querySelector('img');
    image?.scrollIntoView({ block: 'center' });
  };
  return <main style={{ height: `${100 / zoom}vh` }} className="flex flex-col bg-background p-3">
    <div className="mb-2 flex flex-wrap gap-2">
      <Button size="sm" onClick={locate}>定位测试图片</Button>
      <Button size="sm" variant="outline" onClick={() => setCompact(value => !value)}>{compact ? '恢复宽屏' : '窄分屏'}</Button>
      <Button size="sm" variant="outline" onClick={() => setZoom(value => value === 1 ? 1.25 : 1)}>{zoom === 1 ? '125%' : '100%'}</Button>
      <Button size="sm" variant="outline" onClick={() => { editor?.setEditable(readonly); setReadonly(!readonly); }}>{readonly ? '恢复编辑' : '只读'}</Button>
    </div>
    <div className="flex min-h-0 flex-1">
      <section style={{ width: compact ? 320 : 'min(840px, 100%)' }} className="flex min-h-0 flex-col border bg-card">
        <header className="shrink-0 border-b px-3 py-2 text-sm">文档笔记 · 图片缩放</header>
        <div ref={scrollRef} data-testid="image-note-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
          <EditorContent editor={editor}/>
        </div>
      </section>
    </div>
  </main>;
}
