import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { SourceSnapshotImageSize } from './SourceSnapshotPreview';

export function SourceSnapshotImage({ alt, className, detailEnabled = false, fillWidth = false, size = 'standard', src, onError }: {
  alt: string;
  className?: string;
  detailEnabled?: boolean;
  fillWidth?: boolean;
  size?: SourceSnapshotImageSize;
  src: string;
  onError?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const image = <img key={attempt} alt={alt} src={src} loading="lazy" draggable={false}
    onError={() => { setFailed(true); onError?.(); }}
    className={cn('mx-auto block h-auto max-w-full rounded-sm border object-contain',
      fillWidth || size === 'full' ? 'max-h-[min(40vh,24rem)] w-auto' : size === 'compact' ? 'max-h-48 max-w-[60%]' : size === 'large' ? 'max-h-[32rem]' : 'max-h-80', className)} />;
  if (failed) return <span role="status" className="my-2 block rounded-sm border border-dashed p-2 text-xs">
    图片无法读取。<Button size="xs" variant="ghost" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>重试图片</Button>
  </span>;
  if (!detailEnabled) return image;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <button type="button" aria-label={'查看' + alt + '详情'} title="点击放大查看"
        className="mx-auto block max-w-full cursor-zoom-in rounded-sm text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        {image}
        <span className="block py-1 text-[11px] text-muted-foreground">点击放大查看</span>
      </button>
    </DialogTrigger>
    {open && <ImageDetail alt={alt} src={src} />}
  </Dialog>;
}

function ImageDetail({ alt, src }: { alt: string; src: string }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    const element = viewport;
    if (!element) return;
    const measure = () => setAvailable({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport]);
  const fitted = natural.width && available.width
    ? Math.min(1, available.width / natural.width, available.height / natural.height) : 1;
  const scale = zoom ?? fitted;
  return <DialogContent showCloseButton={false}
    className="source-preview-detail grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-2"
    onClick={(event) => event.stopPropagation()}>
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1"><DialogTitle>图片详情</DialogTitle><DialogDescription className="truncate" title={alt}>{alt}</DialogDescription></div>
      <Button size="xs" variant={zoom === null ? 'secondary' : 'outline'} onClick={() => setZoom(null)}>适应窗口</Button>
      <Button size="xs" variant="outline" onClick={() => setZoom(1)}>原始大小</Button>
      <Button size="xs" variant="outline" aria-label="缩小图片" disabled={scale <= 0.1} onClick={() => setZoom(Math.max(0.1, scale / 1.25))}>−</Button>
      <span className="min-w-10 text-center text-xs">{Math.round(scale * 100)}%</span>
      <Button size="xs" variant="outline" aria-label="放大图片" disabled={scale >= 4} onClick={() => setZoom(Math.min(4, scale * 1.25))}>+</Button>
      <DialogClose asChild><Button size="xs" variant="outline">关闭大图</Button></DialogClose>
    </div>
    <div ref={setViewport} className="min-h-0 min-w-0 overflow-auto overscroll-contain rounded-md bg-muted" role="region" aria-label="图片详情内容" tabIndex={0}>
      <img alt={alt} src={src} draggable={false}
        onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        className="mx-auto block h-auto"
        style={natural.width ? { width: natural.width * scale, maxWidth: 'none' } : { maxWidth: '100%' }} />
    </div>
  </DialogContent>;
}
