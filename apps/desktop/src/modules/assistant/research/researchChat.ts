import type { AssistantContextItem, AssistantComposerSnapshot } from '@/shared/types/assistant';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { ResearchSelection } from '@/shared/ipc/deepResearchApi';

/** Only explicitly attached items and @ tags enter research; never the entire library. */
export function researchSelections(items: AssistantContextItem[], snapshot: AssistantComposerSnapshot, entries: LibraryEntry[]): ResearchSelection[] {
  const selections: ResearchSelection[] = items.map(item => item.kind === 'segment'
    ? { kind: 'segment', entry_id: item.entryId, segment_uid: item.segmentUid }
    : item.contentKind === 'note' && item.contentId
      ? { kind: 'note', entry_id: item.entryId, note_id: item.contentId }
      : { kind: 'entry', entry_id: item.entryId });
  for (const mention of snapshot.mentions) {
    if (mention.kind === 'tag' && mention.tagId) {
      for (const entry of entries.filter(entry => entry.tagIds?.includes(mention.tagId!))) {
        selections.push({ kind: 'entry', entry_id: entry.id });
      }
    }
  }
  const unique = [...new Map(selections.map(selection => [JSON.stringify(selection), selection])).values()];
  if (unique.length > 10) throw new Error('一次最多附加 10 份资料，请缩小引用的标签范围。');
  return unique;
}
