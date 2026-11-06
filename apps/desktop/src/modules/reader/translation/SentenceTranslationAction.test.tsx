// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ store: vi.fn(), translate: vi.fn() }));
vi.mock('@/shared/ipc/sentenceTranslationApi', () => ({ sentenceTranslation: mocks.store }));
vi.mock('@/shared/ipc/translationRoutingApi', () => ({ getTranslationRouting: async () => ({}), resolvedTranslationSource: () => ({ kind: 'service', provider: 'niutrans' }) }));
vi.mock('@/shared/ipc/selectionTranslationApi', () => ({ translateSelectionService: mocks.translate }));
import { SentenceTranslationAction } from './SentenceTranslationAction';
afterEach(cleanup);
it('requires explicit translation then preview confirmation before local saving', async () => {
  mocks.store.mockResolvedValue({}); mocks.translate.mockResolvedValue('第一句。');
  render(<SentenceTranslationAction target={{ root: 'test', entryId: 'entry', segmentUid: 's', paragraph: '前缀。 First.', sentence: 'First.', start: 4 }} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '翻译此句' }).hasAttribute('disabled')).toBe(false));
  expect(mocks.translate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '翻译此句' }));
  await screen.findByText('新译文预览 · 尚未保存');
  expect(mocks.store).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '保存单句译文' }));
  await screen.findByText('已保存的单句译文');
  expect(mocks.store).toHaveBeenLastCalledWith('test', 'entry', expect.objectContaining({ source_start: 10, source: 'First.', translation: '第一句。' }), undefined);
});
