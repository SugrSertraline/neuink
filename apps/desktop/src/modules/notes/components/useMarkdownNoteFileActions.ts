import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import type { Editor } from '@tiptap/core';
import { useCallback, useState } from 'react';

import type { ToastContextValue } from '@/shared/hooks/useToast';
import { saveNoteMarkdownAs } from '@/shared/ipc/workspaceApi';
import { openOwnedNoteFile } from '@/shared/ipc/noteOwnerApi';
import type { NoteOwner, SourceLink } from '@/shared/types/domain';

import { getMarkdownWithSourceLinks, materializeMarkdownSourceLinks, pruneUnusedSourceLinks } from '../editor/SourceLinkNode';
import type { MarkdownNoteFileAction } from './MarkdownNoteHeader';
import { sanitizeExportFileName } from './markdownNoteEditorSupport';

export function useMarkdownNoteFileActions({
  noteOwner,
  dirty,
  editor,
  entryId,
  fallbackTitle,
  noteId,
  noteLinks,
  notify,
  save,
  title,
  workspaceRoot
}: {
  dirty: boolean;
  editor: Editor | null;
  entryId: string;
  noteOwner?: NoteOwner;
  fallbackTitle: string;
  noteId: string;
  noteLinks: SourceLink[];
  notify: ToastContextValue['notify'];
  save: (options?: { quiet?: boolean }) => Promise<boolean>;
  title: string;
  workspaceRoot?: string | null;
}) {
  const [fileAction, setFileAction] = useState<MarkdownNoteFileAction>(null);

  const saveDirtyNote = useCallback(async () => {
    if (!dirty) {
      return true;
    }
    return save({ quiet: true });
  }, [dirty, save]);

  const openMarkdownFile = useCallback(async () => {
    if (!workspaceRoot || fileAction) {
      return;
    }

    setFileAction('open');
    try {
      if (!(await saveDirtyNote())) {
        return;
      }
      await openOwnedNoteFile(workspaceRoot, noteOwner ?? { kind: 'entry', entry_id: entryId }, noteId, false);
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '打开失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setFileAction(null);
    }
  }, [entryId, noteOwner, fileAction, noteId, notify, saveDirtyNote, workspaceRoot]);

  const revealMarkdownFile = useCallback(async () => {
    if (!workspaceRoot || fileAction) {
      return;
    }

    setFileAction('reveal');
    try {
      if (!(await saveDirtyNote())) {
        return;
      }
      await openOwnedNoteFile(workspaceRoot, noteOwner ?? { kind: 'entry', entry_id: entryId }, noteId, true);
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '定位失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setFileAction(null);
    }
  }, [entryId, noteOwner, fileAction, noteId, notify, saveDirtyNote, workspaceRoot]);

  const saveMarkdownAs = useCallback(async () => {
    if (!editor || fileAction) {
      return;
    }

    setFileAction('save-as');
    try {
      const targetPath = await saveDialog({
        defaultPath: `${sanitizeExportFileName(title || fallbackTitle || '笔记')}.md`,
        filters: [{ name: 'Markdown 文件', extensions: ['md', 'markdown'] }]
      });
      if (!targetPath) {
        return;
      }

      const markdown = getMarkdownWithSourceLinks(editor);
      const links = pruneUnusedSourceLinks(markdown, noteLinks);
      const exportMarkdown = materializeMarkdownSourceLinks(markdown, links).trimEnd().concat('\n');
      await saveNoteMarkdownAs(targetPath, exportMarkdown);
      notify({
        tone: 'success',
        title: '已另存 Markdown',
        description: targetPath
      });
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '另存失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setFileAction(null);
    }
  }, [editor, fallbackTitle, fileAction, noteLinks, notify, title]);

  return {
    fileAction,
    openMarkdownFile,
    revealMarkdownFile,
    saveMarkdownAs
  };
}
