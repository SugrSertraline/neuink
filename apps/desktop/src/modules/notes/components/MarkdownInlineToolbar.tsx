import type { Editor } from '@tiptap/core';
import {
  Bold,
  Code2,
  Eraser,
  Highlighter,
  Italic,
  Link2,
  Palette,
  Strikethrough,
  Underline,
  Unlink
} from 'lucide-react';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type MarkdownInlineToolbarProps = {
  disabled: boolean;
  editor: Editor | null;
};

type InlineTool = {
  active: boolean;
  icon: ReactNode;
  label: string;
  run: () => void;
};

const TEXT_COLORS = ['#172033', '#0f62fe', '#1192e8', '#24a148', '#da1e28'];
const BACKGROUND_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecdd3', '#e9d5ff'];

export function MarkdownInlineToolbar({ disabled, editor }: MarkdownInlineToolbarProps) {
  useEditorSelectionVersion(editor);

  const tools: InlineTool[] = [
    {
      active: editor?.isActive('bold') ?? false,
      icon: <Bold size={14} aria-hidden="true" />,
      label: '加粗',
      run: () => editor?.chain().focus().toggleBold().run()
    },
    {
      active: editor?.isActive('italic') ?? false,
      icon: <Italic size={14} aria-hidden="true" />,
      label: '斜体',
      run: () => editor?.chain().focus().toggleItalic().run()
    },
    {
      active: editor?.isActive('strike') ?? false,
      icon: <Strikethrough size={14} aria-hidden="true" />,
      label: '删除线',
      run: () => editor?.chain().focus().toggleStrike().run()
    },
    {
      active: editor?.isActive('underline') ?? false,
      icon: <Underline size={14} aria-hidden="true" />,
      label: '下划线',
      run: () => editor?.chain().focus().toggleUnderline().run()
    },
    {
      active: editor?.isActive('code') ?? false,
      icon: <Code2 size={14} aria-hidden="true" />,
      label: '行内代码',
      run: () => editor?.chain().focus().toggleCode().run()
    },
    {
      active: editor?.isActive('highlight') ?? false,
      icon: <Highlighter size={14} aria-hidden="true" />,
      label: '高亮',
      run: () => editor?.chain().focus().toggleHighlight({ color: BACKGROUND_COLORS[0] }).run()
    }
  ];

  const keepEditorSelection = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-md border bg-muted/30 px-2 py-1.5">
      <ToolbarGroup label="文字">
        {tools.map((tool) => (
          <Button
            className={cn(tool.active && 'bg-white text-primary shadow-sm')}
            disabled={disabled || !editor}
            key={tool.label}
            size="icon-sm"
            title={tool.label}
            type="button"
            variant="ghost"
            onMouseDown={keepEditorSelection}
            onClick={tool.run}
          >
            {tool.icon}
          </Button>
        ))}
        <Button
          disabled={disabled || !editor}
          size="icon-sm"
          title="清除格式"
          type="button"
          variant="ghost"
          onMouseDown={keepEditorSelection}
          onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          <Eraser size={14} aria-hidden="true" />
        </Button>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup label="链接">
        <Button
          className={cn(editor?.isActive('link') && 'bg-white text-primary shadow-sm')}
          disabled={disabled || !editor}
          size="icon-sm"
          title="设置链接"
          type="button"
          variant="ghost"
          onMouseDown={keepEditorSelection}
          onClick={() => setSelectionLink(editor)}
        >
          <Link2 size={14} aria-hidden="true" />
        </Button>
        <Button
          disabled={disabled || !editor || !(editor?.isActive('link') ?? false)}
          size="icon-sm"
          title="取消链接"
          type="button"
          variant="ghost"
          onMouseDown={keepEditorSelection}
          onClick={() => editor?.chain().focus().extendMarkRange('link').unsetLink().run()}
        >
          <Unlink size={14} aria-hidden="true" />
        </Button>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup label="文字颜色">
        <Palette size={13} aria-hidden="true" className="text-muted-foreground" />
        {TEXT_COLORS.map((color) => (
          <ColorButton
            color={color}
            disabled={disabled || !editor}
            key={color}
            label={`文字颜色 ${color}`}
            onMouseDown={keepEditorSelection}
            onRun={() => editor?.chain().focus().setColor(color).run()}
          />
        ))}
        <Button
          disabled={disabled || !editor}
          size="xs"
          title="清除文字颜色"
          type="button"
          variant="ghost"
          onMouseDown={keepEditorSelection}
          onClick={() => editor?.chain().focus().unsetColor().run()}
        >
          清除
        </Button>
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup label="背景颜色">
        <Highlighter size={13} aria-hidden="true" className="text-muted-foreground" />
        {BACKGROUND_COLORS.map((color) => (
          <ColorButton
            color={color}
            disabled={disabled || !editor}
            key={color}
            label={`背景颜色 ${color}`}
            onMouseDown={keepEditorSelection}
            onRun={() => editor?.chain().focus().setHighlight({ color }).run()}
          />
        ))}
        <Button
          disabled={disabled || !editor}
          size="xs"
          title="清除背景颜色"
          type="button"
          variant="ghost"
          onMouseDown={keepEditorSelection}
          onClick={() => editor?.chain().focus().unsetHighlight().run()}
        >
          清除
        </Button>
      </ToolbarGroup>
    </div>
  );
}

function ToolbarGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="hidden px-1 text-[11px] font-medium tracking-wide text-muted-foreground sm:inline">
        {label}
      </span>
      {children}
    </div>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />;
}

function ColorButton({
  color,
  disabled,
  label,
  onMouseDown,
  onRun
}: {
  color: string;
  disabled: boolean;
  label: string;
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
  onRun: () => void;
}) {
  return (
    <button
      className="size-4 rounded-full border border-white shadow-sm outline-none ring-offset-1 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      disabled={disabled}
      style={{ backgroundColor: color }}
      title={label}
      type="button"
      onMouseDown={onMouseDown}
      onClick={onRun}
    />
  );
}

function setSelectionLink(editor: Editor | null) {
  if (!editor) {
    return;
  }
  const previous = editor.getAttributes('link').href as string | undefined;
  const href = window.prompt('链接地址', previous || 'https://');
  if (href === null) {
    return;
  }
  const normalized = href.trim();
  if (!normalized) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run();
}

function useEditorSelectionVersion(editor: Editor | null) {
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!editor) {
      return undefined;
    }
    const update = () => setVersion((version) => version + 1);
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);
}
