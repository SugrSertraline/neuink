import { Checkbox } from '@/components/ui/checkbox';
import type { LibraryPaperSelection } from './useLibrarySelection';

export function LibrarySelectionCheckbox({ entryId, title, selection }: { entryId: string; title: string; selection: LibraryPaperSelection }) {
  return <Checkbox aria-label={`选择 ${title}`} checked={selection.ids.has(entryId)}
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onClick={event => { event.preventDefault(); event.stopPropagation(); selection.toggle(entryId, event.shiftKey); }} />;
}
