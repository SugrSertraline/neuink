import type { AssistantComposerMention, AssistantContextInput } from '@/shared/types/assistant';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { AssistantContextChip } from './AssistantContextChip';
import { useAssistantReading } from './AssistantReplyActionsContext';
import { listItemAddress } from '@/shared/lib/listItemSegments';

export type MentionAttrs = Omit<AssistantComposerMention, 'charOffset' | 'marker'>;

export function AssistantMentionChip({ mention, onOpenSource, onRemove }: {
  mention: MentionAttrs;
  onOpenSource?: (source: ConversationSourceLink) => void;
  onRemove?: () => void;
}) {
  const actions = useAssistantReading();
  const openSource = onOpenSource ?? actions?.openSource;
  const isSegment = mention.kind === 'segment';
  const listItem = isSegment && mention.segmentUid ? listItemAddress(mention.segmentUid) : null;
  const input = mentionContextInput(mention);
  const open = isSegment && openSource && mention.entryId && mention.pageIdx != null
    ? () => openSource({ entry_id: mention.entryId, entry_title: mention.entryTitle,
      segment_uid: mention.segmentUid ?? '', page_idx: mention.pageIdx!, quote: mention.text ?? '' })
    : input && actions?.openContext ? () => actions.openContext!(input) : undefined;
  return <AssistantContextChip label={mention.label ?? mention.entryTitle ?? '引用'} title={mention.entryTitle || mention.tagName || mention.label || '引用'}
    kindLabel={listItem ? `列表项 ${listItem.index + 1}` : kindLabel(mention.kind)} text={mention.kind === 'tag' ? '标签用于限定这次问题的检索范围。' : mention.text}
    pageIdx={isSegment ? mention.pageIdx : null} entryId={mention.entryId} workspaceRoot={actions?.root}
    onOpen={open} onRemove={onRemove} />;
}

export function mentionContextInput(mention: MentionAttrs): AssistantContextInput | null {
  if (mention.kind === 'tag') return null;
  if (mention.kind === 'segment') return { id: mention.id, kind: 'segment', entryId: mention.entryId,
    entryTitle: mention.entryTitle, pageIdx: mention.pageIdx ?? 0, segmentUid: mention.segmentUid ?? '', text: mention.text ?? '' };
  return { id: mention.id, kind: 'entry', entryId: mention.entryId, entryTitle: mention.entryTitle,
    contentId: mention.contentId ?? undefined, contentKind: mention.kind, contentTitle: mention.contentTitle ?? undefined };
}

export function kindLabel(kind: string | null | undefined) {
  return ({ tag: 'Tag', pdf: 'PDF', note: '笔记', overview: '概览', reflow: '重排', segment: '片段' } as Record<string, string>)[kind ?? ''] ?? '资料';
}
