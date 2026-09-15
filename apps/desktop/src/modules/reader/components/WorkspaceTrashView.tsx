import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagArchiveList } from '@/modules/library/components/TagArchiveList';
import type { TagMeta, TrashItem } from '@/shared/types/domain';
import { TrashItemsView } from './TrashItemsView';
import { TagNotesList } from '@/modules/notes/components/TagNotesList';

export function WorkspaceTrashView({ root, tags, items, onRestoreTag, onPurgeEntry, onPurgeItem, onRestoreEntry, onRestoreItem }: {
  root: string | null; tags: TagMeta[]; items: TrashItem[]; onRestoreTag: (id: string) => Promise<number>;
  onPurgeEntry: (id: string) => Promise<void> | void; onRestoreEntry: (id: string) => Promise<void> | void;
  onPurgeItem: (entryId: string, id: string) => Promise<void> | void; onRestoreItem: (entryId: string, id: string) => Promise<void> | void;
}) {
  const [type, setType] = useState<'all' | 'records' | 'tags' | 'tag-notes'>('all');
  const [query, setQuery] = useState('');
  return <div className="min-h-0 flex-1 overflow-y-auto p-3">
    <div role="group" aria-label="回收站类型" className="mb-3 flex flex-wrap gap-1">{([['all', '全部'], ['records', '条目与记录'], ['tag-notes', '标签笔记'], ['tags', '标签']] as const).map(([key, label]) => <Button key={key} size="xs" aria-pressed={type === key} variant={type === key ? 'secondary' : 'ghost'} onClick={() => setType(key)}>{label}</Button>)}</div>
    {type === 'all' || type === 'tags' ? <div className="mb-4"><Input aria-label="搜索已删除标签" className="mb-2 h-8 text-xs" placeholder="搜索已删除标签" value={query} onChange={(event) => setQuery(event.target.value)} /><TagArchiveList root={root} refreshKey={tags.map((tag) => tag.id).join(':')} onRestore={onRestoreTag} query={query} /></div> : null}
    <div hidden={type !== 'all' && type !== 'tag-notes'} className="mb-4"><h3 className="mb-2 text-sm font-semibold">标签笔记</h3><TagNotesList deletedOnly embedded scope="library/trash-tag-notes" /></div>
    {type === 'all' || type === 'records' ? <section aria-label="已删除条目与记录"><h3 className="mb-2 text-sm font-semibold">条目与记录</h3><TrashItemsView items={items} onPurgeEntry={onPurgeEntry} onPurgeItem={onPurgeItem} onRestoreEntry={onRestoreEntry} onRestoreItem={onRestoreItem} /></section> : null}
  </div>;
}
