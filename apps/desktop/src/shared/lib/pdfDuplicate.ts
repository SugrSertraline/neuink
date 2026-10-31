import { checkPdfDuplicate, type PdfDuplicate } from '@/shared/ipc/workspaceApi';
import { createContext, useContext } from 'react';

export class DuplicatePdfError extends Error {
  constructor(public readonly duplicate: PdfDuplicate) {
    super(duplicate.inTrash
      ? `相同内容的 PDF 已在回收站：“${duplicate.title}”。可先恢复已有条目。`
      : `相同内容的 PDF 已在条目库：“${duplicate.title}”。请打开已有条目，或选择其他 PDF。`);
    this.name = 'DuplicatePdfError';
  }
}

export class PdfDuplicateCancelledError extends Error {
  constructor(public readonly duplicate: PdfDuplicate) {
    super('已取消添加重复的 PDF。');
    this.name = 'PdfDuplicateCancelledError';
  }
}

export type PdfDuplicateReview = { candidateTitle: string; sourcePath: string; duplicate: PdfDuplicate };
export type ConfirmPdfDuplicate = (review: PdfDuplicateReview) => Promise<boolean>;
export const PdfDuplicateReviewContext = createContext<ConfirmPdfDuplicate | undefined>(undefined);
export const useConfirmPdfDuplicate = () => useContext(PdfDuplicateReviewContext);

export async function ensurePdfIsNew(root: string, path: string, source: 'pdf' | 'mineru') {
  const duplicate = await checkPdfDuplicate(root, path, source);
  if (duplicate) throw new DuplicatePdfError(duplicate);
}
