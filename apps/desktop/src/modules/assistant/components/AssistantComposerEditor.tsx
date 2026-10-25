import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { FileText, TextQuote } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AssistantComposerTargetPicker } from './AssistantComposerTargetPicker';
import { usePdfBlockComposerDrop } from './usePdfBlockComposerDrop';
import { ContextMention } from './AssistantContextMention';
import { mentionContextInput } from './AssistantMentionChip';
import { serializeComposer } from './assistantComposerDocument';
import { buildComposerTargets, filterMentionTargets, targetContextItemId, targetDescription, targetLabel, targetPickerItem, targetToMention, type ComposerTarget } from './assistantComposerTargets';

import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { TagMeta } from '@/shared/types/domain';
import type {
  AssistantComposerSnapshot,
  AssistantContextInput,
  AssistantContextItem
} from '@/shared/types/assistant';

type SuggestionRange = {
  from: number;
  query: string;
  to: number;
};

type AssistantComposerEditorProps = {
  actions?: ReactNode;
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
  workspaceRoot?: string | null;
};

export type AssistantComposerDraft = {
  document: JSONContent;
  snapshot: AssistantComposerSnapshot;
};

export function AssistantComposerEditor({
  actions,
  composerDraft,
  disabled,
  draftQuestion,
  entries,
  tags,
  onChange,
  onDraftQuestionConsumed,
  onSubmit,
  resetKey,
  workspaceRoot = null
}: AssistantComposerEditorProps) {
  const lastResetKeyRef = useRef(resetKey);
  const suggestionListId = useId();
  const suggestionListRef = useRef<HTMLDivElement>(null);
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  const [suggestionRange, setSuggestionRange] = useState<SuggestionRange | null>(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestionKey = suggestionRange ? `${suggestionRange.from}:${suggestionRange.to}:${suggestionRange.query}` : null;
  const showSuggestions = suggestionKey !== null && dismissedSuggestion !== suggestionKey && !disabled;
  const targets = useMemo(() => buildComposerTargets(entries, tags), [entries, tags]);
  const matchedTargets = useMemo(() => suggestionRange ? filterMentionTargets(targets, suggestionRange.query) : [], [suggestionRange, targets]);
  const filteredTargets = useMemo(() => matchedTargets.slice(0, 50), [matchedTargets]);
  const pickerItems = useMemo(() => targets.map(targetPickerItem), [targets]);

  const editor = useEditor({
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': '输入问题',
        'aria-multiline': 'true',
        'aria-disabled': String(disabled),
        'aria-haspopup': 'listbox',
        'aria-expanded': String(showSuggestions),
        ...(showSuggestions ? { 'aria-controls': suggestionListId,
          'aria-activedescendant': filteredTargets.length ? `${suggestionListId}-${activeIndex}` : '' } : {}),
        class:
          'min-h-20 max-h-[min(12rem,35vh)] w-full cursor-text overflow-y-auto overscroll-contain text-sm leading-6 outline-none prose-p:m-0'
      },
      handleKeyDown: (_view, event) => {
        if (showSuggestions) {
          if (event.key === 'ArrowDown') {
            if (!filteredTargets.length) return false;
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % filteredTargets.length);
            return true;
          }
          if (event.key === 'ArrowUp') {
            if (!filteredTargets.length) return false;
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + filteredTargets.length) % filteredTargets.length);
            return true;
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && filteredTargets.length > 0) {
            event.preventDefault();
            if (filteredTargets.length) insertTarget(filteredTargets[activeIndex] ?? filteredTargets[0]);
            return true;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDismissedSuggestion(suggestionKey);
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
          .map(mentionContextInput).filter((item): item is AssistantContextInput => item !== null),
        document
      );
      setSuggestionRange(findSuggestionRange(editor));
    },
    onSelectionUpdate: ({ editor }) => {
      setSuggestionRange(findSuggestionRange(editor));
    }
  });

  const blockDrop = usePdfBlockComposerDrop(editor, entries, workspaceRoot, disabled);
  // Use the current instance for restored drafts before its first transaction.
  const isEmpty = useEditorState({ editor, selector: () => !editor || editor.isEmpty });

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
    setDismissedSuggestion(null);
  }, [editor, resetKey]);

  useEffect(() => {
    setActiveIndex(0);
  }, [suggestionRange?.from, suggestionRange?.query, filteredTargets.length]);

  useEffect(() => {
    const list = suggestionListRef.current, option = activeOptionRef.current;
    if (!showSuggestions || !list || !option) return;
    // Keyboard navigation scrolls only the candidate list, never the conversation or reader.
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [activeIndex, filteredTargets, showSuggestions]);

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

  const insertPickedTarget = (target: ComposerTarget) => {
    if (!editor || disabled) return;
    editor.chain().focus().insertContent([
      { type: 'contextMention', attrs: targetToMention(target) },
      { type: 'text', text: ' ' }
    ]).run();
    setSuggestionRange(null);
  };

  return (
    <div ref={blockDrop.ref} data-material="composer" data-block-drop-active={blockDrop.active || undefined}
      data-disabled={disabled || undefined}
      className={`relative min-w-0 rounded-md border border-input bg-muted text-foreground transition-colors ${disabled ? 'opacity-60' : blockDrop.active ? '' : 'focus-within:border-ring focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/15'}`}>
      {blockDrop.active ? (
        <div role="status" className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 rounded-[inherit] bg-background/90 px-3 text-center backdrop-blur-[2px]">
          <div className="absolute inset-0 rounded-[inherit] bg-primary/10" aria-hidden="true" />
          <TextQuote className="relative mb-1 text-primary" size={24} aria-hidden="true" />
          <div className="relative text-sm font-medium text-foreground">松开鼠标，加入此片段</div>
          <div className="relative text-xs text-muted-foreground">作为引用附加到当前问题</div>
        </div>
      ) : null}
      <div className="min-w-0 px-3 pb-2 pt-2.5">
        <div className="relative min-w-0">
          <EditorContent editor={editor} />
          {(isEmpty ?? true) && !disabled ? (
            <div aria-hidden="true" data-composer-placeholder
              className="pointer-events-none absolute inset-x-0 top-0 text-sm leading-6 text-muted-foreground">
              输入问题，或用 @ 引用 PDF、笔记
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 rounded-b-[inherit] border-t border-input/70 bg-card/50 px-2 py-1.5">
        <AssistantComposerTargetPicker items={pickerItems} disabled={disabled} onSelect={insertPickedTarget} />
        {actions ? <div className="flex min-w-0 items-center justify-end gap-2">{actions}</div> : null}
      </div>
      {showSuggestions ? (
        <div
          className="absolute bottom-full left-2 z-50 mb-2 max-h-56 w-[min(24rem,calc(100%-1rem))] overflow-auto rounded-md border bg-popover p-1 text-xs shadow-lg"
          role="listbox"
          id={suggestionListId}
          ref={suggestionListRef}
          aria-label="匹配的 PDF 和笔记"
        >
          {filteredTargets.map((target, index) => (
            <button
              aria-selected={index === activeIndex}
              id={`${suggestionListId}-${index}`}
              className={`flex w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-muted ${
                index === activeIndex ? 'bg-muted' : ''
              }`}
              ref={index === activeIndex ? activeOptionRef : null}
              key={targetContextItemId(target)}
              role="option"
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => insertTarget(target)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <FileText className="shrink-0 text-muted-foreground" size={12} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate" title={targetLabel(target)}>{targetLabel(target)}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{targetDescription(target)}</span>
              </span>
            </button>
          ))}
          {!filteredTargets.length ? <p className="px-2 py-1 text-muted-foreground">没有匹配内容；@ 会保留为正文。</p> : null}
          {matchedTargets.length > filteredTargets.length ? <p className="px-2 py-1 text-muted-foreground">显示前 50 项，输入关键词缩小范围。</p> : null}
          <p className="border-t px-2 py-1 text-muted-foreground">↑↓ 选择，Enter 确认，Esc 保留文字。</p>
        </div>
      ) : null}
    </div>
  );
}

function findSuggestionRange(editor: NonNullable<ReturnType<typeof useEditor>>): SuggestionRange | null {
  if (editor.view.composing || !editor.state.selection.empty) {
    return null;
  }
  const { $from, from } = editor.state.selection;
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 120), $from.parentOffset, '', '\uFFFC');
  return findInlineMention(before, from);
}

/** Detect only the @ expression under the cursor; never rewrite literal editor text. */
export function findInlineMention(before: string, cursor: number): SuggestionRange | null {
  // Inline @ works after Chinese prose and punctuation. ASCII emails/URLs remain literal.
  const match = before.match(/(^|[^A-Za-z0-9._+\-])@([^@\uFFFC]*)$/u);
  if (!match || match.index === undefined) {
    return null;
  }
  const prefixLength = match[1]?.length ?? 0;
  const matchText = match[0].slice(prefixLength);
  return {
    from: cursor - matchText.length,
    query: match[2] ?? '',
    to: cursor
  };
}
