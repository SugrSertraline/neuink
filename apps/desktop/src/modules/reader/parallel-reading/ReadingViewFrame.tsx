import { useCallback, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReadingMode } from '@/shared/types/domain';
import type { TagReadingMember } from '@/shared/ipc/tagReadingApi';
import { ReadingSessionContext, type ReadingNoteBinding } from './ReadingSessionContext';
import { ReadingViewSwitch, type ReadingViewSwitchProps } from './ReadingViewSwitch';
import type { PdfJumpRequest } from '../types';

export function ReadingViewFrame({ member, role, mode, active, hidden, disabled, removed, resizing, width, viewSwitch, note, jump, onFocus, onMode, onReady, children }: {
  member: TagReadingMember; role: string; mode: ReadingMode; active: boolean; hidden: boolean;
  disabled: boolean; removed: boolean; resizing: boolean; width?: string;
  viewSwitch?: ReadingViewSwitchProps; note?: ReadingNoteBinding; jump?: PdfJumpRequest;
  onFocus: () => void; onMode: (mode: ReadingMode) => void; onReady: (entryId: string) => void; children: ReactNode;
}) {
  const ready = useCallback(() => onReady(member.entry_id), [member.entry_id, onReady]);
  return <section data-reading-frame aria-label={`${role}：${member.title}`} className={cn('h-full min-h-0 min-w-0 flex-col overflow-hidden', hidden ? 'hidden' : 'flex')}
    style={{ flex: width ? `0 0 ${width}` : '1 1 0%' }} onPointerDown={onFocus} onFocusCapture={onFocus}>
    <div className="flex h-9 min-w-0 shrink-0 items-center gap-1 border-b bg-muted px-2 py-0.5">
      {viewSwitch ? <ReadingViewSwitch {...viewSwitch} /> : <span className="shrink-0 text-xs font-medium text-muted-foreground">{role}</span>}
      <span title={member.title} className="min-w-0 flex-1 truncate text-xs">{member.title}</span>
      {member.pdf_available && member.reflow_available ? <>
        <Button size="xs" variant={mode === 'pdf' ? 'secondary' : 'ghost'} disabled={disabled} aria-label="阅读原版 PDF" title="保留论文原始版式" aria-pressed={mode === 'pdf'} onClick={() => onMode('pdf')}>PDF</Button>
        <Button size="xs" variant={mode === 'reflow' ? 'secondary' : 'ghost'} disabled={disabled} aria-label="阅读重排正文" title="阅读解析后的正文，可调整字号和背景" aria-pressed={mode === 'reflow'} onClick={() => onMode('reflow')}>重排</Button>
      </> : null}
    </div>
    {removed ? <p className="shrink-0 border-b px-2 py-1 text-xs text-muted-foreground">已移出当前标签，保留本次阅读，不计入进度。</p> : null}
    <ReadingSessionContext.Provider value={{ active: active && !hidden, resizing, onReady: ready, note, jump }}>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
    </ReadingSessionContext.Provider>
  </section>;
}
