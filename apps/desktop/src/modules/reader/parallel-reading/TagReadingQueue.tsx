import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { TagMemberStatus, TagReadingMember, TagReadingState } from '@/shared/ipc/tagReadingApi';
import { cn } from '@/lib/utils';
import { isReadableMember, orderedMembers, tagMemberLabels } from './tagReadingState';

export function TagReadingQueue({ state, members, disabled, mode = 'read', onSelect, onCompare, onStatus, onMove }: {
  state: TagReadingState; members: TagReadingMember[]; disabled: boolean;
  mode?: 'read' | 'compare';
  onSelect: (id: string) => void; onCompare: (id: string) => void;
  onStatus: (id: string, status: TagMemberStatus) => void; onMove: (id: string, delta: -1 | 1) => void;
}) {
  const [query, setQuery] = useState('');
  const queue = orderedMembers(state, members);
  const visible = queue.filter((member) => member.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="flex h-full min-h-0 min-w-0 flex-col bg-card">
    <div className="shrink-0 space-y-1.5 border-b p-2">
      <Input aria-label="搜索本标签论文" placeholder="搜索本标签论文" value={query} onChange={(event) => setQuery(event.target.value)} />
      <p className="text-xs leading-relaxed text-muted-foreground">{mode === 'compare' ? '选择一篇固定对照论文，主读论文保持不变。' : '点击标题阅读；对照论文在换篇时固定保留。'}</p>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="标签阅读队列">
      {visible.length === 0 ? <p className="p-3 text-sm text-muted-foreground">{members.length ? '没有匹配的论文' : '标签下暂无条目，可在条目库为论文添加此标签。'}</p> : null}
      <ul className="divide-y">
        {visible.map((member) => {
          const readable = isReadableMember(member);
          const current = state.active_entry_id === member.entry_id;
          const compare = state.compare_entry_id === member.entry_id;
          const index = queue.indexOf(member);
          return <li key={member.entry_id} className={cn('min-w-0 px-2 py-2', current && 'bg-accent')}>
            <Button variant="ghost" className="h-auto w-full min-w-0 justify-start whitespace-normal px-1 py-1 text-left text-xs" disabled={disabled || !readable || (mode === 'compare' && (current || compare))} onClick={() => mode === 'compare' ? onCompare(member.entry_id) : onSelect(member.entry_id)} title={member.title} aria-current={current ? 'true' : undefined}>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{member.title}</span>
            </Button>
            <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span className="mr-auto">{current ? '主读论文' : compare ? '对照论文' : member.pdf_available ? 'PDF' : readable ? '重排正文' : '暂不可读'} · {tagMemberLabels[state.member_states[member.entry_id]?.status ?? 'unread']}</span>
              {mode === 'read' ? <>
                {!current && !compare && readable ? <Button size="xs" variant="ghost" disabled={disabled} aria-label={`将“${member.title}”设为对照论文`} onClick={() => onCompare(member.entry_id)}>对照阅读</Button> : null}
                <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-xs" variant="ghost" disabled={disabled} aria-label={`“${member.title}”的阅读状态与顺序`} title="修改阅读状态或调整顺序"><MoreHorizontal size={13} aria-hidden="true" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel>阅读状态</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={state.member_states[member.entry_id]?.status ?? 'unread'} onValueChange={(value) => onStatus(member.entry_id, value as TagMemberStatus)}>
                      {Object.entries(tagMemberLabels).map(([value, label]) => <DropdownMenuRadioItem key={value} value={value} disabled={disabled || !readable}>{label}</DropdownMenuRadioItem>)}
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>阅读顺序</DropdownMenuLabel>
                    <DropdownMenuItem disabled={disabled || index === 0} onSelect={() => onMove(member.entry_id, -1)}>提前一篇</DropdownMenuItem>
                    <DropdownMenuItem disabled={disabled || index === queue.length - 1} onSelect={() => onMove(member.entry_id, 1)}>推后一篇</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </> : null}
            </div>
            {member.issue ? <p className="mt-1 break-words text-xs text-muted-foreground">{member.issue}</p> : null}
          </li>;
        })}
      </ul>
    </div>
  </div>;
}
