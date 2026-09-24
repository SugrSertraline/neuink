import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useImageViewport } from './useImageViewport';

/** Ephemeral viewer state; the canvas owns zoom/pan, Radix owns focus and dismissal. */
export function SourceSnapshotImageDetail({ alt, src }: { alt: string; src: string }) {
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const hintId = useId();
  const image = useImageViewport(natural);
  const ready = status === 'ready';
  return <DialogContent showCloseButton={false} layout="bounded"
    className="h-[min(38rem,calc(100%-2rem))] max-w-[56rem] gap-2 sm:max-w-[56rem]"
    onClick={event => event.stopPropagation()}
    onMouseMove={event => event.stopPropagation()}
    onPointerMove={event => event.stopPropagation()}
    onContextMenu={event => event.stopPropagation()}
    onOpenAutoFocus={event => { event.preventDefault(); image.focus(); }}
    onEscapeKeyDown={event => { if (image.endDrag(true)) event.preventDefault(); }}>
    <div className="flex min-w-0 shrink-0 items-center gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <DialogTitle>图片详情</DialogTitle>
        <DialogDescription className="truncate" title={alt}>{alt}</DialogDescription>
      </div>
      <DialogClose asChild><Button size="xs" variant="outline">关闭大图</Button></DialogClose>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-1.5" role="group" aria-label="图片缩放">
      <Button size="xs" variant={image.isFitted ? 'secondary' : 'outline'} disabled={!ready} onClick={image.fit}>适应窗口</Button>
      <Button size="xs" variant="outline" disabled={!ready} onClick={image.original}>原始大小</Button>
      <div className="flex items-center gap-1">
        <Button size="xs" variant="outline" aria-label="缩小图片" disabled={!ready || image.scale <= image.minScale} onClick={() => image.zoomBy(1 / 1.25)}>−</Button>
        <span className="min-w-10 text-center text-xs tabular-nums" aria-label="图片缩放比例">{ready ? `${Math.round(image.scale * 100)}%` : '—'}</span>
        <Button size="xs" variant="outline" aria-label="放大图片" disabled={!ready || image.scale >= 4} onClick={() => image.zoomBy(1.25)}>+</Button>
      </div>
    </div>
    <div ref={image.setViewport} role="region" aria-label="图片详情内容" aria-describedby={hintId} tabIndex={0}
      aria-busy={status === 'loading'} {...image.handlers}
      className={cn('relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden overscroll-contain rounded-md bg-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-ring',
        image.dragging ? 'cursor-grabbing' : image.canPan ? 'cursor-grab' : 'cursor-default')}>
      <img key={attempt} alt={alt} src={src} draggable={false} decoding="async"
        onLoad={event => {
          setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
          setStatus('ready');
        }}
        onError={() => { setNatural({ width: 0, height: 0 }); setStatus('error'); }}
        className="pointer-events-none absolute top-1/2 left-1/2 block max-w-none select-none"
        style={{ width: natural.width * image.scale, height: natural.height * image.scale,
          visibility: ready ? 'visible' : 'hidden',
          transform: `translate(-50%, -50%) translate(${image.offset.x}px, ${image.offset.y}px)` }} />
      {status !== 'ready' && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
        {status === 'loading' ? '正在加载图片…' : <>
          图片无法读取。
          <Button size="xs" variant="outline" onClick={() => { image.fit(); setStatus('loading'); setAttempt(value => value + 1); }}>重试图片</Button>
        </>}
      </div>}
    </div>
    <p id={hintId} className="shrink-0 text-xs text-muted-foreground">滚轮缩放 · 放大后按住拖动 · 方向键移动 · 0 适应窗口</p>
  </DialogContent>;
}
