import type { AssistantComposerMention, AssistantComposerSnapshot } from '@/shared/types/assistant';

export function serializeComposer(doc: unknown): AssistantComposerSnapshot {
  const mentions: AssistantComposerMention[] = [];
  let text = '';
  let counter = 0;

  const visit = (node: any) => {
    if (!node) {
      return;
    }
    if (node.type === 'text') {
      text += node.text ?? '';
      return;
    }
    if (node.type === 'hardBreak') {
      text += '\n';
      return;
    }
    if (node.type === 'contextMention') {
      counter += 1;
      const marker = `[C${counter}]`;
      const attrs = node.attrs ?? {};
      mentions.push({
        charOffset: text.length,
        contentId: attrs.contentId ?? null,
        contentTitle: attrs.contentTitle ?? null,
        entryId: attrs.entryId ?? '',
        entryTitle: attrs.entryTitle ?? '',
        id: attrs.id ?? marker,
        kind: attrs.kind ?? 'entry',
        label: attrs.label ?? marker,
        marker,
        pageIdx: attrs.pageIdx ?? null,
        role: attrs.role ?? null,
        segmentUid: attrs.segmentUid ?? null,
        tagId: attrs.tagId ?? null,
        tagName: attrs.tagName ?? null,
        text: attrs.text ?? null,
      });
      text += marker;
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        visit(child);
      }
      if (node.type === 'paragraph') {
        text += '\n';
      }
    }
  };

  visit(doc);
  return {
    mentions,
    text: text.replace(/\n+$/g, '')
  };
}
