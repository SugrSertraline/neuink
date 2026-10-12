import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { closeHistory } from '@tiptap/pm/history';
import { useEffect, useState } from 'react';
import { AssistantMentionChip, kindLabel, type MentionAttrs } from './AssistantMentionChip';

export const ContextMention = Node.create({
  name: 'contextMention', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes() {
    return {
      contentId: { default: null }, contentKind: { default: null }, contentTitle: { default: null },
      entryId: { default: null }, entryTitle: { default: null }, id: { default: null },
      kind: { default: null }, label: { default: null }, role: { default: null }, segmentUid: { default: null },
      pageIdx: { default: null, rendered: false }, text: { default: null, rendered: false },
      tagId: { default: null }, tagName: { default: null }
    };
  },
  parseHTML() { return [{ tag: 'span[data-context-mention]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-context-mention': 'true' }),
      ['span', {}, kindLabel(HTMLAttributes.kind)], ['span', {}, HTMLAttributes.label ?? 'Context']];
  },
  renderText({ node }) { return `@${node.attrs.label ?? node.attrs.id ?? 'context'}`; },
  addNodeView() { return ReactNodeViewRenderer(ContextMentionView); }
});

function ContextMentionView({ node, editor, getPos }: NodeViewProps) {
  const attrs = node.attrs as MentionAttrs;
  const [editable, setEditable] = useState(editor.isEditable);
  useEffect(() => {
    const syncEditable = () => setEditable(editor.isEditable);
    syncEditable();
    editor.on('update', syncEditable);
    editor.on('transaction', syncEditable);
    return () => { editor.off('update', syncEditable); editor.off('transaction', syncEditable); };
  }, [editor]);
  return <NodeViewWrapper as="span" contentEditable={false} data-context-mention="true" className="inline-flex max-w-full align-baseline">
    <AssistantMentionChip mention={attrs} onRemove={editable ? () => {
        if (!editor.isEditable) return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        editor.chain().focus().command(({ tr }) => {
          closeHistory(tr);
          tr.delete(pos, pos + node.nodeSize);
          return true;
        }).run();
      } : undefined} />
  </NodeViewWrapper>;
}
