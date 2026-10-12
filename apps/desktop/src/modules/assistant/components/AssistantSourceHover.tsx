import type { ReactElement } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { isSciverseConversationSource, type ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { useAssistantReading } from './AssistantReplyActionsContext';

/** Keep the existing citation button and navigation; the preview is read-only. */
export function AssistantSourceHover({ source, children }: { source: ConversationSourceLink; children: ReactElement }) {
  const actions = useAssistantReading();
  const remote = isSciverseConversationSource(source);
  const title = remote ? source.title : source.entry_title;
  const page = remote ? source.page_no : source.page_idx + 1;
  return <HoverCard>
    <HoverCardTrigger asChild>{children}</HoverCardTrigger>
    <HoverCardContent side="top" align="start" className="w-96" aria-label={`引用详情：${title}`}>
      <p className="text-xs text-muted-foreground">{remote ? '论文来源' : '原文片段'}{page != null ? ` · 第 ${page} 页` : ''}</p>
      <p className="mb-2 mt-1 border-b border-border pb-2 text-sm font-medium">{title}</p>
      {source.quote?.trim() ? <SourceSnapshotPreview markdown={source.quote} compact flush allowScroll={false}
        showMermaidDiagrams={false} workspaceRoot={remote ? null : actions?.root} sourceEntryId={remote ? undefined : source.entry_id} />
        : <p className="text-xs text-muted-foreground">此引用没有保存正文，可点击引用查看来源。</p>}
    </HoverCardContent>
  </HoverCard>;
}
