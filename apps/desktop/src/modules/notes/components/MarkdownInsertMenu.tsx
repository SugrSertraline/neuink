import type { Editor } from '@tiptap/core';
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  ClipboardPaste,
  GitBranch,
  Heading2,
  Heading3,
  ImagePlus,
  Info,
  Lightbulb,
  List,
  ListOrdered,
  MessageSquareQuote,
  Pilcrow,
  PlusCircle,
  SeparatorHorizontal,
  Sigma,
  Table2,
  XCircle
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { CalloutVariant } from '../editor/CalloutBlock';
import { createDefaultDataTable } from '../editor/DataTableNode';

type MarkdownInsertMenuProps = {
  anchor: { left: number; top: number } | null;
  disabled: boolean;
  editor: Editor | null;
  imageBusy?: boolean;
  imageDisabled?: boolean;
  insertAt: number | null;
  contextMenu?: boolean;
  onClose: () => void;
  onInsertImage: () => void;
  onPaste?: () => void;
  shouldDeleteTrigger?: boolean;
};

type InsertCommand = {
  disabled?: boolean;
  icon: ReactNode;
  keepOpen?: boolean;
  keywords: string;
  label: string;
  run: () => void;
};

const calloutOptions: Array<{
  icon: typeof Info;
  label: string;
  title: string;
  variant: CalloutVariant;
}> = [
  { variant: 'info', label: '信息提示', title: '关键背景', icon: Info },
  { variant: 'warning', label: '警告提示', title: '注意事项', icon: AlertTriangle },
  { variant: 'success', label: '结论提示', title: '已验证结论', icon: CheckCircle2 },
  { variant: 'error', label: '问题提示', title: '当前阻塞', icon: XCircle },
  { variant: 'tip', label: '建议提示', title: '实践建议', icon: Lightbulb }
];

