import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PDF_MAX_ZOOM, PDF_MIN_ZOOM } from './readerConstants';

export function PdfZoomControls({ zoom, onZoomIn, onZoomOut, onZoomReset }: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}) {
  return <div className="flex shrink-0 items-center gap-1" role="group" aria-label="PDF 缩放">
    <Button aria-label="缩小" disabled={zoom <= PDF_MIN_ZOOM} size="icon-sm" title="缩小 1%" type="button" variant="outline" onClick={onZoomOut}>
      <ZoomOut size={14} aria-hidden="true" />
    </Button>
    <Button aria-label="恢复 100%" className="pdf-reader-zoom-value w-14 px-1 text-xs tabular-nums" size="sm" title="恢复 100%" type="button" variant="ghost" onClick={onZoomReset}>
      {Math.round(zoom * 100)}%
    </Button>
    <Button aria-label="放大" disabled={zoom >= PDF_MAX_ZOOM} size="icon-sm" title="放大 1%" type="button" variant="outline" onClick={onZoomIn}>
      <ZoomIn size={14} aria-hidden="true" />
    </Button>
  </div>;
}
