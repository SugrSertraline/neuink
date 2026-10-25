import { beginEntryTagDrag, cancelEntryTagDrag, finishEntryTagDrag, updateEntryTagDrag } from '@/shared/lib/entryDragData';
import { usePointerItemDrag } from '@/shared/lib/usePointerItemDrag';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';

type Entry = Pick<LibraryEntry, 'id' | 'title'>;
const session = {
  begin: (entry: Entry, x: number, y: number) => beginEntryTagDrag(entry.id, x, y),
  update: updateEntryTagDrag, finish: finishEntryTagDrag, cancel: cancelEntryTagDrag,
};
export function useLibraryEntryDrag(context: string) {
  const drag = usePointerItemDrag(context, session);
  return {
    entryDragHandlers: drag.handlers,
    draggingEntryId: drag.preview?.item.id ?? null,
    entryDragPreview: drag.preview ? { title: drag.preview.item.title, x: drag.preview.x, y: drag.preview.y } : null,
    consumeDragClick: drag.consumeDragClick,
  };
}
