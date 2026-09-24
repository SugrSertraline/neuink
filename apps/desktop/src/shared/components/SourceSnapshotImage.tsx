import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SourceSnapshotImageDetail } from './SourceSnapshotImageDetail';
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
    {open && <SourceSnapshotImageDetail key={src} alt={alt} src={src} />}
  </Dialog>;
}
