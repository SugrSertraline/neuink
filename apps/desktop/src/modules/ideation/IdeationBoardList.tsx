import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SearchInput } from '@/components/ui/search-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useIdeationContext } from './IdeationContext';
import type { IdeationBoard } from '@/shared/ipc/ideationApi';

export function IdeationBoardDialog({ board, onClose }: { board: IdeationBoard | 'new'; onClose: () => void }) {
  const context = useIdeationContext()!;
  const [title, setTitle] = useState(board === 'new' ? '' : board.title);
  const [description, setDescription] = useState(board === 'new' ? '' : board.description);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent layout="bounded" className="h-auto max-h-[calc(100%-2rem)] sm:max-w-[34rem]">
    <DialogHeader><DialogTitle>{board === 'new' ? '新建构思' : '编辑构思'}</DialogTitle><DialogDescription>围绕一个研究问题收集卡片、探索不同的解决路径。</DialogDescription></DialogHeader>
    <DialogBody><form id="ideation-board-form" className="space-y-6 py-2" onSubmit={event => {
      event.preventDefault(); if (!title.trim()) return;
      if (board === 'new') context.createBoard(title, description); else context.editBoard(board.id, { title: title.trim(), description });
      onClose();
    }}><label className="block space-y-2 text-sm font-medium"><span>构思名称</span><Input autoFocus required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：缺失数据下的时空预测" /></label>
      <label className="block space-y-2 text-sm font-medium"><span>研究问题或目标（可选）</span><Textarea className="min-h-32 resize-y text-sm font-normal leading-6" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} placeholder="先描述背景与待解决的问题，之后可以选择方法并获取组合建议。" /></label>
    </form></DialogBody><DialogFooter><Button variant="outline" onClick={onClose}>取消</Button><Button form="ideation-board-form" type="submit" disabled={!title.trim()}>{board === 'new' ? '创建构思' : '保存名称与说明'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function IdeationBoardList() {
  const context = useIdeationContext()!;
  const [query, setQuery] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [editing, setEditing] = useState<IdeationBoard | 'new' | null>(null);
  const all = context.collection?.boards ?? [];
  const boards = all.filter(board => Boolean(board.deleted_at) === deleted && `${board.title} ${board.description}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return <div className="flex h-full min-h-0 flex-col">
    <div className="shrink-0 space-y-2 border-b p-3">
      <SearchInput label="搜索构思" placeholder="搜索构思名称或问题" value={query} onValueChange={setQuery} />
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{deleted ? '已删除' : '全部构思'} · {boards.length}</span><Button size="sm" variant="ghost" onClick={() => setDeleted(!deleted)}>{deleted ? '返回构思' : `已删除 (${all.filter(board => board.deleted_at).length})`}</Button></div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="构思列表">
      {!context.collection ? <p className="p-2 text-xs" role={context.error ? 'alert' : 'status'}>{context.error ?? '正在读取构思…'}{context.error && <Button size="sm" onClick={context.retryLoad}>重新读取</Button>}</p> : !boards.length ? <p className="p-2 text-xs text-muted-foreground">{query ? '没有匹配的构思，试试其他关键词。' : deleted ? '没有已删除的构思。' : '创建第一条构思，再从论文中挑选卡片。'}</p> : boards.map(board => {
        const nodes = context.collection!.placements.filter(p => p.board_id === board.id);
        const ids = new Set(nodes.map(p => p.id));
        const relations = context.collection!.links?.filter(link => ids.has(link.from)).length ?? 0;
        return <div key={board.id} className={`mb-1 flex items-start gap-1 rounded-md border p-2 ${context.activeBoard?.id === board.id && !deleted ? 'border-primary/30 bg-primary/10' : 'border-transparent hover:bg-muted/60'}`}>
          <button disabled={deleted} onClick={() => context.selectBoard(board.id)} aria-current={context.activeBoard?.id === board.id ? 'page' : undefined} className="min-w-0 flex-1 space-y-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            <span className="line-clamp-2 text-sm font-medium">{board.title}</span>{board.description && <span className="line-clamp-2 text-xs text-muted-foreground">{board.description}</span>}
            <span className="block text-xs text-muted-foreground">{nodes.filter(n => !n.card_id.includes('-worksheet-')).length} 张已选卡片</span>
          </button>
          {deleted ? <Button size="sm" variant="outline" onClick={() => context.editBoard(board.id, { deleted_at: null })}>恢复</Button> : <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={`管理构思 ${board.title}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(board)}>编辑名称与说明</DropdownMenuItem><DropdownMenuItem onSelect={() => context.duplicateBoard(board.id)}>复制构思</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => context.editBoard(board.id, { deleted_at: new Date().toISOString() })}>移到已删除</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>}
        </div>;
      })}
    </div><p className="shrink-0 border-t p-3 text-xs leading-relaxed text-muted-foreground">每条构思独立保存问题、已选方法和组合方案。方法卡片可以重复用于不同构思。</p>
    {editing && <IdeationBoardDialog board={editing} onClose={() => setEditing(null)} />}
  </div>;
}
