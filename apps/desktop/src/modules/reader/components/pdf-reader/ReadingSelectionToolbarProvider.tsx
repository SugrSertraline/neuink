import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { PdfTextSelectionToolbarContent, type PdfTextSelectionToolbarProps } from './PdfTextSelectionToolbar';
import { ReadingSelectionToolbarContext } from './readingSelectionToolbarContext';

/** PDF pages publish selections to one stable toolbar owned by the reader. */
export function ReadingSelectionToolbarProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ owner: string; props: PdfTextSelectionToolbarProps } | null>(null);
  const publish = useCallback((owner: string, props: PdfTextSelectionToolbarProps) => {
    setCurrent(previous => {
      if ((!props.pending || props.visible === false) && previous?.owner !== owner) return previous;
      return { owner, props: { ...props, visible: true, pending: props.visible === false ? null : props.pending } };
    });
  }, []);
  const release = useCallback((owner: string) => {
    setCurrent(previous => previous?.owner === owner
      ? { ...previous, props: { ...previous.props, pending: null } } : previous);
  }, []);
  const value = useMemo(() => ({ publish, release }), [publish, release]);
  return <ReadingSelectionToolbarContext.Provider value={value}>
    {children}
    {current && <PdfTextSelectionToolbarContent {...current.props} />}
  </ReadingSelectionToolbarContext.Provider>;
}
