import type { ReactNode } from 'react';
import { BookOpen, Eye, EyeOff, RotateCcw, Trash2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipIconButton } from '@/shared/components/TooltipIconButton';
import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from '@/components/ui/context-menu';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useSourceLocalCopyButtonItems, SourceLocalCopyMenuItems } from '@/modules/import/SourceLocalCopyProvider';
import { PdfParseButton, type PdfParseAction } from '@/modules/library/components/PdfParseButton';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import type { LibraryPaperActions } from './LibraryPaperContextMenu';

export const libraryPaperMenuClassName = 'w-56 [&_[role=menuitem]]:min-h-8 [&_[role=menuitem]]:gap-2 [&_[role=menuitem]]:px-2 [&_[role=menuitem]]:py-1.5';

type ActionMode = 'context' | 'dropdown' | 'inline' | 'panel';

/** Inline controls and context menus share availability and source-only actions. */
export function LibraryPaperMenuItems({ entry, mode, reparseDisabled, deleteDisabled, onOpen, onRead, onReparse, onDelete, externalEntryIds, sourceHiddenByEntry, onToggleSourceHidden, onSelect, pdfParseAction, renderInlineActions }: LibraryPaperActions & { entry: LibraryEntry; mode: ActionMode; pdfParseAction?: PdfParseAction; renderInlineActions?: (items: (mode: 'inline' | 'panel') => ReactNode[]) => ReactNode }) {
  const Label = mode === 'context' ? ContextMenuLabel : DropdownMenuLabel;
  const Separator = mode === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;
  const inline = mode === 'inline' || mode === 'panel';
  const external = externalEntryIds?.has(entry.id) || Boolean(entry.sourceInfo?.kinds.length);
  const hidden = sourceHiddenByEntry?.[entry.id];
  const select = () => { if (inline) onSelect?.(entry.id); };
  // The existing parse button already owns failure retries and submission state.
  const showReparse = entry.status === 'Parsed' || entry.status === 'Failed' && (!inline || !pdfParseAction || !entry.pdfFileName);
  const sourceButtons = useSourceLocalCopyButtonItems(entry, select);
  if (inline) {
    const items = (actionMode: 'inline' | 'panel'): ReactNode[] => [
      ...(onRead ? [<PaperAction key="read" mode={actionMode} label="开始阅读" icon={BookOpen} onActivate={() => onRead(entry.id)} />] : []),
      <PaperAction key="details" mode={actionMode} label="查看详情" icon={Eye} onActivate={() => onOpen(entry.id)} />,
      ...(pdfParseAction && entry.pdfFileName && entry.status !== 'Parsed' ? [<PdfParseButton key="parse" entry={entry} action={pdfParseAction} iconOnly={actionMode === 'inline'} panel={actionMode === 'panel'} />] : []),
      ...(showReparse ? [<PaperAction key="reparse" mode={actionMode} label="重新解析" icon={RotateCcw} disabled={reparseDisabled} onActivate={() => { select(); onReparse(entry); }} />] : []),
      ...(external ? [...sourceButtons(actionMode === 'inline', actionMode === 'panel'),
        <PaperAction key="hide" mode={actionMode} label={hidden ? '恢复显示' : '从条目库隐藏'} icon={hidden ? Eye : EyeOff} disabled={!onToggleSourceHidden} onActivate={() => { select(); onToggleSourceHidden?.(entry); }} />]
        : [<PaperAction key="delete" mode={actionMode} label="移到回收站" icon={Trash2} disabled={deleteDisabled} destructive onActivate={() => { select(); onDelete(entry); }} />]),
    ];
    return <>{renderInlineActions ? renderInlineActions(items) : items(mode === 'panel' ? 'panel' : 'inline')}</>;
  }
  return <>
    {!inline && <><Label className="truncate px-2 py-1.5" title={entry.title}>{entry.title}</Label><Separator /></>}
    {onRead && <PaperAction mode={mode} label="开始阅读" icon={BookOpen} onActivate={() => onRead(entry.id)} />}
    <PaperAction mode={mode} label="查看详情" icon={Eye} onActivate={() => onOpen(entry.id)} />

    {showReparse && <PaperAction mode={mode} label="重新解析" icon={RotateCcw} disabled={reparseDisabled} onActivate={() => { select(); onReparse(entry); }} />}
    {!inline && <Separator />}
    {external ? <>
      <SourceLocalCopyMenuItems entry={entry} mode={mode} />
      <PaperAction mode={mode} label={hidden ? '恢复显示' : '从条目库隐藏'} icon={hidden ? Eye : EyeOff} disabled={!onToggleSourceHidden}
        onActivate={() => { select(); onToggleSourceHidden?.(entry); }} />
      {!inline && <><Separator /><Label className="px-2 py-1.5 text-xs font-normal text-muted-foreground">删除原论文请前往来源端</Label></>}
    </> : <PaperAction mode={mode} label="移到回收站" icon={Trash2} disabled={deleteDisabled} destructive onActivate={() => { select(); onDelete(entry); }} />}
  </>;
}

function PaperAction({ mode, label, icon: Icon, disabled, destructive, onActivate }: {
  mode: ActionMode; label: string; icon: LucideIcon; disabled?: boolean; destructive?: boolean; onActivate: () => void;
}) {
  if (mode === 'panel') return <Button size="sm" variant="ghost" disabled={disabled} className={destructive ? 'w-full justify-start gap-2 px-2 text-destructive hover:text-destructive' : 'w-full justify-start gap-2 px-2 text-foreground'} onClick={onActivate}><Icon aria-hidden="true" className="size-4" />{label}</Button>;
  if (mode === 'inline') return <TooltipIconButton label={label} variant="ghost" disabled={disabled}
    className={destructive ? 'text-destructive hover:bg-destructive/5 hover:text-destructive' : 'text-muted-foreground hover:text-foreground'} onClick={onActivate}>
    <Icon aria-hidden="true" className="size-4" />
  </TooltipIconButton>;
  const Item = mode === 'context' ? ContextMenuItem : DropdownMenuItem;
  return <Item disabled={disabled} variant={destructive ? 'destructive' : undefined} onSelect={onActivate}><Icon aria-hidden="true" />{label}</Item>;
}
