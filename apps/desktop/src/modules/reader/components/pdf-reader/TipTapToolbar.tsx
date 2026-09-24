import type { Editor } from '@tiptap/core';
import { Code2, Heading2, List, ListOrdered, Quote } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MarkdownFormattingToolbar } from '@/modules/notes/editor/MarkdownFormattingToolbar';

export function TipTapToolbar({
  disabled,
  editor
}: {
  disabled: boolean;
  editor: Editor | null;
}) {
  const blockTools: Array<{
    active: boolean;
    icon: ReactNode;
    label: string;
    run: () => void;
  }> = [
    {
      active: editor?.isActive('heading', { level: 2 }) ?? false,
      icon: <Heading2 aria-hidden="true" />,
      label: '标题',
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run()
    },
    {
      active: editor?.isActive('bulletList') ?? false,
      icon: <List aria-hidden="true" />,
      label: '无序列表',
      run: () => editor?.chain().focus().toggleBulletList().run()
    },
    {
      active: editor?.isActive('orderedList') ?? false,
      icon: <ListOrdered aria-hidden="true" />,
      label: '有序列表',
      run: () => editor?.chain().focus().toggleOrderedList().run()
    },
    {
      active: editor?.isActive('blockquote') ?? false,
      icon: <Quote aria-hidden="true" />,
      label: '引用',
      run: () => editor?.chain().focus().toggleBlockquote().run()
    },
    {
      active: editor?.isActive('codeBlock') ?? false,
      icon: <Code2 aria-hidden="true" />,
      label: '代码块',
      run: () => editor?.chain().focus().toggleCodeBlock().run()
    }
  ];

  return (
    <div data-material="editor-toolbar" className="mb-1 flex min-w-0 items-center gap-1 overflow-x-auto bg-white">
      <div className="flex shrink-0 items-center gap-0.5 rounded-md border bg-white p-1">
        {blockTools.map((tool) => (
          <Button
            aria-pressed={Boolean(tool.active)}
            className={cn(tool.active && 'bg-accent text-primary')}
            disabled={disabled || !editor}
            key={tool.label}
            size="icon-sm"
            title={tool.label}
            type="button"
            variant="ghost"
            onMouseDown={(event) => event.preventDefault()}
            onClick={tool.run}
          >
            {tool.icon}
          </Button>
        ))}
        <Button
          disabled={disabled || !editor}
          size="icon-sm"
          title="分割线"
          type="button"
          variant="ghost"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        >
          <span className="h-px w-4 bg-current" />
        </Button>
      </div>
      <MarkdownFormattingToolbar disabled={disabled} editor={editor} />
    </div>
  );
}
