import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Local image/crop state only; parent profile owns the saved avatar and dirty protection. */
export function CloudAvatarEditor({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const version = useRef(0);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [error, setError] = useState('');
  useEffect(() => () => { version.current++; }, []);
  useEffect(() => {
    if (!source || !canvas.current) return;
    const context = canvas.current.getContext('2d');
    if (!context) return;
    const side = Math.min(source.naturalWidth, source.naturalHeight) / zoom;
    context.clearRect(0, 0, 256, 256);
    context.drawImage(source, (source.naturalWidth - side) * x / 100, (source.naturalHeight - side) * y / 100, side, side, 0, 0, 256, 256);
  }, [source, zoom, x, y]);
  async function select(file?: File) {
    if (!file) return;
    const request = ++version.current; setError(''); setSource(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('请选择不超过 5 MB 的 PNG、JPEG 或 WebP 图片。'); return; }
    setLoading(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (request !== version.current) return;
      if (image.naturalWidth * image.naturalHeight > 25000000) throw new Error();
      setZoom(1); setX(50); setY(50); setSource(image);
    } catch { if (request === version.current) setError('无法读取这张图片，请选择较小的有效图片。'); }
    finally { URL.revokeObjectURL(url); if (request === version.current) setLoading(false); }
  }
  return <fieldset disabled={disabled} className="space-y-3">
    <legend className="mb-2 text-sm font-medium">编辑头像</legend>
    <div className="flex flex-wrap items-start gap-4">
      {source ? <canvas ref={canvas} width={256} height={256} aria-label="头像裁剪预览" className="size-32 rounded-full bg-muted" /> : value ? <img src={value} alt="当前头像" className="size-20 rounded-full object-cover" /> : <div className="flex size-20 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">默认头像</div>}
      <div className="min-w-0 flex-1 space-y-2">
        <label className="block space-y-2 text-xs">选择头像图片<Input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || loading} onChange={event => { void select(event.target.files?.[0]); event.target.value = ''; }} /></label>
        <p className="text-xs text-muted-foreground">PNG、JPEG、WebP，最多 5 MB。裁剪后作为个人资料保存。</p>
        {source && <>{[['缩放', zoom, 1, 3, 0.05, setZoom], ['水平位置', x, 0, 100, 1, setX], ['垂直位置', y, 0, 100, 1, setY]].map(([label, value, min, max, step, change]) => <label key={String(label)} className="flex items-center gap-3 text-xs"><span className="w-16 shrink-0">{String(label)}</span><Input type="range" className="h-6 accent-primary" value={Number(value)} min={Number(min)} max={Number(max)} step={Number(step)} onChange={event => (change as (value: number) => void)(Number(event.target.value))} /></label>)}</>}
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      {source && <Button type="button" size="sm" onClick={() => { const data = canvas.current?.toDataURL('image/png'); if (data && data.length <= 360000) { onChange(data); setSource(null); } else setError('头像处理失败，请换一张图片。'); }}>使用此头像</Button>}
      {(value || source) && <Button type="button" size="sm" variant="outline" onClick={() => { version.current++; setSource(null); onChange(''); }}>恢复默认头像</Button>}
    </div>
    {loading && <p role="status" className="text-xs">正在读取图片…</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </fieldset>;
}
