import { FilePlus2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { NoteTarget } from '@/shared/types/domain';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';
import { useTagNoteActions } from '../useTagNoteActions';
import { CreateTagNoteDialog } from './CreateTagNoteDialog';

/** Keep the creation session mounted when the library switches content tabs. */
export function CreateTagNoteButton({ tagId, tagLabel, scope, disabled = false, onOpen, className }: {
  tagId: string; tagLabel?: string; scope: string; disabled?: boolean;
  onOpen?: (target: NoteTarget, title: string) => void; className?: string;
}) {
  const model = useWorkspaceNotes();
  const action = useTagNoteActions(`${scope}/create`);
  const [creating, setCreating] = useState(false);
  const label = tagLabel ?? model?.catalog.notes.find(note => note.target.owner.kind === 'tag_reading' && note.target.owner.tag_id === tagId)?.owner_title ?? '当前标签';
  return <>
    <Button aria-label="新建笔记" title="新建笔记" className={className} disabled={disabled || !action.writable} onClick={() => setCreating(true)}>
      <FilePlus2 size={14} aria-hidden="true" /><span className="@max-[700px]/library-heading:hidden">新建笔记</span>
    </Button>
    {creating ? <CreateTagNoteDialog tags={[{ id: tagId, label }]} busy={action.busy} disabled={disabled || !action.writable} error={action.error || model?.error || null}
      onClose={() => setCreating(false)} onCreate={(id, title) => action.create(id, title, (target, name) => { setCreating(false); onOpen?.(target, name); })} /> : null}
  </>;
}
