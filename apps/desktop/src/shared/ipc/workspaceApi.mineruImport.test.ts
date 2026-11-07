import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PdfPairSummary } from '@/shared/pdf/readingPdfVerification';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

beforeEach(() => { vi.resetModules(); mocks.invoke.mockReset(); });

describe('createFromMineruClientResult', () => {
  it('forwards the optional original PDF to the create command', async () => {
    const { createFromMineruClientResult } = await import('./workspaceApi');
    mocks.invoke.mockResolvedValue({});
    await createFromMineruClientResult('library', 'Paper', { author: 'Ada' }, ['tag-1'], 'C:/out.zip', 'C:/paper.pdf');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('create_from_mineru_client_result', {
      request: {
        root: 'library', title: 'Paper', fields: { author: 'Ada' }, tags: ['tag-1'],
        zip_path: 'C:/out.zip', pdf_path: 'C:/paper.pdf', pdf_verification: null, confirmed_duplicate_hash: null
      }
    });
  });

  it('forwards the PDF verification summary unchanged', async () => {
    const { createFromMineruClientResult } = await import('./workspaceApi');
    const summary: PdfPairSummary = {
      candidate: { sha256: 'a'.repeat(64), page_count: 1, geometry_proof: 'unavailable', pages: [] },
      origin: { sha256: 'b'.repeat(64), page_count: 1, geometry_proof: 'unavailable', pages: [] }
    };
    mocks.invoke.mockResolvedValue({});
    await createFromMineruClientResult('library', 'Paper', {}, [], 'C:/out.zip', 'C:/paper.pdf', summary);
    expect(mocks.invoke.mock.calls[0][1]).toEqual({
      request: expect.objectContaining({ pdf_verification: summary })
    });
  });

  it('sends a null PDF path when only the ZIP is provided', async () => {
    const { createFromMineruClientResult } = await import('./workspaceApi');
    mocks.invoke.mockResolvedValue({});
    await createFromMineruClientResult('library', 'Paper', {}, [], 'C:/out.zip');
    expect(mocks.invoke.mock.calls[0][1]).toEqual({
      request: expect.objectContaining({ zip_path: 'C:/out.zip', pdf_path: null })
    });
  });

  it('keeps the duplicate confirmation when an original PDF is supplied', async () => {
    const { createFromMineruClientResult } = await import('./workspaceApi');
    mocks.invoke.mockResolvedValue({});
    await createFromMineruClientResult('library', 'Paper', {}, [], 'C:/result', 'C:/paper.pdf', undefined, 'confirmed-hash');
    expect(mocks.invoke.mock.calls[0][1]).toEqual({
      request: expect.objectContaining({ pdf_path: 'C:/paper.pdf', confirmed_duplicate_hash: 'confirmed-hash' })
    });
  });
});
