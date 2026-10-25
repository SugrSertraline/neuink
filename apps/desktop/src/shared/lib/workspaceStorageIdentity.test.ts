// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { workspaceStorageIdentity } from './workspaceStorageIdentity';
import { readingViewStorageKey, readReadingViewState, saveReadingViewState } from '@/modules/reader/components/navigation/readingViewStorage';
import { readWorkspaceSession, saveWorkspaceSession } from '@/app/workspaceSession';
import { initialWorkspaceSurfaceLayout, workspaceSurfaceReducer } from '@/app/workspaceSurface';
import type { EntryMeta } from '@/shared/types/domain';

function location(data?: string, imported?: string) {
  Object.defineProperty(window, '__NEUINK_PORTABLE_DATA__', { value: data, configurable: true });
  Object.defineProperty(window, '__NEUINK_PORTABLE_IMPORTED_ROOT__', { value: imported, configurable: true });
}
afterEach(() => { location(); localStorage.clear(); });

test('installed mode and external libraries keep their identities', () => {
  expect(workspaceStorageIdentity('D:\\library')).toBe('D:\\library');
  location('E:\\Neuink\\data');
  expect(workspaceStorageIdentity('D:\\library')).toBe('D:\\library');
  expect(workspaceStorageIdentity('E:\\Neuink\\data-other\\library')).toBe('E:\\Neuink\\data-other\\library');
  expect(workspaceStorageIdentity('E:\\Neuink\\data\\..\\external')).toBe('E:\\Neuink\\data\\..\\external');
});

test('an imported profile remaps old reading and tab identities once without replacing portable edits', () => {
  const oldRoot = 'D:\\neuink_data';
  const layout = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'pdf', entryId: 'paper' } });
  saveWorkspaceSession(oldRoot, layout);
  const identity = JSON.stringify(['pdf', oldRoot, 'paper', 'paper.pdf']);
  saveReadingViewState(readingViewStorageKey(oldRoot, 'pdf:paper'), { positions: { [identity]: { pageIdx: 12, offset: .5, left: 0 } } });
  location('E:\\Neuink\\data', oldRoot);
  const root = 'E:\\Neuink\\data\\library';
  expect(readWorkspaceSession(root, { entries: [{ id: 'paper', pdf: {} as EntryMeta['pdf'], contents: [] }], tags: [] })).toEqual(layout);
  const key = readingViewStorageKey(root, 'pdf:paper');
  expect(readReadingViewState(key).positions[JSON.stringify(['pdf', 'portable:library', 'paper', 'paper.pdf'])].pageIdx).toBe(12);
  saveReadingViewState(key, { positions: {} });
  expect(readReadingViewState(key).positions).toEqual({});
});

test('a moved folder and new drive letter reopen the same saved reading view', () => {
  location('E:\\Neuink\\data');
  const oldKey = readingViewStorageKey('\\\\?\\E:\\Neuink\\data\\library', 'pdf:paper');
  const layout = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface: { kind: 'pdf', entryId: 'paper' } });
  saveWorkspaceSession('E:\\Neuink\\data\\library', layout);
  saveReadingViewState(oldKey, { mode: 'replace', positions: { 'pdf:paper': { pageIdx: 8, offset: .4, left: 0, zoom: 1.2 } } });
  location('Z:\\移动的文件夹\\data');
  const nextKey = readingViewStorageKey('Z:\\移动的文件夹\\data\\library', 'pdf:paper');
  expect(nextKey).toBe(oldKey);
  expect(readReadingViewState(nextKey)).toMatchObject({ mode: 'replace', positions: { 'pdf:paper': { pageIdx: 8, zoom: 1.2 } } });
  expect(readWorkspaceSession('Z:\\移动的文件夹\\data\\library', {
    entries: [{ id: 'paper', pdf: {} as EntryMeta['pdf'], contents: [] }], tags: [],
  })).toEqual(layout);
});
