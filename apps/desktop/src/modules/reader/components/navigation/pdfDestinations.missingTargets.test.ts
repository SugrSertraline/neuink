import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { MISSING_NAMED_DESTINATION_MESSAGE, resolvePdfDestination } from './pdfDestinations';

function documentWithoutNameTable(): PDFDocumentProxy {
  return {
    numPages: 21,
    getDestination: vi.fn().mockResolvedValue(null),
    getPage: vi.fn(),
    getPageIndex: vi.fn()
  } as unknown as PDFDocumentProxy;
}

describe('PDF destinations without a name table', () => {
  it('explains the missing target table and points to the original PDF', async () => {
    const pdf = documentWithoutNameTable();
    await expect(resolvePdfDestination(pdf, 'Wu2025')).rejects.toThrow(MISSING_NAMED_DESTINATION_MESSAGE);
  });

  it('keeps the generic message for explicit destination arrays that are malformed', async () => {
    const pdf = documentWithoutNameTable();
    await expect(resolvePdfDestination(pdf, [])).rejects.toThrow('PDF 中没有可用的跳转目标');
  });
});
