import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { hoverInteractionBlocked } from '@/components/ui/hover-interactions';
import { useToast } from '@/shared/hooks/useToast';
import { listItemSegments, listItemTexts } from '@/shared/lib/listItemSegments';
import type { SourceSegment } from '@/shared/types/domain';
import { PaperTextPreview } from '../navigation/PaperReferences';
import { warmReflowPreviewAssets, type ReflowPreviewPointerState } from './ReflowSourcePreview';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import { cn } from '@/lib/utils';

const ListItemInteractionContext = createContext<{
  activeUid?: string | null; flashUid?: string | null; dragUid?: string | null;
  translations?: Map<string, TranslatedSegment>;
}>({});
export const ListItemInteractionProvider = ListItemInteractionContext.Provider;

export function InteractiveListContent({ entryId, hoverPreviewEnabled, onPreviewChange, pdfDocument,
  reflowTranslationMode, relatedImagePath, segment, translatedText, workspaceRoot,
}: {
  entryId: string; hoverPreviewEnabled: boolean;
  onPreviewChange: (next: ReflowPreviewPointerState | null) => void;
  pdfDocument: PDFDocumentProxy | null;
  reflowTranslationMode: 'source' | 'translation' | 'bilingual';
  relatedImagePath?: string | null; segment: SourceSegment;
  translatedText: string | null; workspaceRoot: string | null;
}) {
  const items = useMemo(() => listItemSegments(segment), [segment]);
  const interaction = useContext(ListItemInteractionContext);
  const translations = useMemo(() => translatedText?.trim() ? listItemTexts(translatedText) : [], [translatedText]);
  const { notify } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedKey(null), 1200);
      notify({ title: '列表项已复制', tone: 'success', durationMs: 1400 });
    } catch { notify({ title: '复制列表项失败', tone: 'danger', durationMs: 1800 }); }
  };
  const preview = (markdown: string) => <PaperTextPreview allowScroll={false} flush markdown={markdown}
    relatedImagePath={relatedImagePath} segmentType="list" sourceEntryId={entryId || null}
    showMermaidDiagrams workspaceRoot={workspaceRoot} />;
  if (!items.length) return preview(segment.markdown ?? segment.text);
  // Never attach an unrelated source item when a translation merged or split the list.
  const matchedTranslation = translations.length === items.length;
  const renderItems = (translated: boolean) => <div className="grid min-w-0 gap-1" role="list">
    {items.map((item, index) => {
      const ownTranslation = interaction.translations?.get(item.uid)?.translated_text;
      const text = translated ? ownTranslation || translations[index] : item.markdown ?? item.text;
      const key = `${translated ? 'translation' : 'source'}:${item.uid}`;
      return <div key={key} role="listitem" tabIndex={0}
        data-reflow-list-item={item.uid} data-reading-selection-source={item.uid}
        className={cn('group/list-item grid min-w-0 grid-cols-[minmax(0,1fr)_1.75rem] items-start gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          interaction.activeUid === item.uid && 'bg-primary/5', interaction.flashUid === item.uid && 'segment-navigation-highlight',
          interaction.dragUid === item.uid && 'bg-primary/15')}
        onMouseMove={event => {
          event.stopPropagation();
          if (!hoverPreviewEnabled || event.ctrlKey || event.buttons !== 0 || hoverInteractionBlocked()) { onPreviewChange(null); return; }
          warmReflowPreviewAssets({ entryId, markdown: item.markdown ?? item.text, pdfDocument, relatedImagePath, segment: item, workspaceRoot });
          onPreviewChange({ position: { x: event.clientX, y: event.clientY }, relatedImagePath, segment: item });
        }}>
        <div className="min-w-0">{preview(text)}</div>
        <Button size="icon-xs" variant="ghost" aria-label="复制这一项" title="复制这一项"
          className="opacity-0 group-hover/list-item:opacity-100 group-focus-within/list-item:opacity-100"
          onClick={event => { event.stopPropagation(); void copy(text, key); }}>
          {copiedKey === key ? <Check size={13} /> : <Copy size={13} />}
        </Button>
      </div>;
    })}
  </div>;
  if (reflowTranslationMode === 'translation' && matchedTranslation) return renderItems(true);
  return <>
    {renderItems(false)}
    {reflowTranslationMode !== 'source' && translatedText?.trim() && <div className="mt-2 min-w-0 border-t pt-2 text-[0.95em] text-muted-foreground">
      {matchedTranslation ? renderItems(true) : preview(translatedText)}
    </div>}
  </>;
}
