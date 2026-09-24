import { Component, type ReactNode, type RefObject } from 'react';
import type { ReadingPosition } from '../navigation/ReadingNavigation';
import { capturePdfReadingPosition, restorePdfReadingPosition } from '../navigation/pdfReadingPosition';

type Props = { scrollRef: RefObject<HTMLDivElement>; pageWidth: number; zoom: number; bookMode: boolean; children: ReactNode };

/** Capture BEFORE React changes page geometry; effect cleanup is already too late. */
export class PdfLayoutAnchor extends Component<Props, Record<string, never>, ReadingPosition | null> {
  getSnapshotBeforeUpdate(previous: Props) {
    // Explicit zoom has its own pointer anchor; book navigation owns its current spread.
    if (previous.pageWidth === this.props.pageWidth || previous.zoom !== this.props.zoom || previous.bookMode || this.props.bookMode) return null;
    return capturePdfReadingPosition(this.props.scrollRef.current);
  }
  componentDidUpdate(_previous: Props, _state: Record<string, never>, position: ReadingPosition | null) {
    if (position && this.props.scrollRef.current) restorePdfReadingPosition(this.props.scrollRef.current, position);
  }
  render() { return this.props.children; }
}
