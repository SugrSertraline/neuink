import type { Editor } from '@tiptap/core';
import {
  Bold,
  Code2,
  Eraser,
  Highlighter,
  Italic,
  Link2,
  MoreHorizontal,
  Palette,
  Strikethrough,
  Underline,
  Unlink
} from 'lucide-react';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
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

export function MarkdownFormattingToolbar({ disabled, editor }: MarkdownInlineToolbarProps) {
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
    <div
      className="markdown-formatting-toolbar flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
      data-note-formatting-toolbar="true"
      data-material="editor-toolbar"
    >
      {tools.map((tool, index) => (
        <Button
          aria-pressed={Boolean(tool.active)}
          className={cn(
            index >= 2 && 'markdown-formatting-wide-only',
            tool.active && 'bg-accent text-primary'
          )}
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
        className={cn(
          'markdown-formatting-wide-only',
          editor?.isActive('link') && 'bg-accent text-primary'
        )}
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
        className="markdown-formatting-wide-only"
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
      <ColorMenu
        colors={TEXT_COLORS}
        disabled={disabled || !editor}
        icon={<Palette size={14} aria-hidden="true" />}
        label="文字颜色"
        triggerClassName="markdown-formatting-wide-only"
        onClear={() => editor?.chain().focus().unsetColor().run()}
        onSelect={(color) => editor?.chain().focus().setColor(color).run()}
      />
      <ColorMenu
        colors={BACKGROUND_COLORS}
        disabled={disabled || !editor}
        icon={<Highlighter size={14} aria-hidden="true" />}
        label="背景颜色"
        triggerClassName="markdown-formatting-wide-only"
        onClear={() => editor?.chain().focus().unsetHighlight().run()}
        onSelect={(color) => editor?.chain().focus().setHighlight({ color }).run()}
      />
      <Button
        className="markdown-formatting-wide-only"
        disabled={disabled || !editor}
        size="icon-sm"
        title="清除全部格式"
        type="button"
        variant="ghost"
        onMouseDown={keepEditorSelection}
        onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <Eraser size={14} aria-hidden="true" />
      </Button>
      <CompactFormattingMenu disabled={disabled} editor={editor} tools={tools.slice(2)} />
    </div>
  );
}

function CompactFormattingMenu({
  disabled,
  editor,
  tools
}: {
  disabled: boolean;
  editor: Editor | null;
  tools: InlineTool[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="更多格式"
          className="markdown-formatting-overflow"
          disabled={disabled || !editor}
          size="icon-sm"
          title="更多格式"
          type="button"
          variant="ghost"
          onMouseDown={(event) => event.preventDefault()}
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {tools.map((tool) => (
          <DropdownMenuItem key={tool.label} onSelect={tool.run}>
            {tool.icon}
            {tool.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setSelectionLink(editor)}>
          <Link2 aria-hidden="true" />设置链接
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!(editor?.isActive('link') ?? false)}
          onSelect={() => editor?.chain().focus().extendMarkRange('link').unsetLink().run()}
        >
          <Unlink aria-hidden="true" />取消链接
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette aria-hidden="true" />文字颜色
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <ColorItems
              colors={TEXT_COLORS}
              onClear={() => editor?.chain().focus().unsetColor().run()}
              onSelect={(color) => editor?.chain().focus().setColor(color).run()}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Highlighter aria-hidden="true" />背景颜色
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <ColorItems
              colors={BACKGROUND_COLORS}
              onClear={() => editor?.chain().focus().unsetHighlight().run()}
              onSelect={(color) => editor?.chain().focus().setHighlight({ color }).run()}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}>
          <Eraser aria-hidden="true" />清除全部格式
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColorMenu({
  colors,
  disabled,
  icon,
  label,
  onClear,
  onSelect,
  triggerClassName
}: {
  colors: string[];
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClear: () => void;
  onSelect: (color: string) => void;
  triggerClassName?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={triggerClassName} disabled={disabled} size="icon-sm" title={label} type="button" variant="ghost">
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <ColorItems colors={colors} onClear={onClear} onSelect={onSelect} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColorItems({
  colors,
  onClear,
  onSelect
}: {
  colors: string[];
  onClear: () => void;
  onSelect: (color: string) => void;
}) {
  return (
    <>
      {colors.map((color) => (
        <DropdownMenuItem key={color} onSelect={() => onSelect(color)}>
          <span
            aria-hidden="true"
            className="size-3.5 rounded-full border border-foreground/15"
            style={{ backgroundColor: color }}
          />
          {color.toUpperCase()}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onClear}>清除颜色</DropdownMenuItem>
    </>
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

