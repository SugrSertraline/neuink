import { Plus, Tags } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TabsContent } from '@/components/ui/tabs';
import type { TagMeta } from '@/shared/types/domain';

import { DeleteTagDialog } from './DeleteTagDialog';
import { TagEditorNode } from './TagEditorNode';
import {
  buildTagTree,
  flattenTagTree,
  type TagCountEntry,
  type TagNode
} from '../utils/tagTree';

type TagEditorPageProps = {
  activeTag: string | null;
  entries: TagCountEntry[];
  tags: TagMeta[];
  onCreateTagPath: (path: string) => Promise<void> | void;
  onDeleteTag: (tagId: string) => Promise<void> | void;
  onRenameTag: (tagId: string, name: string) => Promise<void> | void;
  onSelectTag: (tag: string | null) => void;
};

export function TagEditorPage({
  activeTag,
  entries,
  tags,
  onCreateTagPath,
  onDeleteTag,
  onRenameTag,
  onSelectTag,
  standalone = false,
}: TagEditorPageProps & { standalone?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TagNode | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [creatingChildForId, setCreatingChildForId] = useState<string | null>(null);
  const [childName, setChildName] = useState('');
  const [error, setError] = useState('');
  const [newTagPath, setNewTagPath] = useState('');
  const tagTree = useMemo(() => buildTagTree(tags, entries), [entries, tags]);
  const flatTags = useMemo(() => flattenTagTree(tagTree), [tagTree]);

  const createTag = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newTagPath.trim() || busy) {
      return;
    }
    await runBusy(setBusy, setError, async () => {
      await onCreateTagPath(newTagPath);
      setNewTagPath('');
    });
  };

  const startCreateChild = (node: TagNode) => {
    setEditingId(null);
    setEditingName('');
    setCreatingChildForId(node.id);
    setChildName('');
  };

  const createChild = async (node: TagNode) => {
    if (!childName.trim() || busy) {
      return;
    }
    await runBusy(setBusy, setError, async () => {
      await onCreateTagPath(`${node.path}/${childName.trim()}`);
      setCreatingChildForId(null);
      setChildName('');
    });
  };

  const saveRename = async (node: TagNode) => {
    if (!editingName.trim() || busy) {
      return;
    }
    await runBusy(setBusy, setError, async () => {
      await onRenameTag(node.id, editingName);
      setEditingId(null);
      setEditingName('');
    });
  };

  const confirmDelete = async () => {
    if (!deleteTarget || busy) {
      return;
    }
    await runBusy(setBusy, setError, async () => {
      await onDeleteTag(deleteTarget.id);
      setDeleteTarget(null);
      if (editingId === deleteTarget.id) {
        setEditingId(null);
        setEditingName('');
      }
      if (creatingChildForId === deleteTarget.id) {
        setCreatingChildForId(null);
        setChildName('');
      }
    });
  };

  const content = (
      <div className="mx-auto grid max-w-5xl gap-3 p-4">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Tags size={17} aria-hidden="true" />
              标签树编辑
            </CardTitle>
            <CardDescription>管理当前工作区的标签层级</CardDescription>
            <CardAction>
              <Badge variant="secondary">{flatTags.length} 个标签</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <form className="grid grid-cols-[minmax(0,1fr)_auto] gap-2" onSubmit={(event) => void createTag(event)}>
              <Input
                disabled={busy}
                placeholder="新标签路径，例如：研究/计算机视觉/检测"
                value={newTagPath}
                onChange={(event) => setNewTagPath(event.target.value)}
              />
              <Button disabled={busy || !newTagPath.trim()} type="submit">
                <Plus size={14} aria-hidden="true" />
                添加
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="py-0">
          <ScrollArea className="h-[min(560px,calc(100vh-260px))]">
            <div className="grid gap-1 p-2">
              {tagTree.length === 0 ? (
                <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">
                  暂无标签
                </div>
              ) : null}
              {tagTree.map((node) => (
                <TagEditorNode
                  activeTag={activeTag}
                  busy={busy}
                  childName={childName}
                  creatingChildForId={creatingChildForId}
                  editingId={editingId}
                  editingName={editingName}
                  key={node.id}
                  node={node}
                  onCreateChild={(target) => void createChild(target)}
                  onDeleteRequest={setDeleteTarget}
                  onEdit={(target) => {
                    setCreatingChildForId(null);
                    setChildName('');
                    setEditingId(target.id);
                    setEditingName(target.name);
                  }}
                  onRename={(target) => void saveRename(target)}
                  onSelectTag={onSelectTag}
                  onSetChildName={setChildName}
                  onSetEditingName={setEditingName}
                  onStartCreateChild={startCreateChild}
                  onStopCreateChild={() => {
                    setCreatingChildForId(null);
                    setChildName('');
                  }}
                  onStopEdit={() => {
                    setEditingId(null);
                    setEditingName('');
                  }}
                />
              ))}
            </div>
          </ScrollArea>
        </Card>

        {error ? (
          <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <DeleteTagDialog
          busy={busy}
          target={deleteTarget}
          onConfirm={() => void confirmDelete()}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteTarget(null);
            }
          }}
        />
      </div>
  );
  return standalone ? <div className="h-full min-h-0 overflow-auto">{content}</div> : <TabsContent className="m-0" value="tag-editor">{content}</TabsContent>;
}

async function runBusy(
  setBusy: (busy: boolean) => void,
  setError: (message: string) => void,
  action: () => Promise<void>
) {
  try {
    setBusy(true);
    setError('');
    await action();
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught));
  } finally {
    setBusy(false);
  }
}
