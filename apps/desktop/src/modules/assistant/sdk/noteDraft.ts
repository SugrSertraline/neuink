import { generateText } from 'ai';

import { readEntryAssistantContext } from '@/shared/ipc/assistantApi';
import type {
  AssistantContextSnapshot,
  ConversationMessage,
  ConversationSourceLink,
  LlmProfile,
  ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import { readNote } from '@/shared/ipc/workspaceApi';
import type {
  AssistantActiveNote,
  AssistantContext,
  AssistantTaskPlan
} from '@/shared/types/assistant';

import { assistantContextCharBudget } from './contextBudget';
import {
  buildDraftProposal,
  citedEvidenceSources,
  resolveTargetNote
} from './noteProposal';
import { createNeuinkModel, generationSettings } from './provider';

export { citedEvidenceSources } from './noteProposal';

type GenerateNoteDraftOptions = {
  abortSignal?: AbortSignal;
  assistantContext?: AssistantContext | null;
  contextSnapshot: AssistantContextSnapshot;
  conversationHistory?: ConversationMessage[];
  currentEntry?: { id: string; title: string } | null;
  currentNote?: AssistantActiveNote | null;
  plan: AssistantTaskPlan;
  question: string;
  root: string;
  seedEvidence?: ConversationSourceLink[];
  scope: ScopeSnapshot;
  settings: LlmProfile;
};

export async function generateNoteDraftProposal({
  abortSignal,
  assistantContext,
  contextSnapshot,
  conversationHistory = [],
  currentEntry,
  currentNote,
  plan,
  question,
  root,
  seedEvidence = [],
  scope,
  settings
}: GenerateNoteDraftOptions) {
  const targetNote = await resolveTargetNote({
    contextSnapshot,
    currentNote,
    plan,
    root
  });
  const evidence = await collectNoteEvidence({
    assistantContext,
    contextSnapshot,
    plan,
    root,
    seedEvidence,
    settings
  });
  const operation = normalizedOperation(plan, contextSnapshot);
  const prompt = noteDraftPrompt({
    conversationContext: recentConversation(conversationHistory),
    currentNoteMarkdown: targetNote.markdown,
    evidence: evidence.text,
    operation,
    question
  });
  const result = await generateText({
    abortSignal,
    ...generationSettings(settings),
    model: createNeuinkModel(settings),
    prompt,
    system: [
      'You are the Neuink Note Writer.',
      'Return only the Markdown that belongs in the note.',
      'Never ask the user a question. Never include workflow commentary, choices, confirmations, or statements about what you can do.',
      'Preserve evidence markers such as [S1] when making paper-grounded claims.'
    ].join('\n')
  });
  let markdown = result.text.trim();
  if (!markdown) {
    throw new Error('Note Writer returned an empty draft. No proposal was created.');
  }
  if (evidence.sources.length > 0 && citedEvidenceSources(markdown, evidence.sources).length === 0) {
    const revised = await generateText({
      abortSignal,
      ...generationSettings(settings),
      model: createNeuinkModel(settings),
      system: [
        'Return only the revised Markdown note.',
        'Use only the supplied evidence and preserve the draft structure.',
        'Add valid [Sx] citations to every paper-grounded claim.'
      ].join('\n'),
      prompt: `Draft note:\n${markdown}\n\nEvidence:\n${evidence.text}`
    });
    const revisedMarkdown = revised.text.trim();
    if (revisedMarkdown && citedEvidenceSources(revisedMarkdown, evidence.sources).length > 0) {
      markdown = revisedMarkdown;
    }
  }
  markdown = removeInvalidEvidenceMarkers(markdown, evidence.sources.length);

  const citedSources = citedEvidenceSources(markdown, evidence.sources);
  const citationMissing = evidence.sources.length > 0 && citedSources.length === 0;

  return {
    answer: citationMissing
      ? '已生成笔记草稿，但本次内容未能自动匹配可靠来源引用，请确认后再写入。'
      : '已生成独立的笔记草稿，请在下方确认后再写入。',
    proposal: buildDraftProposal({
      contextSnapshot,
      currentEntry,
      currentNote: targetNote.note,
      evidenceSources: evidence.sources,
      markdown,
      operation,
      plan,
      scope,
      beforeMarkdown: targetNote.markdown
    }),
    sources: citedSources.map((item) => item.source)
  };
}

async function collectNoteEvidence({
  assistantContext,
  contextSnapshot,
  plan,
  root,
  seedEvidence,
  settings
}: {
  assistantContext?: AssistantContext | null;
  contextSnapshot: AssistantContextSnapshot;
  plan: AssistantTaskPlan;
  root: string;
  seedEvidence: ConversationSourceLink[];
  settings: LlmProfile;
}) {
  const sections: string[] = [];
  const sources: ConversationSourceLink[] = [];
  const seen = new Set<string>();

  for (const source of seedEvidence) {
    const key = `segment:${source.entry_id}:${source.segment_uid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const marker = sources.length + 1;
    sources.push(source);
    sections.push(
      `[S${marker}] ${source.entry_title}, p.${source.page_idx + 1}\n${source.quote}`
    );
  }

  for (const segment of plan.needsDocumentContext ? contextSnapshot.pinned_segments : []) {
    const key = `segment:${segment.entry_id}:${segment.segment_uid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const marker = sources.length + 1;
    sources.push({
      entry_id: segment.entry_id,
      entry_title: segment.entry_title,
      page_idx: segment.page_idx,
      quote: compact(segment.text, 320),
      segment_uid: segment.segment_uid
    });
    sections.push(`[S${marker}] ${segment.entry_title}, p.${segment.page_idx + 1}\n${segment.text}`);
  }

  const items = assistantContext?.items ?? [];
  for (const item of items) {
    const plannedItem = plan.attachments.find(
      (attachment) => attachment.attachmentId === item.id
    );
    if (plannedItem?.role === 'edit_target') continue;
    if (item.kind === 'segment') continue;
    if (item.contentKind === 'note' && item.contentId) {
      const key = `note:${item.entryId}:${item.contentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const note = await readNote(root, item.entryId, item.contentId);
      let markdown = note.markdown;
      for (const link of note.links) {
        const source = link.sources[0];
        const anchor = `[^${link.anchor_id}]`;
        if (!source || !markdown.includes(anchor)) continue;
        const marker = sources.length + 1;
        sources.push({
          entry_id: source.entry_id,
          entry_title: source.entry_id,
          page_idx: Math.max(0, source.page - 1),
          quote: source.snapshot_text,
          segment_uid: source.segment_uid
        });
        markdown = markdown.split(anchor).join(`[S${marker}]`);
      }
      sections.push(`Selected Markdown note: ${note.title}\n${markdown}`);
      continue;
    }
    // Overall and PDF currently resolve to the same parsed document. Keep the first
    // explicit selection so repeated views of one Entry do not consume context twice.
    if (!plan.needsDocumentContext) continue;
    const key = `document:${item.entryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const document = await readEntryAssistantContext({ root, entryId: item.entryId });
    const markerOffset = sources.length;
    const markdown = offsetMarkers(document.markdown, markerOffset);
    const selectedKind = item.contentKind && item.contentKind !== 'entry'
      ? item.contentTitle ?? item.contentKind
      : 'Overall';
    sections.push(`Selected paper (${selectedKind}): ${document.entry_title}\n${markdown}`);
    sources.push(...document.sources);
  }

  for (const attachment of plan.attachments) {
    if (
      attachment.role === 'edit_target' ||
      attachment.kind === 'segment' ||
      items.some((item) => item.id === attachment.attachmentId)
    ) {
      continue;
    }
    if (attachment.kind === 'note' && attachment.contentId) {
      const key = `note:${attachment.entryId}:${attachment.contentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const note = await readNote(root, attachment.entryId, attachment.contentId);
      let markdown = note.markdown;
      for (const link of note.links) {
        const source = link.sources[0];
        const anchor = `[^${link.anchor_id}]`;
        if (!source || !markdown.includes(anchor)) continue;
        const marker = sources.length + 1;
        sources.push({
          entry_id: source.entry_id,
          entry_title: attachment.entryTitle,
          page_idx: Math.max(0, source.page - 1),
          quote: source.snapshot_text,
          segment_uid: source.segment_uid
        });
        markdown = markdown.split(anchor).join(`[S${marker}]`);
      }
      sections.push(`Retained Markdown source: ${note.title}\n${markdown}`);
      continue;
    }
    if (!plan.needsDocumentContext) continue;
    const key = `document:${attachment.entryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const document = await readEntryAssistantContext({ root, entryId: attachment.entryId });
    const markerOffset = sources.length;
    sections.push(
      `Retained paper source: ${document.entry_title}\n${offsetMarkers(document.markdown, markerOffset)}`
    );
    sources.push(...document.sources);
  }

  if (sections.length === 0 && plan.needsDocumentContext && contextSnapshot.document) {
    const markerOffset = sources.length;
    sections.push(
      `Current paper: ${contextSnapshot.document.entry_title}\n${offsetMarkers(
        contextSnapshot.document.markdown,
        markerOffset
      )}`
    );
    sources.push(...contextSnapshot.document.sources);
  }

  const budget = assistantContextCharBudget(settings.max_context_length);
  return {
    sources,
    text: compact(sections.join('\n\n---\n\n'), budget)
  };
}

function noteDraftPrompt({
  conversationContext,
  currentNoteMarkdown,
  evidence,
  operation,
  question
}: {
  conversationContext: string;
  currentNoteMarkdown: string;
  evidence: string;
  operation: 'append' | 'create' | 'delete' | 'patch' | 'prepend' | 'replace';
  question: string;
}) {
  const instruction =
    operation === 'append'
      ? 'Write only the new Markdown to append; do not repeat the existing note.'
      : operation === 'prepend'
        ? 'Write only the new Markdown to prepend; do not repeat the existing note.'
      : operation === 'patch'
        ? 'Return the complete revised Markdown note with the requested improvements applied.'
        : operation === 'delete'
          ? 'Return the complete revised Markdown note with only the requested content removed. Preserve all other content exactly.'
        : 'Return the complete Markdown body for the note.';
  return [
    `User writing request:\n${question}`,
    `Recent conversation:\n${conversationContext || 'No earlier conversation.'}`,
    `Operation: ${operation}`,
    instruction,
    currentNoteMarkdown ? `Existing note:\n${currentNoteMarkdown}` : 'Existing note: none',
    `Evidence:\n${evidence || 'No paper evidence was selected.'}`
  ].join('\n\n');
}

function recentConversation(history: ConversationMessage[]) {
  return history.slice(-6)
    .map((message) => `${message.role}: ${compact(message.content, 800)}`)
    .join('\n');
}

function removeInvalidEvidenceMarkers(markdown: string, sourceCount: number) {
  return markdown.replace(/\[S(\d+)]/g, (marker, value: string) => {
    const index = Number(value);
    return index > 0 && index <= sourceCount ? marker : '';
  });
}

function normalizedOperation(
  plan: AssistantTaskPlan,
  snapshot: AssistantContextSnapshot
): 'append' | 'create' | 'delete' | 'patch' | 'prepend' | 'replace' {
  if (plan.target.kind === 'segment_note') return plan.noteAction ?? 'append';
  if (plan.noteAction) return plan.noteAction;
  return snapshot.active_note ? 'append' : 'create';
}

function offsetMarkers(markdown: string, offset: number) {
  return markdown.replace(/\[S(\d+)]/g, (_, value: string) => `[S${offset + Number(value)}]`);
}

function compact(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n\n[Truncated]`;
}
