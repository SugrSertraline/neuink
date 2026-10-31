import { checkPdfDuplicate, type PdfDuplicate } from '@/shared/ipc/workspaceApi';

export class DuplicatePdfError extends Error {
  constructor(public readonly duplicate: PdfDuplicate) {
    super(duplicate.inTrash
      ? `相同内容的 PDF 已在回收站：“${duplicate.title}”。可先恢复已有条目。`
      : `相同内容的 PDF 已在条目库：“${duplicate.title}”。请打开已有条目，或选择其他 PDF。`);
    this.name = 'DuplicatePdfError';
  }
}

export async function ensurePdfIsNew(root: string, path: string, source: 'pdf' | 'mineru') {
  const duplicate = await checkPdfDuplicate(root, path, source);
  if (duplicate) throw new DuplicatePdfError(duplicate);
}
