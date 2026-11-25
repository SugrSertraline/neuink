import { memo } from 'react';
import type { CardKind } from '@/shared/ipc/ideationApi';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { cardFaceSummary } from './cardPresentation';

export const PaperCardBody = memo(function PaperCardBody({ card }: { card: { kind: CardKind; body?: string } }) {
  const markdown = cardFaceSummary(card);
  if (!markdown.trim()) return null;
  return <div className="pointer-events-none max-h-24 overflow-hidden border-t border-border/60 pt-1.5 text-xs leading-5 text-muted-foreground [&_p]:my-1 [&_.katex-display]:my-1 [&_.katex-display]:overflow-hidden [&_img]:hidden">
    <SourceSnapshotPreview markdown={markdown} normalization="none" compact flush allowScroll={false} imageDetailEnabled={false} tableDetailEnabled={false} showMermaidDiagrams={false} />
  </div>;
}, (previous, next) => previous.card.kind === next.card.kind && previous.card.body === next.card.body);
