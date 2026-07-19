import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { FileText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { TagMeta } from '@/shared/types/domain';
import type {
  AssistantComposerMention,
  AssistantComposerMentionKind,
  AssistantComposerMentionRole,
  AssistantComposerSnapshot,
  AssistantContextInput,
  AssistantContextItem
} from '@/shared/types/assistant';

type EntryContextTarget = {
  contentId?: string;
  contentKind?: 'entry' | 'note' | 'overview' | 'pdf' | 'reflow';
  contentTitle?: string;
  entry: LibraryEntry;
  kind: 'entry';
};

type SuggestionRange = {
  from: number;
  query: string;
  to: number;
};

type AssistantComposerEditorProps = {
  composerDraft: AssistantComposerDraft | null;
  contextItems?: AssistantContextItem[];
  disabled: boolean;
  draftQuestion: string | null;
  entries: LibraryEntry[];
  tags: TagMeta[];
  onChange: (
    snapshot: AssistantComposerSnapshot,
    contextItems: AssistantContextInput[],
    document: JSONContent
  ) => void;
  onDraftQuestionConsumed: () => void;
  onSubmit: () => void;
  resetKey: number;
};

type TagScopeTarget = { kind: 'tag'; tag: TagMeta };
type ComposerTarget = EntryContextTarget | TagScopeTarget;

export type AssistantComposerDraft = {
  document: JSONContent;
  snapshot: AssistantComposerSnapshot;
};

const ContextMention = Node.create({
  name: 'contextMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      contentId: { default: null },
      contentKind: { default: null },
      contentTitle: { default: null },
      entryId: { default: null },
      entryTitle: { default: null },
      id: { default: null },
      kind: { default: null },
      label: { default: null },
      role: { default: null },
      segmentUid: { default: null },
      tagId: { default: null },
      tagName: { default: null }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-context-mention]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class:
          'inline-flex max-w-[12rem] select-none items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-xs leading-5 text-primary align-baseline',
        'data-context-mention': 'true'
      }),
      ['span', { class: 'font-medium' }, HTMLAttributes.contentKindLabel ?? kindLabel(HTMLAttributes.kind)],
      ['span', { class: 'truncate' }, HTMLAttributes.label ?? 'Context']
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label ?? node.attrs.id ?? 'context'}`;
  }
});

export function AssistantComposerEditor({
  composerDraft,
  disabled,
  draftQuestion,
  entries,
  tags,
  contextItems = [],
  onChange,
  onDraftQuestionConsumed,
  onSubmit,
  resetKey
}: AssistantComposerEditorProps) {
  const lastResetKeyRef = useRef(resetKey);
  const [suggestionRange, setSuggestionRange] = useState<SuggestionRange | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const targets = useMemo(
    () => buildTargets(entries, tags, contextItems),
    [contextItems, entries, tags]
  );
  const filteredTargets = useMemo(() => {
    if (!suggestionRange) {
      return [];
    }
    const query = suggestionRange.query.trim().toLowerCase();
    return targets
      .filter((target) => {
        const haystack = targetSearchText(target).toLowerCase();
        return !query || haystack.includes(query);
      })
      .slice(0, 8);
  }, [suggestionRange, targets]);

  const editor = useEditor({
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          'min-h-24 w-full rounded-sm px-1 py-1 text-sm leading-6 outline-none prose-p:m-0'
      },
      handleKeyDown: (_view, event) => {
        if (suggestionRange && filteredTargets.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % filteredTargets.length);
            return true;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + filteredTargets.length) % filteredTargets.length);
            return true;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            insertTarget(filteredTargets[activeIndex] ?? filteredTargets[0]);
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setSuggestionRange(null);
            return true;
          }
        }

        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          onSubmit();
          return true;
        }
        return false;
      }
    },
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        listItem: false,
        orderedList: false
      }),
      ContextMention
    ],
    content: composerDraft?.document ?? '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const document = editor.getJSON();
      const snapshot = serializeComposer(document);
      onChange(
        snapshot,
        snapshot.mentions
          .filter((mention) => mention.kind !== 'tag')
          .map(mentionToContextInput),
        document
      );
      setSuggestionRange(findSuggestionRange(editor));
    },
    onSelectionUpdate: ({ editor }) => {
      setSuggestionRange(findSuggestionRange(editor));
    }
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || !draftQuestion) {
      return;
    }
    if (serializeComposer(editor.getJSON()).text.trim()) {
      onDraftQuestionConsumed();
      return;
    }
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: draftQuestion }] }] });
    onDraftQuestionConsumed();
  }, [draftQuestion, editor, onDraftQuestionConsumed]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    if (lastResetKeyRef.current === resetKey) {
      return;
    }
    lastResetKeyRef.current = resetKey;
    editor.commands.clearContent();
    setSuggestionRange(null);
  }, [editor, resetKey]);

  useEffect(() => {
    setActiveIndex(0);
  }, [suggestionRange?.from, suggestionRange?.query, filteredTargets.length]);

  const insertTarget = (target?: ComposerTarget) => {
    if (!editor || !target || !suggestionRange) {
      return;
    }
    const mention = targetToMention(target);
    editor
      .chain()
      .focus()
      .deleteRange({ from: suggestionRange.from, to: suggestionRange.to })
      .insertContent([
        {
          type: 'contextMention',
          attrs: mention
        },
        {
          type: 'text',
          text: ' '
        }
      ])
      .run();
    setSuggestionRange(null);
  };

  return (
    <div className="relative min-w-0 rounded-md border bg-background transition focus-within:ring-2 focus-within:ring-ring/30">
      <div className="min-w-0 p-2">
        <EditorContent editor={editor} />
        {!serializeComposer(editor?.getJSON() ?? { type: 'doc' }).text.trim() && !disabled ? (
          <div className="pointer-events-none absolute left-3 top-3 text-sm text-muted-foreground">
            Ask a question, or type @ to insert context inline
          </div>
        ) : null}
      </div>
      {suggestionRange && filteredTargets.length > 0 ? (
        <div
          className="absolute bottom-full left-2 z-50 mb-2 max-h-56 w-[min(24rem,calc(100%-1rem))] overflow-auto rounded-md border bg-popover p-1 text-xs shadow-lg"
          role="listbox"
        >
          {filteredTargets.map((target, index) => (
            <button
              aria-selected={index === activeIndex}
              className={`flex w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-muted ${
                index === activeIndex ? 'bg-muted' : ''
              }`}
              key={targetContextItemId(target)}
              role="option"
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                insertTarget(target);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <FileText className="shrink-0 text-muted-foreground" size={12} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {targetLabel(target)}
              </span>
              <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                {targetKindLabel(target)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildTargets(entries: LibraryEntry[], tags: TagMeta[], contextItems: AssistantContextItem[] = []) {
  void contextItems;
  return [
    ...tags.map((tag): TagScopeTarget => ({ kind: 'tag', tag })),
    ...entries.flatMap(entryContentTargets)
  ];
}

function entryContentTargets(entry: LibraryEntry): EntryContextTarget[] {
  const targets: EntryContextTarget[] = [
    {
      contentKind: 'entry',
      contentTitle: 'Overall',
      kind: 'entry',
      entry
    }
  ];
  if (entry.pdfFileName) {
    targets.push({
      contentId: 'pdf',
      contentKind: 'pdf',
      contentTitle: 'PDF',
      kind: 'entry',
      entry
    });
  }
  for (const content of entry.contents) {
    if (content.kind !== 'note') {
      continue;
    }
    targets.push({
      contentId: content.note_id,
      contentKind: 'note',
      contentTitle: content.title,
      kind: 'entry',
      entry
    });
  }
  return targets;
}

function findSuggestionRange(editor: NonNullable<ReturnType<typeof useEditor>>): SuggestionRange | null {
  if (editor.view.composing) {
    return null;
  }
  const { from } = editor.state.selection;
  const before = editor.state.doc.textBetween(Math.max(0, from - 80), from, '\n', '\uFFFC');
  const match = before.match(/(^|[\s\u3000])@([^\s@\uFFFC]*)$/u);
  if (!match || match.index === undefined) {
    return null;
  }
  const prefixLength = match[1]?.length ?? 0;
  const matchText = match[0].slice(prefixLength);
  return {
    from: from - matchText.length,
    query: match[2] ?? '',
    to: from
  };
}

function targetToMention(target: ComposerTarget) {
  if (target.kind === 'tag') {
    return {
      contentId: null,
      contentKind: null,
      contentTitle: null,
      entryId: '',
      entryTitle: '',
      id: `tag:${target.tag.id}`,
      kind: 'tag',
      label: target.tag.name,
      pageIdx: null,
      role: null,
      segmentUid: null,
      tagId: target.tag.id,
      tagName: target.tag.name,
      text: null
    };
  }
  const contentKind = target.contentKind ?? 'entry';
  const label =
    contentKind === 'entry'
      ? target.entry.title
      : `${target.entry.title} / ${target.contentTitle ?? kindLabel(contentKind)}`;
  return {
    contentId: contentKind === 'entry' ? null : target.contentId ?? contentKind,
    contentKind,
    contentTitle: contentKind === 'entry' ? null : target.contentTitle ?? kindLabel(contentKind),
    entryId: target.entry.id,
    entryTitle: target.entry.title,
    id: targetContextItemId(target),
    kind: contentKind,
    label,
    pageIdx: null,
    role: null,
    segmentUid: null,
    text: null
  };
}

function serializeComposer(doc: unknown): AssistantComposerSnapshot {
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
        text: attrs.text ?? null
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

function mentionToContextInput(mention: AssistantComposerMention): AssistantContextInput {
  if (mention.kind === 'tag') {
    throw new Error('Tag scope mentions are not document context attachments.');
  }
  if (mention.kind === 'segment') {
    return {
      entryId: mention.entryId,
      entryTitle: mention.entryTitle,
      id: mention.id,
      kind: 'segment',
      pageIdx: mention.pageIdx ?? 0,
      segmentUid: mention.segmentUid ?? '',
      text: mention.text ?? ''
    };
  }
  const contentKind =
    mention.kind === 'note' ||
    mention.kind === 'overview' ||
    mention.kind === 'pdf' ||
    mention.kind === 'reflow'
      ? mention.kind
      : undefined;
  return {
    contentId: contentKind ? mention.contentId ?? contentKind : undefined,
    contentKind,
    contentTitle: contentKind ? mention.contentTitle ?? mention.label : undefined,
    entryId: mention.entryId,
    entryTitle: mention.entryTitle,
    id: mention.id,
    kind: 'entry'
  };
}

function targetContextItemId(target: ComposerTarget) {
  if (target.kind === 'tag') return `tag:${target.tag.id}`;
  const kind = target.contentKind ?? 'entry';
  return kind === 'entry'
    ? `entry:${target.entry.id}`
    : `entry:${target.entry.id}:${kind}:${target.contentId ?? kind}`;
}

function targetLabel(target: ComposerTarget) {
  if (target.kind === 'tag') return target.tag.name;
  const contentKind = target.contentKind ?? 'entry';
  return contentKind === 'entry'
    ? target.entry.title
    : `${target.entry.title} / ${target.contentTitle ?? kindLabel(contentKind)}`;
}

function targetKindLabel(target: ComposerTarget) {
  if (target.kind === 'tag') return 'Tag scope';
  return kindLabel(target.contentKind ?? 'entry');
}

function targetSearchText(target: ComposerTarget) {
  if (target.kind === 'tag') return `${target.tag.name} tag`;
  return [
    target.entry.title,
    target.entry.tags.join(' '),
    target.contentTitle,
    target.contentKind
  ]
    .filter(Boolean)
    .join(' ');
}

function kindLabel(kind: string | null | undefined) {
  if (kind === 'tag') {
    return 'Tag';
  }
  if (kind === 'pdf') {
    return 'PDF';
  }
  if (kind === 'note') {
    return 'Note';
  }
  if (kind === 'overview') {
    return 'Overview';
  }
  if (kind === 'reflow') {
    return 'Reflow';
  }
  if (kind === 'segment') {
    return 'Segment';
  }
  return 'Overall';
}
