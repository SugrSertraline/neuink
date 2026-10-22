import { Component, type ReactNode, type RefObject } from 'react';
import type { ReadingPosition } from '../navigation/ReadingNavigation';
import { capturePdfReadingPosition, restorePdfReadingPosition } from '../navigation/pdfReadingPosition';
import { capturePdfZoomAnchor, restorePdfZoomAnchor, type PdfZoomAnchor, type PdfZoomScroll } from './pdfViewportLayout';

type Props = { scrollRef: RefObject<HTMLDivElement>; documentKey?: string; pageWidth: number; zoom: number; bookMode: boolean; leftInset?: number; children: ReactNode };
type LayoutSnapshot = { zoom: PdfZoomAnchor } | { reading: ReadingPosition } | null;

/** Capture BEFORE React changes page geometry; effect cleanup is already too late. */
export class PdfLayoutAnchor extends Component<Props, Record<string, never>, LayoutSnapshot> {
  private zoomScroll: PdfZoomScroll | null = null;
  private zoomAnchor: PdfZoomAnchor | null = null;
  private releaseAnchor: (() => void) | null = null;

  private cancelZoomAnchor = () => {
    this.releaseAnchor?.();
    this.releaseAnchor = null;
    this.zoomAnchor = null;
    this.zoomScroll = null;
  };

  private restoreZoomAnchor = () => {
    const container = this.props.scrollRef.current;
    if (!container || !this.zoomAnchor) return;
    this.zoomScroll = restorePdfZoomAnchor(container, this.zoomAnchor, this.props.leftInset ?? 0) ?? null;
    if (!this.zoomScroll) this.cancelZoomAnchor();
  };

  private holdZoomAnchor(anchor: PdfZoomAnchor) {
    const container = this.props.scrollRef.current;
    if (!container || this.zoomAnchor === anchor) return;
    this.cancelZoomAnchor();
    this.zoomAnchor = anchor;
    // WebView's automatic scroll anchoring otherwise competes with our center
    // when PDF.js replaces text/raster layers after the React geometry commit.
    const overflowAnchor = container.style.overflowAnchor;
    container.style.overflowAnchor = 'none';
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(this.restoreZoomAnchor);
    observer?.observe(container);
    observer?.observe(anchor.paper);
    const stage = container.querySelector('[data-pdf-document-stage]');
    if (stage) observer?.observe(stage);
    const onWheel = (event: WheelEvent) => { if (!event.ctrlKey) this.cancelZoomAnchor(); };
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) this.cancelZoomAnchor();
    };
    const onScroll = () => {
      if (this.zoomScroll && (Math.abs(container.scrollLeft - this.zoomScroll.left) > 1 || Math.abs(container.scrollTop - this.zoomScroll.top) > 1)) this.cancelZoomAnchor();
    };
    const onVisibility = () => { if (document.hidden) this.cancelZoomAnchor(); };
    container.addEventListener('wheel', onWheel, { capture: true, passive: true });
    container.addEventListener('pointerdown', this.cancelZoomAnchor, true);
    container.addEventListener('keydown', onKey, true);
    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', this.cancelZoomAnchor);
    window.addEventListener('blur', this.cancelZoomAnchor);
    document.addEventListener('visibilitychange', onVisibility);
    this.releaseAnchor = () => {
      observer?.disconnect();
      container.style.overflowAnchor = overflowAnchor;
      container.removeEventListener('wheel', onWheel, true);
      container.removeEventListener('pointerdown', this.cancelZoomAnchor, true);
      container.removeEventListener('keydown', onKey, true);
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', this.cancelZoomAnchor);
      window.removeEventListener('blur', this.cancelZoomAnchor);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }

  getSnapshotBeforeUpdate(previous: Props) {
    if (previous.documentKey !== this.props.documentKey || previous.bookMode !== this.props.bookMode || previous.leftInset !== this.props.leftInset) {
      this.cancelZoomAnchor(); return null;
    }
    if (previous.zoom !== this.props.zoom) {
      const container = this.props.scrollRef.current;
      if (container && this.zoomScroll && (Math.abs(container.scrollLeft - this.zoomScroll.left) > 1 || Math.abs(container.scrollTop - this.zoomScroll.top) > 1)) this.cancelZoomAnchor();
      const zoom = this.zoomAnchor ?? capturePdfZoomAnchor(container, previous.leftInset ?? 0);
      if (zoom) this.holdZoomAnchor(zoom);
      return zoom ? { zoom } : null;
    }
    // Resizing a split preserves the top reading position; book navigation owns
    // spread changes. Explicit zoom in either mode keeps the viewport center.
    if (previous.pageWidth === this.props.pageWidth || this.props.bookMode) return null;
    this.cancelZoomAnchor();
    const reading = capturePdfReadingPosition(this.props.scrollRef.current);
    return reading ? { reading } : null;
  }
  componentDidUpdate(_previous: Props, _state: Record<string, never>, snapshot: LayoutSnapshot) {
    const container = this.props.scrollRef.current;
    if (this.zoomAnchor && !container?.contains(this.zoomAnchor.paper)) this.cancelZoomAnchor();
    if (!snapshot || !container) return;
    if ('zoom' in snapshot) this.restoreZoomAnchor();
    else restorePdfReadingPosition(container, snapshot.reading);
  }
  componentWillUnmount() { this.cancelZoomAnchor(); }
  render() { return this.props.children; }
}
