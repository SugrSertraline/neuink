import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { Editor } from '@tiptap/core';
import { useCallback, useRef, useState } from 'react';

import type { ToastContextValue } from '@/shared/hooks/useToast';
import { importOwnedNoteAsset, saveOwnedNoteAssetBytes } from '@/shared/ipc/noteOwnerApi';
import type { NoteOwner } from '@/shared/types/domain';

export function firstImageFromClipboard(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) {
    return null;
  }

  for (const file of Array.from(clipboardData.files)) {
    if (file.type.startsWith('image/')) {
      return file;
    }
  }

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }

  return null;
}

export async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

export function insertNoteImageIntoEditor(
  editor: Editor,
  markdownPath: string,
  alt?: string | null
) {
  editor
    .chain()
    .focus()
    .setImage({
      src: markdownPath,
      alt: alt ?? ''
    })
    .run();
}

export function imageAltFromPath(path: string) {
  const fileName = path.split(/[\\/]/).pop() || '图片';
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || '图片';
}

export function useMarkdownNoteImages({
  entryId,
  noteOwner,
  noteId,
  notify,
  workspaceRoot
}: {
  entryId: string;
  noteOwner?: NoteOwner;
  noteId: string;
  notify: ToastContextValue['notify'];
  workspaceRoot?: string | null;
}) {
  const [imageImporting, setImageImporting] = useState(false);
  const pasteImageBusyRef = useRef(false);

  const savePastedImage = useCallback(
    async (editor: Editor, image: File) => {
      if (!workspaceRoot) {
        throw new Error('当前笔记所在工作区不可用，无法保存图片。');
      }

      pasteImageBusyRef.current = true;
      setImageImporting(true);
      try {
        const imported = await saveOwnedNoteAssetBytes(
          workspaceRoot,
          noteOwner ?? { kind: 'entry', entry_id: entryId },
          noteId,
          image.type,
          await fileToBase64(image),
          image.name || null
        );
        insertNoteImageIntoEditor(editor, imported.markdown_path, imageAltFromPath(image.name));
        notify({
          tone: 'success',
          title: '图片已粘贴',
          description: imported.markdown_path
        });
      } finally {
        pasteImageBusyRef.current = false;
        setImageImporting(false);
      }
    },
    [entryId, noteOwner, noteId, notify, workspaceRoot]
  );

  const selectAndInsertImage = useCallback(
    async (editor: Editor | null) => {
      if (!editor || !workspaceRoot || imageImporting) {
        return;
      }

      setImageImporting(true);
      try {
        const selected = await openDialog({
          multiple: false,
          filters: [
            {
              name: '图片',
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']
            }
          ]
        });
        if (!selected || Array.isArray(selected)) {
          return;
        }

        const imported = await importOwnedNoteAsset(workspaceRoot, noteOwner ?? { kind: 'entry', entry_id: entryId }, noteId, selected);
        insertNoteImageIntoEditor(editor, imported.markdown_path, imageAltFromPath(selected));
        notify({
          tone: 'success',
          title: '图片已导入',
          description: imported.markdown_path
        });
      } catch (caught) {
        notify({
          tone: 'danger',
          title: '图片导入失败',
          description: caught instanceof Error ? caught.message : String(caught)
        });
      } finally {
        setImageImporting(false);
      }
    },
    [entryId, noteOwner, imageImporting, noteId, notify, workspaceRoot]
  );

  return {
    imageImporting,
    pasteImageBusyRef,
    savePastedImage,
    selectAndInsertImage
  };
}