export function MarkdownInsertMenu({
  anchor,
  disabled,
  editor,
  imageBusy = false,
  imageDisabled = false,
  insertAt,
  contextMenu = false,
  onClose,
  onInsertImage,
  onPaste,
  shouldDeleteTrigger = false
}: MarkdownInsertMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [customCols, setCustomCols] = useState(3);
  const [customRows, setCustomRows] = useState(3);
  const [customTableOpen, setCustomTableOpen] = useState(false);
  const [componentSubmenuOpen, setComponentSubmenuOpen] = useState(false);

  useEffect(() => {
    if (!anchor) {
      return undefined;
    }

    const closeFromPointer = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) {
        return;
      }
      onClose();
    };

    window.addEventListener('pointerdown', closeFromPointer);
    return () => window.removeEventListener('pointerdown', closeFromPointer);
  }, [anchor, onClose]);

  useEffect(() => {
    if (!anchor) {
      setCustomTableOpen(false);
      setComponentSubmenuOpen(false);
    }
  }, [anchor]);

  if (!anchor) {
    return null;
  }

  const runCommand = (command: InsertCommand) => {
    command.run();
    if (!command.keepOpen) {
      onClose();
    }
  };

  const insertCustomTable = () => {
    insertTableWithTrailingParagraph(
      editor,
      insertAt,
      shouldDeleteTrigger,
      customRows,
      customCols
    );
    onClose();
  };

  const structureCommands: InsertCommand[] = [
    {
      icon: <Pilcrow size={14} aria-hidden="true" />,
      keywords: 'paragraph text body 正文',
      label: '正文',
      run: () => commandAt(editor, insertAt, shouldDeleteTrigger)?.setParagraph().run()
    },
    {
      icon: <Heading2 size={14} aria-hidden="true" />,
      keywords: 'heading h2 title 二级标题 标题',
      label: '二级标题',
      run: () => commandAt(editor, insertAt, shouldDeleteTrigger)?.toggleHeading({ level: 2 }).run()
    },
    {
      icon: <Heading3 size={14} aria-hidden="true" />,
      keywords: 'heading h3 title 三级标题 标题',
      label: '三级标题',
      run: () => commandAt(editor, insertAt, shouldDeleteTrigger)?.toggleHeading({ level: 3 }).run()
    },
    {
      icon: <MessageSquareQuote size={14} aria-hidden="true" />,
      keywords: 'quote blockquote 引用',
      label: '引用',
      run: () => commandAt(editor, insertAt, shouldDeleteTrigger)?.toggleBlockquote().run()
    },
    {
      icon: <Braces size={14} aria-hidden="true" />,
      keywords: 'code block 代码 代码块',
      label: '代码块',
      run: () => commandAt(editor, insertAt, shouldDeleteTrigger)?.toggleCodeBlock().run()
    },
    {
      icon: <SeparatorHorizontal size={14} aria-hidden="true" />,
      keywords: 'divider rule hr 分割线',
      label: '分割线',
      run: () => commandAt(editor, insertAt, shouldDeleteTrigger)?.setHorizontalRule().run()
    }
  ];

  const listCommands: InsertCommand[] = [
    {
      icon: <List size={14} aria-hidden="true" />,
      keywords: 'bullet list ul 无序列表 列表',
      label: '无序列表',
      run: () => commandAt(editor, insertAt, shouldDeleteTrigger)?.toggleBulletList().run()
    },
    {
      icon: <ListOrdered size={14} aria-hidden="true" />,
      keywords: 'ordered list ol 有序列表 编号',
      label: '有序列表',
      run: () => commandAt(editor, insertAt, shouldDeleteTrigger)?.toggleOrderedList().run()
    },
    {
      icon: <CheckSquare size={14} aria-hidden="true" />,
      keywords: 'task todo checkbox 任务 待办',
      label: '任务列表',
      run: () => commandAt(editor, insertAt, shouldDeleteTrigger)?.toggleTaskList().run()
    }
  ];

  const contentCommands: InsertCommand[] = [
    {
      icon: <Sigma size={14} aria-hidden="true" />,
      keywords: 'inline math latex formula 行内公式 数学',
      label: '行内公式',
      run: () => insertInlineMath(editor, insertAt, shouldDeleteTrigger)
    },
    {
      icon: <Sigma size={14} aria-hidden="true" />,
      keywords: 'block display math latex formula $$ 行间公式 数学',
      label: '行间公式',
      run: () => insertBlockMath(editor, insertAt, shouldDeleteTrigger)
    },
    {
      icon: <GitBranch size={14} aria-hidden="true" />,
      keywords: 'mermaid diagram graph flowchart diagram 图表 流程图 架构图',
      label: 'Mermaid 图',
      run: () => insertMermaidDiagram(editor, insertAt, shouldDeleteTrigger)
    },
    {
      disabled: imageBusy || imageDisabled,
      icon: <ImagePlus size={14} aria-hidden="true" />,
      keywords: 'image picture media 图片',
      label: imageBusy ? '图片导入中' : '图片',
      run: () => {
        if (shouldDeleteTrigger) {
          removeInsertTrigger(editor, insertAt);
        }
        onInsertImage();
      }
    },
    ...calloutOptions.map((item) => ({
      icon: <item.icon size={14} aria-hidden="true" />,
      keywords: `callout note ${item.variant} 提示 ${item.label}`,
      label: item.label,
      run: () => insertCalloutBlock(editor, insertAt, shouldDeleteTrigger, item.variant)
    }))
  ];

  const dataCommands: InsertCommand[] = [
    {
      icon: <Table2 size={14} aria-hidden="true" />,
      keepOpen: true,
      keywords: 'custom table rows columns 自定义 表格 行 列',
      label: '自定义普通表格',
      run: () => setCustomTableOpen(true)
    },
    {
      icon: <Table2 size={14} aria-hidden="true" />,
      keywords: 'data table 数据表',
      label: '数据表',
      run: () => insertDataTableWithTrailingParagraph(editor, insertAt, shouldDeleteTrigger)
    }
  ];

  const componentPicker = (
    <Command className="rounded-md">
      <CommandInput autoFocus={!contextMenu} placeholder="输入组件类型..." />
      {customTableOpen ? (
        <form
          className="m-2 grid gap-2 rounded-md border bg-background p-2"
          onSubmit={(event) => {
            event.preventDefault();
            insertCustomTable();
          }}
        >
          <div className="text-xs font-medium text-foreground">自定义普通表格</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              行
              <Input
                className="h-7"
                max={20}
                min={1}
                type="number"
                value={customRows}
                onChange={(event) => setCustomRows(clampTableSize(event.currentTarget.value, 20))}
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              列
              <Input
                className="h-7"
                max={12}
                min={1}
                type="number"
                value={customCols}
                onChange={(event) => setCustomCols(clampTableSize(event.currentTarget.value, 12))}
              />
            </label>
          </div>
          <div className="flex justify-end gap-1">
            <Button
              size="xs"
              type="button"
              variant="ghost"
              onClick={() => setCustomTableOpen(false)}
            >
              取消
            </Button>
            <Button size="xs" type="submit">
              插入
            </Button>
          </div>
        </form>
      ) : null}
      <CommandList className="max-h-64 overflow-y-scroll pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:block [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
        <CommandEmpty className="py-4 text-xs text-muted-foreground">没有匹配的插入项</CommandEmpty>
        <InsertCommandGroup commands={structureCommands} disabled={disabled} heading="结构" onRun={runCommand} />
        <CommandSeparator />
        <InsertCommandGroup commands={listCommands} disabled={disabled} heading="列表" onRun={runCommand} />
        <CommandSeparator />
        <InsertCommandGroup commands={contentCommands} disabled={disabled} heading="内容" onRun={runCommand} />
        <CommandSeparator />
        <InsertCommandGroup commands={dataCommands} disabled={disabled} heading="数据" onRun={runCommand} />
      </CommandList>
      <div className="border-t px-2 py-1 text-[11px] text-muted-foreground">滚动查看更多</div>
    </Command>
  );

  const menu = contextMenu ? (
    <div
      ref={rootRef}
      className="fixed z-[var(--z-menu)] w-52 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
      style={{
        left: `clamp(8px, ${anchor.left}px, calc(100vw - 13.5rem))`,
        top: `clamp(8px, ${anchor.top}px, calc(100vh - 8rem))`,
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <button
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled || !onPaste}
        type="button"
        onClick={() => {
          onPaste?.();
          onClose();
        }}
      >
        <ClipboardPaste size={14} aria-hidden="true" />
        <span>粘贴</span>
      </button>
      <button
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
        disabled={disabled}
        type="button"
        onClick={() => setComponentSubmenuOpen((open) => !open)}
        onPointerEnter={() => setComponentSubmenuOpen(true)}
      >
        <PlusCircle size={14} aria-hidden="true" />
        <span className="min-w-0 flex-1">插入组件</span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      {componentSubmenuOpen ? (
        <div
          className="absolute top-0 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg"
          style={
            anchor.left > window.innerWidth - 500
              ? { right: 'calc(100% + 4px)' }
              : { left: 'calc(100% + 4px)' }
          }
        >
          {componentPicker}
        </div>
      ) : null}
    </div>
  ) : (
    <div
      ref={rootRef}
      className="fixed z-40 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg"
      style={{
        left: `clamp(8px, ${anchor.left}px, calc(100vw - 18.5rem))`,
        top: `clamp(8px, ${anchor.top}px, calc(100vh - 22rem))`,
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {componentPicker}
    </div>
  );

  return createPortal(menu, document.body);
}

function InsertCommandGroup({
  commands,
  disabled,
  heading,
  onRun
}: {
  commands: InsertCommand[];
  disabled: boolean;
  heading: string;
  onRun: (command: InsertCommand) => void;
}) {
  return (
    <CommandGroup heading={heading}>
      {commands.map((command) => (
        <CommandItem
          className={cn(command.disabled && 'opacity-45')}
          disabled={disabled || command.disabled}
          key={command.label}
          value={`${command.label} ${command.keywords}`}
          onSelect={() => onRun(command)}
        >
          {command.icon}
          <span className="min-w-0 flex-1 truncate">{command.label}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function commandAt(
  editor: Editor | null,
  insertAt: number | null,
  shouldDeleteTrigger: boolean
) {
  if (!editor) {
    return null;
  }
  const chain = editor.chain().focus();
  if (insertAt !== null) {
    if (shouldDeleteTrigger) {
      chain.deleteRange({ from: insertAt, to: insertAt + 1 });
    }
    chain.setTextSelection(insertAt);
  }
  return chain;
}

function removeInsertTrigger(editor: Editor | null, insertAt: number | null) {
  if (!editor || insertAt === null) {
    return;
  }
  editor.chain().focus().deleteRange({ from: insertAt, to: insertAt + 1 }).run();
}

function insertCalloutBlock(
  editor: Editor | null,
  insertAt: number | null,
  shouldDeleteTrigger: boolean,
  variant: CalloutVariant = 'info'
) {
  const config = calloutOptions.find((item) => item.variant === variant) ?? calloutOptions[0];

  commandAt(editor, insertAt, shouldDeleteTrigger)
    ?.insertContent([
      {
        type: 'calloutBlock',
        attrs: {
          title: config.title,
          variant: config.variant
        },
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '写下关键背景、证据、风险或下一步行动。'
              }
            ]
          }
        ]
      },
      {
        type: 'paragraph'
      }
    ])
    .run();
}

function insertInlineMath(
  editor: Editor | null,
  insertAt: number | null,
  shouldDeleteTrigger: boolean
) {
  commandAt(editor, insertAt, shouldDeleteTrigger)
    ?.insertContent({ type: 'inlineMath', attrs: { latex: 'x' } })
    .run();
}

function insertBlockMath(
  editor: Editor | null,
  insertAt: number | null,
  shouldDeleteTrigger: boolean
) {
  commandAt(editor, insertAt, shouldDeleteTrigger)
    ?.insertContent([
      { type: 'blockMath', attrs: { latex: 'x' } },
      { type: 'paragraph' }
    ])
    .run();
}

function insertMermaidDiagram(
  editor: Editor | null,
  insertAt: number | null,
  shouldDeleteTrigger: boolean
) {
  commandAt(editor, insertAt, shouldDeleteTrigger)
    ?.insertContent([
      {
        type: 'mermaidDiagram',
        attrs: {
          code: 'graph TD\n  A[开始] --> B[结束]'
        }
      },
      { type: 'paragraph' }
    ])
    .run();
}

function insertTableWithTrailingParagraph(
  editor: Editor | null,
  insertAt: number | null,
  shouldDeleteTrigger: boolean,
  rows = 3,
  cols = 3
) {
  commandAt(editor, insertAt, shouldDeleteTrigger)
    ?.insertContent([
      createTableContent({ cols, rows, withHeaderRow: true }),
      {
        type: 'paragraph'
      }
    ])
    .run();
}

function insertDataTableWithTrailingParagraph(
  editor: Editor | null,
  insertAt: number | null,
  shouldDeleteTrigger: boolean
) {
  commandAt(editor, insertAt, shouldDeleteTrigger)
    ?.insertContent([
      {
        type: 'dataTable',
        attrs: {
          data: createDefaultDataTable()
        }
      },
      {
        type: 'paragraph'
      }
    ])
    .run();
}

function clampTableSize(value: string, max: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(max, Math.max(1, parsed));
}

function createTableContent({
  cols,
  rows,
  values,
  withHeaderRow
}: {
  cols: number;
  rows: number;
  values?: string[][];
  withHeaderRow: boolean;
}) {
  return {
    type: 'table',
    content: Array.from({ length: rows }, (_, rowIndex) => ({
      type: 'tableRow',
      content: Array.from({ length: cols }, (_, colIndex) => {
        const text = values?.[rowIndex]?.[colIndex] ?? '';
        const cellType = withHeaderRow && rowIndex === 0 ? 'tableHeader' : 'tableCell';

        return {
          type: cellType,
          content: [
            {
              type: 'paragraph',
              content: text
                ? [
                    {
                      type: 'text',
                      text
                    }
                  ]
                : []
            }
          ]
        };
      })
    }))
  };
}
