import { useEditor } from '@tiptap/react';
import {
  Bold,
  Code2,
  Highlighter,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Palette,
  Quote,
  Strikethrough,
  Underline
} from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function TipTapToolbar({
  disabled,
  editor
}: {
  disabled: boolean;
  editor: ReturnType<typeof useEditor>;
}) {
  const tools: Array<{
    active: boolean;
    icon: ReactNode;
    label: string;
    run: () => void;
  }> = [
    {
      active: editor?.isActive('heading', { level: 2 }) ?? false,
      icon: <Heading2 size={14} aria-hidden="true" />,
      label: '标题',
      run: () =>
        editor?.chain().focus().toggleHeading({ level: 2 }).run()
    },
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
      active: editor?.isActive('bulletList') ?? false,
      icon: <List size={14} aria-hidden="true" />,
      label: '无序列表',
      run: () => editor?.chain().focus().toggleBulletList().run()
    },
    {
      active: editor?.isActive('orderedList') ?? false,
      icon: <ListOrdered size={14} aria-hidden="true" />,
      label: '有序列表',
      run: () => editor?.chain().focus().toggleOrderedList().run()
    },
    {
      active: editor?.isActive('blockquote') ?? false,
      icon: <Quote size={14} aria-hidden="true" />,
      label: '引用',
      run: () => editor?.chain().focus().toggleBlockquote().run()
    },
    {
      active: editor?.isActive('codeBlock') ?? false,
      icon: <Code2 size={14} aria-hidden="true" />,
      label: '代码块',
      run: () => editor?.chain().focus().toggleCodeBlock().run()
    },
    {
      active: editor?.isActive('highlight') ?? false,
      icon: <Highlighter size={14} aria-hidden="true" />,
      label: '高亮',
      run: () =>
        editor
          ?.chain()
          .focus()
          .toggleHighlight({ color: '#fef08a' })
          .run()
    }
  ];

  const colors = [
    '#172033',
    '#0f62fe',
    '#1192e8',
    '#24a148',
    '#da1e28'
  ];

  const keepEditorSelection = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <div className="mb-1 flex flex-wrap items-center gap-0.5 rounded-md border bg-muted/25 px-1 py-0.5">
        {tools.map((tool) => (
          <Button
            className={cn(tool.active && 'bg-white text-primary shadow-sm')}
            disabled={disabled || !editor}
            key={tool.label}
            size="icon-xs"
            title={tool.label}
            type="button"
            variant="ghost"
            onClick={tool.run}
          >
            {tool.icon}
          </Button>
        ))}

        <Button
          disabled={disabled || !editor}
          size="icon-xs"
          title="分割线"
          type="button"
          variant="ghost"
          onClick={() =>
            editor?.chain().focus().setHorizontalRule().run()
          }
        >
          <span className="h-px w-4 bg-current" />
        </Button>
      <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <Palette
          size={13}
          aria-hidden="true"
          className="text-muted-foreground"
        />

        {colors.map((color) => (
          <button
            className="size-3.5 rounded-full border border-white shadow-sm outline-none ring-offset-1 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
            disabled={disabled || !editor}
            key={color}
            style={{ backgroundColor: color }}
            title={`文字颜色 ${color}`}
            type="button"
            onMouseDown={keepEditorSelection}
            onClick={() =>
              editor?.chain().focus().setColor(color).run()
            }
          />
        ))}

        <Button
          disabled={disabled || !editor}
          size="xs"
          title="清除文字颜色"
          type="button"
          variant="ghost"
          onMouseDown={keepEditorSelection}
          onClick={() =>
            editor?.chain().focus().unsetColor().run()
          }
        >
          清色
        </Button>
    </div>
  );
}
