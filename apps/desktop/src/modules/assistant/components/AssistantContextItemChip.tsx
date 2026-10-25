import type { AssistantContextInput } from '@/shared/types/assistant';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { AssistantContextChip } from './AssistantContextChip';
import { useAssistantReading } from './AssistantReplyActionsContext';
import { listItemAddress } from '@/shared/lib/listItemSegments';

export function AssistantContextItemChip({ item, onOpenSource, onRemove }: {
  item: AssistantContextInput;
  onOpenSource?: (source: ConversationSourceLink) => void;
  onRemove?: () => void;
}) {
  const actions = useAssistantReading();
  const openSource = onOpenSource ?? actions?.openSource;
  const open = item.kind === 'segment' && openSource
    ? () => openSource({ entry_id: item.entryId, entry_title: item.entryTitle,
      segment_uid: item.segmentUid, page_idx: item.pageIdx, quote: item.text })
    : actions?.openContext ? () => actions.openContext!(item) : undefined;
  const listItem = item.kind === 'segment' ? listItemAddress(item.segmentUid) : null;
  const kindLabel = item.kind === 'segment' ? (item.id?.startsWith('selection:') ? '选区' : listItem ? `列表项 ${listItem.index + 1}` : '片段')
    : item.contentKind === 'pdf' ? 'PDF' : item.contentKind === 'note' ? '笔记' : item.contentKind === 'reflow' ? '重排' : '资料';
  return <AssistantContextChip label={item.kind === 'entry' ? item.contentTitle || item.entryTitle : item.entryTitle}
    title={item.entryTitle} kindLabel={kindLabel} entryId={item.entryId} workspaceRoot={actions?.root}
    text={item.kind !== 'entry' ? item.text : undefined} pageIdx={item.kind === 'segment' ? item.pageIdx : undefined}
    onOpen={open} onRemove={onRemove} />;
}
